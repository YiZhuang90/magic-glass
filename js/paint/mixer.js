// 颜料混色：使用 Mixbox 2.0（Kubelka-Munk 颜料模型，CC BY-NC 4.0，仅限非商用）。
// 混合在 Mixbox 的 7 维“潜空间”里按比例线性相加，再转回 RGB，得到真实颜料的减色效果。
import mixbox, { _evalPolynomial } from '../vendor/mixbox.esm.js';

export const LATENT = 7;
export const toLatent = (rgb) => Float32Array.from(mixbox.rgbToLatent(rgb));
const c01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
/** 潜空间 → RGB（0–255）。arr 可为普通数组或 Float32Array，off 为起始下标（网格用）。 */
export function toRgb(arr, out = [0, 0, 0], off = 0) {
  const p = _evalPolynomial(arr[off], arr[off + 1], arr[off + 2], arr[off + 3]);
  out[0] = (c01(p[0] + arr[off + 4]) * 255 + 0.5) | 0;
  out[1] = (c01(p[1] + arr[off + 5]) * 255 + 0.5) | 0;
  out[2] = (c01(p[2] + arr[off + 6]) * 255 + 0.5) | 0;
  return out;
}
/** 按权重混合多种颜色（RGB 数组），返回 RGB */
export function mixRgb(colors, weights) {
  const z = new Float32Array(LATENT); let ws = 0;
  colors.forEach((c, i) => { const l = mixbox.rgbToLatent(c), w = weights ? weights[i] : 1; ws += w; for (let k = 0; k < LATENT; k++) z[k] += l[k] * w; });
  for (let k = 0; k < LATENT; k++) z[k] /= ws;
  return toRgb(z);
}

/** 色盘上的五种颜料 */
export const PIGMENTS = [
  { id: 'red', zh: '红色', en: 'Red', rgb: [230, 30, 35] },
  { id: 'yellow', zh: '黄色', en: 'Yellow', rgb: [254, 220, 0] },
  { id: 'blue', zh: '蓝色', en: 'Blue', rgb: [0, 70, 190] },
  { id: 'white', zh: '白色', en: 'White', rgb: [255, 255, 255] },
  { id: 'black', zh: '黑色', en: 'Black', rgb: [20, 20, 24] },
];

/** 颜色命名表（参考值按 Mixbox 实际混出的颜色校准） */
export const NAMED = [
  ...PIGMENTS.map(p => ({ ...p, base: true })),
  { id: 'orange', zh: '橙色', en: 'Orange', rgb: [255, 110, 30] },
  { id: 'green', zh: '绿色', en: 'Green', rgb: [65, 160, 66] },
  { id: 'purple', zh: '紫色', en: 'Purple', rgb: [105, 45, 100] },
  { id: 'brown', zh: '棕色', en: 'Brown', rgb: [130, 95, 55] },
  { id: 'darkbrown', zh: '深棕色', en: 'Dark Brown', rgb: [70, 45, 30] },
  { id: 'pink', zh: '粉色', en: 'Pink', rgb: [252, 130, 150] },
  { id: 'lightblue', zh: '浅蓝色', en: 'Light Blue', rgb: [95, 165, 250] },
  { id: 'gray', zh: '灰色', en: 'Gray', rgb: [130, 132, 140] },
  { id: 'lightgreen', zh: '浅绿色', en: 'Light Green', rgb: [150, 210, 130] },
  { id: 'darkgreen', zh: '深绿色', en: 'Dark Green', rgb: [35, 85, 45] },
  { id: 'yellowgreen', zh: '黄绿色', en: 'Yellow Green', rgb: [150, 175, 30] },
  { id: 'lavender', zh: '浅紫色', en: 'Lavender', rgb: [185, 150, 200] },
  { id: 'navy', zh: '深蓝色', en: 'Navy Blue', rgb: [20, 35, 95] },
  { id: 'lightorange', zh: '浅橙色', en: 'Peach', rgb: [255, 180, 120] },
  { id: 'lightyellow', zh: '浅黄色', en: 'Light Yellow', rgb: [255, 240, 150] },
];
const NAMED_LAB = NAMED.map(n => ({ n, lab: rgbToLab(n.rgb) }));

/** 把 RGB 归到最接近的颜色名（CIELAB 距离） */
export function nameColor(rgb) {
  const lab = rgbToLab(rgb); let best = null, bd = Infinity;
  for (const { n, lab: l } of NAMED_LAB) {
    const d = (lab[0] - l[0]) ** 2 + (lab[1] - l[1]) ** 2 + (lab[2] - l[2]) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return { ...best, distance: Math.sqrt(bd) };
}

export function rgbToLab([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g3 = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = g3(X), fy = g3(Y), fz = g3(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
