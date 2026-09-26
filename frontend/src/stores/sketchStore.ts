import { defineStore } from 'pinia';
import type { SketchSegment } from '../types/sketch';

const KEY_PREFIX = 'gbtunnelface:sketch:';

function storageKey(faceId: string): string {
  return `${KEY_PREFIX}${faceId}`;
}

function read(faceId: string): SketchSegment[] {
  try {
    const raw = window.localStorage.getItem(storageKey(faceId));
    if (!raw) return [];
    const list = JSON.parse(raw) as SketchSegment[];
    // 旧数据没有 setId 字段，一律按未归属处理
    return list.map((s) => ({ ...s, setId: s.setId ?? null }));
  } catch {
    return [];
  }
}

interface SketchState {
  byFace: Record<string, SketchSegment[]>;
}

export const useSketchStore = defineStore('sketch', {
  state: (): SketchState => ({ byFace: {} }),
  getters: {
    byFace: (state) => (faceId: string) => state.byFace[faceId] ?? [],
  },
  actions: {
    ensure(faceId: string) {
      if (!(faceId in this.byFace)) {
        this.byFace[faceId] = read(faceId);
      }
    },
    persist(faceId: string) {
      try {
        window.localStorage.setItem(storageKey(faceId), JSON.stringify(this.byFace[faceId] ?? []));
      } catch {
        /* 忽略存储失败 */
      }
    },
    addSegment(faceId: string, seg: SketchSegment) {
      this.ensure(faceId);
      this.byFace[faceId] = [...this.byFace[faceId], seg];
      this.persist(faceId);
    },
    undo(faceId: string) {
      this.ensure(faceId);
      this.byFace[faceId] = this.byFace[faceId].slice(0, -1);
      this.persist(faceId);
    },
    clear(faceId: string) {
      this.byFace[faceId] = [];
      this.persist(faceId);
    },
    /** 单条线改挂组（setId 为 null 表示标为未归属） */
    setSegmentSet(faceId: string, segId: string, setId: string | null) {
      this.ensure(faceId);
      this.byFace[faceId] = this.byFace[faceId].map((s) => (s.id === segId ? { ...s, setId } : s));
      this.persist(faceId);
    },
    /**
     * 把若干组的线条整体改挂到目标组（toSetId 为 null 表示转为未归属）。
     * 只改挂原本就属于 fromSetIds 的线，未归属线不参与。
     */
    reassign(faceId: string, fromSetIds: string[], toSetId: string | null) {
      this.ensure(faceId);
      const from = new Set(fromSetIds);
      this.byFace[faceId] = this.byFace[faceId].map((s) =>
        s.setId && from.has(s.setId) ? { ...s, setId: toSetId } : s,
      );
      this.persist(faceId);
    },
  },
});
