/**
 * カスタムイージング関数（remotion-recipe.md から移植）
 */

/** ほぼ止まっている → 一気に動く → ピタッと止まる */
export const EXTREME_EASE_IN_OUT = (t: number): number => {
  if (t < 0.5) return Math.pow(2 * t, 4) / 2;
  return 1 - Math.pow(2 * (1 - t), 4) / 2;
};

/** 静止 → 爆発的に到達 */
export const EXPLOSIVE_OUT = (t: number): number => {
  return 1 - Math.pow(1 - t, 5);
};

/** じわじわ溜めて → バン */
export const DRAMATIC_IN = (t: number): number => {
  return Math.pow(t, 5);
};
