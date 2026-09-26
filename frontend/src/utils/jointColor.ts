/** 节理组在图上的配色（极点图与素描图共用，保证同组同色） */
export const JOINT_COLORS = ['#1f4f8a', '#c9962c', '#2f8f5b', '#a03b8a', '#c0552a', '#4a4a8a'];

/** 未归属线段的颜色（灰色，区别于任何正式组） */
export const UNASSIGNED_COLOR = '#8a93a0';

/** 按组号取色（组号循环取色） */
export function colorOfSetNo(setNo: number): string {
  return JOINT_COLORS[(setNo - 1) % JOINT_COLORS.length];
}
