/** 岩性素描图上的一条结构面线段 */
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
  /** 归属节理组 id；null 表示未归属 */
  setId: string | null;
  /** 旧版标签（兼容用，显示时按"组号-组内序号"动态生成） */
  label?: string;
}
