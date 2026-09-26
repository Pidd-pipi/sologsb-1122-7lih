<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Attitude } from '../../types/face';
import type { JointSet } from '../../types/joint';
import type { SketchSegment } from '../../types/sketch';
import { useSketchStore } from '../../stores/sketchStore';

const props = withDefaults(
  defineProps<{
    faceId: string;
    lithology: string;
    attitude: Attitude;
    /** 该掌子面的节理组（用于落线归属、按组着色与组线对照） */
    jointSets?: JointSet[];
    /** 是否只读 */
    readonly?: boolean;
  }>(),
  { jointSets: () => [] },
);

const emit = defineEmits<{
  (e: 'change', segments: SketchSegment[]): void;
}>();

const VB = { w: 660, h: 380 };
const sketchStore = useSketchStore();
const selectedId = ref('');
/** 落线归属：空串表示未归属 */
const currentSetId = ref('');

const segments = computed(() => sketchStore.byFace(props.faceId));

/** 组配色：按组号顺序取色，未归属为灰色 */
const PALETTE = ['#1f4f8a', '#c0392b', '#1e8449', '#8e44ad', '#d35400', '#0e7490', '#b7950b', '#5b2c6f'];
const UNASSIGNED_COLOR = '#7b8592';

function colorOf(setId: string | null): string {
  if (!setId) return UNASSIGNED_COLOR;
  const idx = props.jointSets.findIndex((j) => j.id === setId);
  return idx >= 0 ? PALETTE[idx % PALETTE.length] : UNASSIGNED_COLOR;
}

/** 组号 + 组内序号：按落线顺序在各自组内编号（未归属单独编号） */
const decorated = computed(() => {
  const counters = new Map<string, number>();
  return segments.value.map((seg) => {
    const key = seg.setId ?? '';
    const seq = (counters.get(key) ?? 0) + 1;
    counters.set(key, seq);
    const set = props.jointSets.find((j) => j.id === seg.setId) ?? null;
    const label = seg.setId ? (set ? `J${set.setNo}-${seq}` : `J?-${seq}`) : `未归属-${seq}`;
    return { seg, seq, set, label, color: colorOf(seg.setId) };
  });
});

const selectedSeg = computed(() => decorated.value.find((d) => d.seg.id === selectedId.value) ?? null);

/** 组线对照：每组图上已画条数 vs 台账录入条数 */
const summary = computed(() =>
  props.jointSets.map((set) => {
    const drawn = segments.value.filter((s) => s.setId === set.id).length;
    return { set, drawn, recorded: set.jointCount, diff: set.jointCount - drawn };
  }),
);
const unassignedCount = computed(() => segments.value.filter((s) => !s.setId).length);

function diffText(diff: number): string {
  if (diff > 0) return `还差 ${diff} 条`;
  if (diff < 0) return `多画 ${-diff} 条`;
  return '持平';
}

/** 岩性填充纹样：按岩性选择不同 SVG pattern */
const patternId = computed(() => {
  const name = props.lithology;
  if (name.includes('灰岩') || name.includes('石灰岩')) return 'pat-carbonate';
  if (name.includes('砂岩')) return 'pat-sandstone';
  if (name.includes('泥岩') || name.includes('页岩')) return 'pat-mudstone';
  if (name.includes('花岗') || name.includes('片麻')) return 'pat-igneous';
  return 'pat-default';
});

const patternLabel = computed(() => {
  const map: Record<string, string> = {
    'pat-carbonate': '灰岩：短横线纹样',
    'pat-sandstone': '砂岩：点状纹样',
    'pat-mudstone': '泥岩/页岩：水平层理纹样',
    'pat-igneous': '岩浆岩：交叉线纹样',
    'pat-default': '通用：斜线纹样',
  };
  return map[patternId.value] ?? '通用纹样';
});

function emitChange() {
  emit('change', segments.value);
}

function onClick(e: MouseEvent) {
  if (props.readonly) return;
  const svg = e.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const x = Math.round(((e.clientX - rect.left) / rect.width) * VB.w);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * VB.h);
  // 挂组落线时按该组产状画线，未归属则沿用岩层产状
  const set = props.jointSets.find((j) => j.id === currentSetId.value) ?? null;
  const dipAngle = set ? set.dipAngle : props.attitude.dipAngle;
  const dipDirection = set ? set.dipDirection : props.attitude.dipDirection;
  sketchStore.addSegment(props.faceId, {
    id: `seg_${Date.now().toString(36)}${segments.value.length + 1}`,
    x,
    y,
    dipAngle,
    dipDirection,
    length: 56,
    setId: set?.id ?? null,
  });
  emitChange();
}

function undo() {
  if (segments.value.length === 0) return;
  sketchStore.undo(props.faceId);
  emitChange();
}

function clearAll() {
  sketchStore.clear(props.faceId);
  emitChange();
}

