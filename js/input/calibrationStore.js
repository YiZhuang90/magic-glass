// 标定数据：摄像头（镜像后归一化）坐标 → 屏幕归一化坐标。只存 4 组点，保存在 localStorage。
import { solveHomography, applyHomography } from './homography.js';

const KEY = 'magicGlass.calibration.v1';
const FULL_MARGIN = 0.06; // 未标定时四周各留一点余量，让孩子更容易够到边角

export class CalibrationStore {
  constructor() { this.H = null; this.pairs = null; this.load(); }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d && d.src && d.dst) this.set(d.src, d.dst, false);
    } catch {}
  }
  set(src, dst, persist = true) {
    const H = solveHomography(src, dst);
    if (!H) return false;
    this.H = H; this.pairs = { src, dst };
    if (persist) try { localStorage.setItem(KEY, JSON.stringify(this.pairs)); } catch {}
    return true;
  }
  reset() { this.H = null; this.pairs = null; try { localStorage.removeItem(KEY); } catch {} }
  get isCalibrated() { return !!this.H; }
  /** 屏幕四角对应的摄像头坐标（用于拖动标定的初始框）。 */
  cameraQuad() {
    if (this.pairs && this.pairs.dst.every((p, i) => p[0] === [0, 1, 1, 0][i] && p[1] === [0, 0, 1, 1][i])) return this.pairs.src.map(p => [...p]);
    const m = FULL_MARGIN; return [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]];
  }
  /** 镜像后的摄像头坐标 → 屏幕归一化坐标（可略超出 0–1）。 */
  map(x, y) {
    if (this.H) return applyHomography(this.H, x, y);
    const m = FULL_MARGIN; return [(x - m) / (1 - 2 * m), (y - m) / (1 - 2 * m)];
  }
}
