/** 岩性素描图上的结构面线段 */
export interface SketchSegment {
  id: string;
  /** 线中点 x（视图坐标） */
  x: number;
  /** 线中点 y（视图坐标） */
  y: number;
  /** 结构面倾角 ° */
  dipAngle: number;
  /** 结构面倾向 ° */
  dipDirection: number;
  /** 线长（视图坐标） */
  length: number;
  /** 所属节理组 id；null 表示未归属（先标记，稍后再归组） */
  jointSetId: string | null;
  /** 组内序号：落线时所属组（含未归属）内部的顺序号 */
  seq: number;
  /** 落线时的文字标注 */
  label: string;
}
