import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { useSketchStore } from './sketchStore';
import type { JointSet, JointSetDraft } from '../types/joint';

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
      // 该组被删后，组内已画线条退回未归属（不丢线）
      if (target) {
        const sketch = useSketchStore();
        await sketch.ensure(target.faceId);
        sketch.detachGroupInFace(target.faceId, id);
      }
    },
    /**
     * 把同组产状合并到指定组：
     * 台账条数累加到目标组并删除被合并组；素描图上被合并组的线条连同编号一起转入目标组。
     * 未归属线段不参与合并。
     */
    async mergeInto(targetId: string, sourceIds: string[]): Promise<number> {
      const target = this.items.find((it) => it.id === targetId);
      if (!target) return 0;
      const sources = this.items.filter((it) => sourceIds.includes(it.id));
      const extra = sources.reduce((s, j) => s + j.jointCount, 0);

      const sketch = useSketchStore();
      await sketch.ensure(target.faceId);
      const movedLines = sketch.mergeForFace(target.faceId, targetId, sourceIds);

      await this.update(targetId, { jointCount: target.jointCount + extra });
      for (const s of sources) {
        // 源组线条已在 mergeForFace 中转入目标组，这里直接删记录，不能再 detach 回未归属
        await db.joints.delete(s.id);
      }
      this.items = this.items.filter((it) => !sourceIds.includes(it.id));
      return movedLines;
    },
  },
});