/** 选中线改挂组（空串表示标为未归属） */
function reassignSelected(value: string | number) {
  if (!selectedId.value) return;
  sketchStore.setSegmentSet(props.faceId, selectedId.value, value === '' ? null : String(value));
  emitChange();
}

function lineOf(seg: SketchSegment) {
  const rad = ((90 - seg.dipAngle) * Math.PI) / 180;
  const dx = (Math.cos(rad) * seg.length) / 2;
  const dy = (Math.sin(rad) * seg.length) / 2;
  return { x1: seg.x - dx, y1: seg.y - dy, x2: seg.x + dx, y2: seg.y + dy };
}

function tickOf(seg: SketchSegment) {
  const rad = ((90 - seg.dipAngle) * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  return { x: seg.x + nx * 10, y: seg.y + ny * 10 };
}

watch(() => props.faceId, (id) => sketchStore.ensure(id), { immediate: true });
</script>

<template>
  <div class="sketch">
    <div class="toolbar">
      <span class="label">落线归属</span>
      <el-select v-model="currentSetId" size="small" class="set-select" :disabled="readonly">
        <el-option label="未归属（暂不挂组）" value="" />
        <el-option
          v-for="j in jointSets"
          :key="j.id"
          :value="j.id"
          :label="`J${j.setNo} · ${j.dipDirection}°∠${j.dipAngle}°`"
        >
          <span class="dot" :style="{ background: colorOf(j.id) }" />
          J{{ j.setNo }} · {{ j.dipDirection }}°∠{{ j.dipAngle }}°
        </el-option>
      </el-select>
      <span class="hint">单击图面落线（共 {{ segments.length }} 条）</span>
      <el-button size="small" :disabled="readonly || segments.length === 0" @click="undo">撤销</el-button>
      <el-button size="small" :disabled="readonly || segments.length === 0" @click="clearAll">清空</el-button>
    </div>

    <div v-if="selectedSeg && !readonly" class="toolbar">
      <span class="label">选中 {{ selectedSeg.label }}，改挂到</span>
      <el-select
        size="small"
        class="set-select"
        :model-value="selectedSeg.seg.setId ?? ''"
        @update:model-value="reassignSelected"
      >
        <el-option label="未归属（暂不挂组）" value="" />
        <el-option
          v-for="j in jointSets"
          :key="j.id"
          :value="j.id"
          :label="`J${j.setNo} · ${j.dipDirection}°∠${j.dipAngle}°`"
        >
          <span class="dot" :style="{ background: colorOf(j.id) }" />
          J{{ j.setNo }} · {{ j.dipDirection }}°∠{{ j.dipAngle }}°
        </el-option>
      </el-select>
      <span class="hint">改挂后按新组重新编号</span>
    </div>

    <svg
      :viewBox="`0 0 ${VB.w} ${VB.h}`"
      class="canvas"
      data-testid="sketch-canvas"
      :style="{ cursor: readonly ? 'default' : 'crosshair' }"
      @click="onClick"
    >
      <defs>
        <pattern id="pat-carbonate" width="16" height="10" patternUnits="userSpaceOnUse">
          <rect width="16" height="10" fill="#dfe3e8" />
          <line x1="0" y1="5" x2="9" y2="5" stroke="#9aa3ad" stroke-width="1.2" />
        </pattern>
        <pattern id="pat-sandstone" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#e6dfd2" />
          <circle cx="3" cy="3" r="1.1" fill="#b0a189" />
          <circle cx="9" cy="8" r="1.1" fill="#b0a189" />
        </pattern>
        <pattern id="pat-mudstone" width="14" height="9" patternUnits="userSpaceOnUse">
          <rect width="14" height="9" fill="#e4e0e6" />
          <line x1="0" y1="3" x2="14" y2="3" stroke="#a9a2b0" stroke-width="1" />
          <line x1="0" y1="7" x2="14" y2="7" stroke="#a9a2b0" stroke-width="1" />
        </pattern>
        <pattern id="pat-igneous" width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill="#e8dede" />
          <path d="M0 14L14 0M-2 4L4 -2M10 16L16 10" stroke="#bda9a9" stroke-width="1" />
        </pattern>
        <pattern id="pat-default" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#e6e8ea" />
          <line x1="0" y1="12" x2="12" y2="0" stroke="#adb4bb" stroke-width="1" />
        </pattern>
      </defs>

      <!-- 掌子面轮廓（马蹄形） -->
      <path
        d="M40 330 L40 170 A 130 130 0 0 1 300 170 L300 330 Z"
        :fill="`url(#${patternId})`"
        stroke="#4a4f57"
        stroke-width="2"
      />
      <path d="M340 330 L340 170 A 130 130 0 0 1 600 170 L600 330 Z" fill="#f3f5f6" stroke="#4a4f57" stroke-width="1" stroke-dasharray="6 4" />

      <!-- 岩层产状参考线 -->
      <line x1="60" y1="300" x2="280" y2="200" stroke="#8a6d1f" stroke-width="1.6" stroke-dasharray="8 4" />
      <text x="60" y="292" font-size="12" fill="#8a6d1f">
        岩层产状 {{ attitude.strike }}°/{{ attitude.dipDirection }}°∠{{ attitude.dipAngle }}°
      </text>

      <!-- 结构面线段（按组着色，标注 组号-组内序号） -->
      <g v-for="d in decorated" :key="d.seg.id">
        <line
          :x1="lineOf(d.seg).x1"
          :y1="lineOf(d.seg).y1"
          :x2="lineOf(d.seg).x2"
          :y2="lineOf(d.seg).y2"
          :stroke="d.color"
          :stroke-width="selectedId === d.seg.id ? 4.2 : 2.4"
          :stroke-dasharray="d.seg.setId ? undefined : '5 3'"
          @click.stop="selectedId = d.seg.id"
        />
        <circle :cx="tickOf(d.seg).x" :cy="tickOf(d.seg).y" r="2.6" :fill="d.color" />
        <text :x="d.seg.x + 6" :y="d.seg.y - 6" font-size="11" :fill="d.color">{{ d.label }}</text>
      </g>

      <!-- 比例尺 -->
      <g>
        <line x1="440" y1="350" x2="540" y2="350" stroke="#333" stroke-width="2" />
        <line x1="440" y1="344" x2="440" y2="356" stroke="#333" stroke-width="2" />
        <line x1="540" y1="344" x2="540" y2="356" stroke="#333" stroke-width="2" />
        <text x="452" y="342" font-size="11" fill="#333">2 m（1:100）</text>
      </g>

      <!-- 图例 -->
      <g>
        <rect x="40" y="16" width="14" height="10" :fill="`url(#${patternId})`" stroke="#4a4f57" />
        <text x="60" y="25" font-size="11" fill="#333">{{ patternLabel }}</text>
        <line x1="230" y1="21" x2="256" y2="21" stroke="#1f4f8a" stroke-width="2.4" />
        <text x="262" y="25" font-size="11" fill="#333">结构面线段（按组着色，标注 组号-序号）</text>
        <line x1="450" y1="21" x2="476" y2="21" stroke="#8a6d1f" stroke-width="1.6" stroke-dasharray="6 4" />
        <text x="482" y="25" font-size="11" fill="#333">岩层层面</text>
        <line x1="230" y1="38" x2="256" y2="38" stroke="#7b8592" stroke-width="2.4" stroke-dasharray="5 3" />
        <text x="262" y="42" font-size="11" fill="#333">未归属线（灰色虚线，不计入任何组）</text>
      </g>
    </svg>

    <!-- 组线对照：每组图上已画条数 vs 台账录入条数 -->
    <div v-if="jointSets.length > 0" class="summary">
      <div class="sum-head">
        <strong>组线对照</strong>
        <span class="muted">图上已画 / 台账录入（条）</span>
        <span v-if="unassignedCount > 0" class="muted">未归属线 {{ unassignedCount }} 条，不计入任何组</span>
      </div>
      <el-table :data="summary" size="small" border>
        <el-table-column label="组号" width="80">
          <template #default="{ row }">
            <span class="dot" :style="{ background: colorOf(row.set.id) }" />
            J{{ row.set.setNo }}
          </template>
        </el-table-column>
        <el-table-column label="产状" min-width="120">
          <template #default="{ row }">{{ row.set.dipDirection }}°∠{{ row.set.dipAngle }}°</template>
        </el-table-column>
        <el-table-column prop="drawn" label="图上已画" width="90" align="center" />
        <el-table-column prop="recorded" label="台账录入" width="90" align="center" />
        <el-table-column label="差值" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.diff === 0 ? 'success' : row.diff > 0 ? 'warning' : 'danger'">
              {{ diffText(row.diff) }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-else-if="segments.length > 0" class="muted-line">
      未归属线 {{ unassignedCount }} 条；先在节理台账录入节理组，再把线挂到组上进行对照。
    </div>

    <div v-if="segments.length > 0" class="legend">
      <el-tag
        v-for="d in decorated"
        :key="d.seg.id"
        size="small"
        effect="plain"
        :style="{ borderColor: d.color, color: d.color }"
        @click="selectedId = d.seg.id"
      >
        {{ d.label }} @ ({{ d.seg.x }}, {{ d.seg.y }})
      </el-tag>
    </div>
  </div>
</template>

<style scoped>
.sketch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.label {
  font-size: 13px;
  color: #2f3a46;
}
.set-select {
  width: 220px;
}
.hint {
  flex: 1;
  font-size: 13px;
  color: #7b8592;
}
.canvas {
  width: 100%;
  border: 1px solid #d8dee6;
  border-radius: 6px;
  background: #fbfcfd;
}
.dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
.summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sum-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.muted {
  color: #7b8592;
  font-size: 12px;
}
.muted-line {
  color: #7b8592;
  font-size: 12px;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.legend .el-tag {
  cursor: pointer;
}
</style>
