import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { JointSet, JointSetDraft } from '../types/joint';
import { useSketchStore } from './sketchStore';

interface JointState {
  items: JointSet[];
  loaded: boolean;
}

export const useJointStore = defineStore('joint', {
  state: (): JointState => ({ items: [], loaded: false }),
  getters: {
    byFace: (state) => (faceId: string) =>
      state.items.filter((it) => it.faceId === faceId).sort((a, b) => a.setNo - b.setNo),
  },
  actions: {
    async load() {
      const rows = await db.joints.toArray();
      rows.sort((a, b) => a.setNo - b.setNo);
      this.items = rows;
      this.loaded = true;
    },
    async add(draft: JointSetDraft) {
      const record: JointSet = { ...toPlain(draft), id: newId('joint') };
      await db.joints.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    async update(id: string, patch: Partial<JointSet>) {
      const plain = toPlain(patch);
      await db.joints.update(id, plain);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...plain } : it));
    },
    async remove(id: string) {
      const target = this.items.find((it) => it.id === id);
      await db.joints.delete(id);
      this.items = this.items.filter((it) => it.id !== id);
      // 组被删除后，其素描线转为未归属，不随组一起消失
      if (target) useSketchStore().reassign(target.faceId, [id], null);
    },
    /** 把同组产状合并到指定组：条数累加到目标组、素描线一并改挂，并删除被合并组；未归属线不参与 */
    async mergeInto(targetId: string, sourceIds: string[]) {
      const target = this.items.find((it) => it.id === targetId);
      if (!target) return;
      const sources = this.items.filter((it) => sourceIds.includes(it.id));
      const extra = sources.reduce((s, j) => s + j.jointCount, 0);
      // 先改挂素描线（只动原本属于被合并组的线），再删组，避免删组时被置为未归属
      useSketchStore().reassign(target.faceId, sources.map((s) => s.id), targetId);
      await this.update(targetId, { jointCount: target.jointCount + extra });
      for (const s of sources) {
        await this.remove(s.id);
      }
    },
  },
});
