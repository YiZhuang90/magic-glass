// 手势识别（握拳 / 张开 / 只伸食指 = 画笔）与鼠标模式用的“虚拟手”模板。
// 输入为 21 个关键点（已乘以画面宽高比的像素空间，比例不失真）。
const FINGERS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]]; // [MCP, PIP, TIP]：食指、中指、无名指、小指
const Z_W = 0.8; // MediaPipe 的 z 有噪声，按 0.8 权重计入（手指朝向摄像头时仍能看出伸直）

/**
 * 每根手指的伸直程度：指尖到手腕的距离 ÷ 指根(MCP)到手腕的距离。
 * 只用关键点之间的相对距离，与手的大小、远近、旋转无关（不依赖原始 y 坐标）。
 * 伸直约 1.8–2.2，半弯约 1.4，握紧约 1.0–1.2。
 */
export function fingerRatios(p) {
  const w = p[0];
  const d = (a, b) => { const dz = ((a[2] || 0) - (b[2] || 0)) * Z_W; return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + dz * dz); };
  return FINGERS.map(([m, , t]) => d(p[t], w) / Math.max(1e-6, d(p[m], w)));
}

// 阈值（带回差：进入某个手势要求严格，保持这个手势时放宽，避免在边界来回跳）
export const POSE_T = {
  ext: 1.6, extKeep: 1.42,     // 食指“伸直”
  curl: 1.38, curlKeep: 1.52,  // 中指 / 无名指 / 小指“弯曲”
  lead: 0.38,                  // 食指要比其他三指明显更长（孩子常常弯不紧）
  strongExt: 1.45, strongCurl: 1.2, strongLead: 0.55, // 其他三指握得很紧时，食指斜指向摄像头（画面里变短）也算
  openExt: 1.6, openN: 3,      // 至少 3 指伸直 = 张开
  fistCurl: 1.35, fistN: 3,    // 至少 3 指弯曲且食指不伸直 = 握拳
};

/**
 * 单帧手势判断：'point'（只伸食指，拇指不限） | 'fist' | 'open' | 'other'。
 * prev 用于回差：上一帧稳定手势是 point 时用更宽松的阈值保持。
 */
export function classify(p, prev = 'open') {
  const r = fingerRatios(p), [ix, ...rest] = r, T = POSE_T;
  const keep = prev === 'point';
  const others = Math.max(...rest);
  const extT = keep ? T.extKeep : T.ext, curlT = keep ? T.curlKeep : T.curl;
  if (ix > extT && others < curlT && ix - others > (keep ? T.lead * 0.6 : T.lead)) return 'point';
  if (ix > T.strongExt && others < T.strongCurl && ix - others > T.strongLead) return 'point';
  const nCur = r.filter(v => v < T.fistCurl).length, nExt = r.filter(v => v > T.openExt).length;
  if (nCur >= T.fistN && ix < T.ext) return 'fist';
  if (nExt >= T.openN) return 'open';
  return 'other';
}

/**
 * 防抖：同一个新手势连续出现 n 帧才切换（识别约 30 次/秒）。
 * 进入 / 离开“画笔”都要 3 帧，其余 2 帧；'other' 只在持续 4 帧后才生效，避免画线中途断开。
 */
export class PoseFilter {
  constructor(initial = 'open') { this.pose = initial; this.cand = initial; this.n = 0; }
  need(next) { if (next === 'point' || this.pose === 'point') return 3; if (next === 'other') return 4; return 2; }
  update(p) {
    const g = classify(p, this.pose);
    if (g === this.pose) { this.cand = g; this.n = 0; return this.pose; }
    if (g === this.cand) this.n++; else { this.cand = g; this.n = 1; }
    if (this.n >= this.need(g)) { this.pose = g; this.n = 0; }
    return this.pose;
  }
}

// 模板：以掌心为原点、手长（手腕到中指根）为单位，手指朝上，镜像后的右手（拇指在左）。
const OPEN = [
  [0, 0.55], [-0.28, 0.42], [-0.5, 0.22], [-0.64, 0.02], [-0.76, -0.16],
  [-0.3, -0.35], [-0.36, -0.72], [-0.39, -0.95], [-0.41, -1.15],
  [-0.02, -0.42], [-0.02, -0.84], [-0.02, -1.1], [-0.02, -1.32],
  [0.24, -0.36], [0.28, -0.74], [0.3, -0.97], [0.32, -1.15],
  [0.45, -0.25], [0.54, -0.52], [0.6, -0.7], [0.64, -0.86],
];
const FIST = [
  [0, 0.55], [-0.28, 0.42], [-0.46, 0.16], [-0.4, -0.06], [-0.2, -0.12],
  [-0.3, -0.35], [-0.34, -0.55], [-0.3, -0.32], [-0.28, -0.2],
  [-0.02, -0.42], [-0.03, -0.62], [-0.02, -0.37], [-0.02, -0.24],
  [0.24, -0.36], [0.25, -0.55], [0.24, -0.32], [0.22, -0.2],
  [0.45, -0.25], [0.48, -0.4], [0.44, -0.24], [0.4, -0.14],
];
export const TEMPLATES = { OPEN, FIST, POINT: OPEN.map((p, i) => (i < 9 ? p : FIST[i])) };
/** 生成鼠标虚拟手：f = 0 张开，1 握拳 */
export function templateHand(cx, cy, size, f, out) {
  out = out || OPEN.map(() => [0, 0]);
  for (let i = 0; i < 21; i++) {
    const x = OPEN[i][0] + (FIST[i][0] - OPEN[i][0]) * f, y = OPEN[i][1] + (FIST[i][1] - OPEN[i][1]) * f;
    out[i][0] = cx + x * size; out[i][1] = cy + y * size;
  }
  return out;
}
export const PALM_IDS = [0, 5, 9, 13, 17];
