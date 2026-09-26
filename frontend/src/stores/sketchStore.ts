import { defineStore } from 'pinia';
import type { SketchSegment } from '../types/sketch';
import { newId } from '../utils/id';

interface SketchState {
  /** 按掌子面存放的结构面线段（localStorage 为持久层） */
  faces: Record<string, SketchSegment[]>;
  /** 各掌子面是否已从 localStorage 读入 */
  loaded: Record<string, boolean>;
}

const storageKey = (faceId: string) => `gbtunnelface:sketch:${faceId}`;

/** 兼容旧数据：补 jointSetId / seq（旧线段一律视为未归属） */
function normalize(raw: Partial<SketchSegment>[]): SketchSegment[] {
  const seqOf = new Map<string, number>();
  return raw.map((seg, index) => {
    const key = seg.jointSetId ?? '__none__';
    const seq = (seqOf.get(key) ?? 0) + 1;
    seqOf.set(key, seq);
    return {
      id: seg.id ?? `seg_${index}`,
      x: seg.x ?? 0,
      y: seg.y ?? 0,
      dipAngle: seg.dipAngle ?? 0,
      dipDirection: seg.dipDirection ?? 0,
      length: seg.length ?? 56,
      jointSetId: seg.jointSetId ?? null,
      label: seg.label ?? '',
      seq,
    } as SketchSegment;
  });
}

/** 组内序号：落线时所属组（含未归属）内部的顺序号 */
export interface DraftSegment {
  x: number;
  y: number;
  dipAngle: number;
  dipDirection: number;
  length: number;
  jointSetId: string | null;
  label: string;
}

export const useSketchStore = defineStore('sketch', {
  state: (): SketchState => ({ faces: {}, loaded: {} }),

  getters: {
    byFace: (state) => (faceId: string): SketchSegment[] => state.faces[faceId] ?? [],
  },

  actions: {
    /** 从 localStorage 读入指定掌子面的线段（幂等） */
    async ensure(faceId: string): Promise<void> {
      if (this.loaded[faceId]) return;
      let segments: SketchSegment[] = [];
      try {
        const raw = window.localStorage.getItem(storageKey(faceId));
        if (raw) segments = normalize(JSON.parse(raw) as Partial<SketchSegment>[]);
      } catch {
        segments = [];
      }
      this.faces[faceId] = segments;
      this.loaded[faceId] = true;
    },

    persist(faceId: string) {
      try {
        window.localStorage.setItem(storageKey(faceId), JSON.stringify(this.faces[faceId] ?? []));
      } catch {
        /* 忽略存储失败 */
      }
    },

    /** 落一条线；组内序号在当前组最大值后递增 */
    addSegment(faceId: string, draft: DraftSegment): SketchSegment {
      const list = this.faces[faceId] ?? [];
      const seq = list.filter((s) => s.jointSetId === draft.jointSetId).length + 1;
      const seg: SketchSegment = { id: newId('seg'), seq, ...draft };
      this.faces[faceId] = [...list, seg];
      this.persist(faceId);
      return seg;
    },

    undo(faceId: string) {
      const list = this.faces[faceId];
      if (!list || list.length === 0) return;
      this.faces[faceId] = list.slice(0, -1);
      this.persist(faceId);
    },

    clear(faceId: string) {
      this.faces[faceId] = [];
      this.persist(faceId);
    },

    /**
     * 把一组（或多组）线段并入目标组：
     * - 仅转写 jointSetId 落在 sourceIds 内的线段，未归属（null）绝不混入；
     * - 目标组原有编号保持不变，被转入线条按落线先后接续编号；
     * - 其它组的线段不受影响。
     * 返回实际转入的线条数。
     */
    mergeForFace(faceId: string, targetId: string, sourceIds: string[]): number {
      const list = this.faces[faceId];
      if (!list || sourceIds.length === 0) return 0;
      let nextSeq = list.reduce((m, s) => (s.jointSetId === targetId ? Math.max(m, s.seq) : m), 0) + 1;
      let moved = 0;
      this.faces[faceId] = list.map((s) => {
        if (s.jointSetId !== null && sourceIds.includes(s.jointSetId)) {
          moved += 1;
          return { ...s, jointSetId: targetId, seq: nextSeq++ };
        }
        return s;
      });
      this.persist(faceId);
      return moved;
    },

    /** 删除节理组时：该组线条退回未归属，编号接在未归属序号之后 */
    detachGroupInFace(faceId: string, groupId: string): number {
      const list = this.faces[faceId];
      if (!list) return 0;
      let nextSeq = list.reduce((m, s) => (s.jointSetId === null ? Math.max(m, s.seq) : m), 0) + 1;
      let moved = 0;
      this.faces[faceId] = list.map((s) => {
        if (s.jointSetId === groupId) {
          moved += 1;
          return { ...s, jointSetId: null, seq: nextSeq++ };
        }
        return s;
      });
      this.persist(faceId);
      return moved;
    },
  },
});
