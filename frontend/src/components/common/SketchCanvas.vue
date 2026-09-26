<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Attitude } from '../../types/face';
import type { JointSet } from '../../types/joint';
import type { SketchSegment } from '../../types/sketch';
import { useSketchStore } from '../../stores/sketchStore';
import { attitudeText } from '../../utils/geoMath';
import { colorOfSetNo, UNASSIGNED_COLOR } from '../../utils/jointColor';

const props = defineProps<{
  faceId: string;
  lithology: string;
  attitude: Attitude;
  /** 本掌子面已录入的节理组台账 */
  joints: JointSet[];
  /** 是否只读 */
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'change', segments: SketchSegment[]): void;
}>();

const VB = { w: 660, h: 380 };
const sketchStore = useSketchStore();
const selectedId = ref('');

/** 落线前选择的归属组；null 表示先标未归属 */
const activeSetId = ref<string | null>(null);

const segments = computed(() => sketchStore.byFace(props.faceId));
const groupMap = computed(() => new Map(props.joints.map((j) => [j.id, j])));

/** 选中组若被删除/合并掉，回落到未归属 */
watch(
  () => props.joints.map((j) => j.id).join(','),
  () => {
    if (activeSetId.value && !groupMap.value.has(activeSetId.value)) activeSetId.value = null;
  },
);

const activeSet = computed(() => (activeSetId.value ? groupMap.value.get(activeSetId.value) ?? null : null));
const activeAttitude = computed(() => activeSet.value ?? props.attitude);

const storageReady = ref(false);
onMounted(async () => {
  await sketchStore.ensure(props.faceId);
  storageReady.value = true;
  emit('change', sketchStore.byFace(props.faceId));
});
watch(
  () => props.faceId,
  async (id) => {
    await sketchStore.ensure(id);
    emit('change', sketchStore.byFace(id));
  },
);

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

function isUnassigned(seg: SketchSegment): boolean {
  return seg.jointSetId === null || !groupMap.value.has(seg.jointSetId);
}

function setOf(seg: SketchSegment): JointSet | null {
  return seg.jointSetId ? groupMap.value.get(seg.jointSetId) ?? null : null;
}

/** 线段颜色：按节理组着色，未归属（含台账已删的失联线）用灰色虚线 */
function colorOf(seg: SketchSegment): string {
  const set = setOf(seg);
  return set ? colorOfSetNo(set.setNo) : UNASSIGNED_COLOR;
}

/** 图上标注：组号 + 组内序号 + 产状，如 J2-3 216°∠46°；未归属线为 未归属-2 */
function labelOf(seg: SketchSegment): string {
  const dir = Math.round(seg.dipDirection);
  const ang = Math.round(seg.dipAngle);
  const set = setOf(seg);
  const head = set ? `J${set.setNo}-${seg.seq}` : `未归属-${seg.seq}`;
  return `${head} ${dir}°∠${ang}°`;
}

function emitChange() {
  emit('change', sketchStore.byFace(props.faceId));
}

function onClick(e: MouseEvent) {
  if (props.readonly) return;
  const svg = e.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const x = Math.round(((e.clientX - rect.left) / rect.width) * VB.w);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * VB.h);
  const { dipAngle, dipDirection } = activeAttitude.value;
  const jointSetId = activeSet.value?.id ?? null;
  const seg = sketchStore.addSegment(props.faceId, {
    x,
    y,
    dipAngle,
    dipDirection,
    length: 56,
    jointSetId,
    label: '',
  });
  // label 在渲染时按组号/序号动态计算（合并转组后标签自动跟随），落线时同步一份便于留档
  seg.label = labelOf(seg);
  sketchStore.persist(props.faceId);
  emitChange();
}

function undo() {
  sketchStore.undo(props.faceId);
  emitChange();
}

