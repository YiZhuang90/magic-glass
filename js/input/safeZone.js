// 安全区：只把摄像头画面中间的一块（四周留边，下边多留一点）映射到整个屏幕，并夹紧在屏幕内。
// 孩子站在屏幕前、摄像头在屏幕上方时，手不用伸到摄像头画面的边上（那里容易识别不到），
// 也能轻松碰到屏幕四边的颜料罐和按钮。坐标都是“镜像后”的摄像头归一化坐标（0–1）。

export const SAFE_DEFAULTS = { safeMargin: 0.15, safeBottomExtra: 0.10 };

/** 有效区域（摄像头归一化坐标）：左右上各留 margin，下边留 margin + bottomExtra */
export function safeRect(s = {}) {
  const m = clamp(s.safeMargin ?? SAFE_DEFAULTS.safeMargin, 0, 0.35);
  const b = clamp(s.safeBottomExtra ?? SAFE_DEFAULTS.safeBottomExtra, 0, 0.25);
  const x0 = m, x1 = 1 - m, y0 = m, y1 = Math.max(y0 + 0.2, 1 - m - b);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** 摄像头坐标 → 屏幕归一化坐标（0–1，夹紧：安全区外的手停在屏幕边上） */
export function camToScreen(nx, ny, r) {
  return [clamp((nx - r.x0) / r.w, 0, 1), clamp((ny - r.y0) / r.h, 0, 1)];
}

/** 屏幕归一化坐标 → 摄像头坐标（测试、预览用） */
export function screenToCam(u, v, r) { return [r.x0 + u * r.w, r.y0 + v * r.h]; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