function clearAll() {
  sketchStore.clear(props.faceId);
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

/** 每组「已画条数 / 台账录入条数」汇总，末行是未归属 */
interface SummaryRow {
  setNo: number | null;
  setId: string | null;
  dipDirection: number;
  dipAngle: number;
  drawn: number;
  ledger: number | null;
}

const drawnCountByGroup = computed(() => {
  const map = new Map<string, number>();
  let unassigned = 0;
  for (const s of segments.value) {
    if (!isUnassigned(s)) {
      const id = s.jointSetId as string;
      map.set(id, (map.get(id) ?? 0) + 1);
    } else {
      unassigned += 1;
    }
  }
  return { map, unassigned };
});

const summaryRows = computed<SummaryRow[]>(() => {
  const rows: SummaryRow[] = props.joints
    .slice()
    .sort((a, b) => a.setNo - b.setNo)
    .map((j) => ({
      setNo: j.setNo,
      setId: j.id,
      dipDirection: j.dipDirection,
      dipAngle: j.dipAngle,
      drawn: drawnCountByGroup.value.map.get(j.id) ?? 0,
      ledger: j.jointCount,
    }));
  rows.push({ setNo: null, setId: null, dipDirection: Number.NaN, dipAngle: Number.NaN, drawn: drawnCountByGroup.value.unassigned, ledger: null });
  return rows;
});

function rowColor(row: SummaryRow): string {
  return row.setNo === null ? UNASSIGNED_COLOR : colorOfSetNo(row.setNo);
}

type TagType = 'success' | 'warning' | 'danger' | 'info';
function diffState(row: SummaryRow): { type: TagType; text: string } {
  if (row.ledger === null) {
    return row.drawn > 0 ? { type: 'warning', text: `${row.drawn} 条待归组` } : { type: 'info', text: '—' };
  }
  const d = row.drawn - row.ledger;
  if (d === 0) return { type: 'success', text: '一致' };
  return d < 0 ? { type: 'warning', text: `少画 ${-d} 条` } : { type: 'danger', text: `多画 ${d} 条` };
}

/** 顶部提示：把所有差额一次说清 */
const mismatchText = computed(() => {
  const parts: string[] = [];
  for (const row of summaryRows.value) {
    if (row.ledger === null) continue;
    const d = row.drawn - row.ledger;
    if (d < 0) parts.push(`J${row.setNo} 少画 ${-d} 条`);
    else if (d > 0) parts.push(`J${row.setNo} 多画 ${d} 条`);
  }
  if (drawnCountByGroup.value.unassigned > 0) parts.push(`${drawnCountByGroup.value.unassigned} 条未归属`);
  return parts.join('、');
});
</script>

<template>
  <div class="sketch">
    <div class="toolbar">
      <span class="label">落线归属</span>
      <el-select v-model="activeSetId" size="small" class="group-select" :disabled="readonly">
        <el-option :value="null" label="未归属（先标记，稍后再归组）" />
        <el-option
          v-for="j in joints"
          :key="j.id"
          :value="j.id"
          :label="`J${j.setNo}（${attitudeText(j.dipDirection, j.dipAngle)}）`"
        />
      </el-select>
      <span class="hint">
        单击图面落线，按
        <strong v-if="activeSet" :style="{ color: colorOfSetNo(activeSet.setNo) }">J{{ activeSet.setNo }}</strong>
        <strong v-else :style="{ color: UNASSIGNED_COLOR }">未归属</strong>
        产状 {{ Math.round(activeAttitude.dipDirection) }}°∠{{ Math.round(activeAttitude.dipAngle) }}° 布置 · 已画 {{ segments.length }} 条
      </span>
      <el-button size="small" :disabled="readonly || segments.length === 0" @click="undo">撤销</el-button>
      <el-button size="small" :disabled="readonly || segments.length === 0" @click="clearAll">清空</el-button>
    </div>

    <el-alert
      v-if="mismatchText"
      :title="`图实核对：${mismatchText}`"
      type="warning"
      :closable="false"
      show-icon
      class="mismatch"
    />

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

      <!-- 结构面线段：按组着色，标注组号-组内序号 -->
      <g v-for="seg in segments" :key="seg.id">
        <line
          :x1="lineOf(seg).x1"
          :y1="lineOf(seg).y1"
          :x2="lineOf(seg).x2"
          :y2="lineOf(seg).y2"
          :stroke="selectedId === seg.id ? '#d3542f' : colorOf(seg)"
          :stroke-dasharray="isUnassigned(seg) ? '6 4' : undefined"
          stroke-width="2.4"
          @click.stop="selectedId = seg.id"
        />
        <circle :cx="tickOf(seg).x" :cy="tickOf(seg).y" r="2.6" :fill="colorOf(seg)" />
        <text :x="seg.x + 6" :y="seg.y - 6" font-size="11" :fill="colorOf(seg)">{{ labelOf(seg) }}</text>
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
        <text x="262" y="25" font-size="11" fill="#333">结构面线段（按组着色，数字为组号-序号）</text>
        <line x1="520" y1="21" x2="546" y2="21" :stroke="UNASSIGNED_COLOR" stroke-width="2.4" stroke-dasharray="6 4" />
        <text x="552" y="25" font-size="11" fill="#333">未归属</text>
      </g>
    </svg>

    <!-- 每组已画条数 vs 节理录入条数，差额明示 -->
    <el-table :data="summaryRows" size="small" border class="summary" data-testid="sketch-summary">
      <el-table-column label="节理组" width="110">
        <template #default="{ row }">
          <span class="group-cell">
            <i class="dot" :style="{ backgroundColor: rowColor(row) }" />
            <strong v-if="row.setNo !== null">J{{ row.setNo }}</strong>
            <strong v-else :style="{ color: UNASSIGNED_COLOR }">未归属</strong>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="组内产状" width="140">
        <template #default="{ row }">
          {{ row.setNo === null ? '—' : attitudeText(row.dipDirection, row.dipAngle) }}
        </template>
      </el-table-column>
      <el-table-column label="图上已画（条）" prop="drawn" width="110" />
      <el-table-column label="台账录入（条）" width="110">
        <template #default="{ row }">{{ row.ledger === null ? '—' : row.ledger }}</template>
      </el-table-column>
      <el-table-column label="差额" min-width="120">
        <template #default="{ row }">
          <el-tag size="small" :type="diffState(row).type">{{ diffState(row).text }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="segments.length > 0" class="legend">
      <el-tag
        v-for="seg in segments"
        :key="seg.id"
        size="small"
        :type="selectedId === seg.id ? 'danger' : 'info'"
        :style="{ borderColor: colorOf(seg), color: colorOf(seg) }"
      >
        {{ labelOf(seg) }} @ ({{ seg.x }}, {{ seg.y }})
      </el-tag>
    </div>
    <p v-else-if="storageReady" class="empty-tip">尚未布置结构面线段：先在上方选择归属组（或未归属），再在图上单击落线。</p>
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
.toolbar .label {
  font-size: 13px;
  color: #5b6470;
}
.group-select {
  width: 230px;
}
.mismatch {
  margin: 0;
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
.summary {
  width: 100%;
}
.group-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.empty-tip {
  margin: 0;
  font-size: 12px;
  color: #97a0ad;
}
</style>
