// 湿颜料画布：低分辨率网格，每格存 Mixbox 潜空间颜色（7 维）+ 颜料厚度。
// 所有混色都只在笔刷覆盖的格子里做；显示时只重算变化区域的像素，再整体放大绘制。
import { LATENT, toRgb } from './mixer.js';
import { canvas } from '../render/cardArt.js';
import { makeRng } from '../render/noise.js';

export const CELL = 3; // 每格 3×3 渲染像素

export class PaintCanvas {
  constructor(rect) {
    this.rect = rect;
    this.gw = Math.ceil(rect.w / CELL); this.gh = Math.ceil(rect.h / CELL);
    const n = this.gw * this.gh;
    this.lat = new Float32Array(n * LATENT);
    this.amt = new Float32Array(n);
    this.cv = canvas(this.gw, this.gh); this.cx = this.cv.getContext('2d');
    this.img = this.cx.createImageData(this.gw, this.gh);
    this.dirty = [];
    this.undo = [];
    const rng = makeRng(42);
    // 刷毛条纹表：沿笔触方向连续，垂直方向起伏
    const raw = Array.from({ length: 256 }, () => rng());
    this.bristle = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.bristle[i] = (raw[i] * 2 + raw[(i + 1) & 255] + raw[(i + 255) & 255]) / 4;
    this._rgb = [0, 0, 0];
    this.paper = makePaper(rect.w, rect.h);
  }

  toCell(x, y) { return [(x - this.rect.x) / CELL, (y - this.rect.y) / CELL]; }
  inside(x, y) { const r = this.rect; return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h; }

  /**
   * 沿线段涂抹。brush = { lat: Float32Array(7), amount: 0–1, seed }，会被修改（颜料变少、被画布沾染）。
   * 返回本次消耗的颜料量。brush.fixed = true 时颜色保持不变（不被画布沾染、不会用完），混色只发生在画纸上。
   */
  stroke(x0, y0, x1, y1, r, brush) {
    if (brush.amount <= 0.005) return 0;
    const [a0, b0] = this.toCell(x0, y0), [a1, b1] = this.toCell(x1, y1);
    const rr = Math.max(1.5, r / CELL);
    let dx = a1 - a0, dy = b1 - b0; const len = Math.hypot(dx, dy);
    if (len > 0.01) { dx /= len; dy /= len; brush.dir = [dx, dy]; } else { [dx, dy] = brush.dir || [1, 0]; }
    const spacing = Math.max(0.8, rr * 0.3);
    const n = Math.max(1, Math.ceil(len / spacing));
    const still = len < 0.5;
    let used = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      used += this._stamp(a0 + (a1 - a0) * t, b0 + (b1 - b0) * t, rr, brush, dx, dy, still ? 0.15 : 1);
      if (brush.amount <= 0.005) break;
    }
    return used;
  }

  _stamp(cx, cy, rr, brush, dx, dy, k) {
    const { gw, gh, lat, amt, bristle } = this, hl = brush.lat;
    const xa = Math.max(0, Math.floor(cx - rr)), xb = Math.min(gw - 1, Math.ceil(cx + rr));
    const ya = Math.max(0, Math.floor(cy - rr)), yb = Math.min(gh - 1, Math.ceil(cy + rr));
    if (xa > xb || ya > yb) return 0;
    const load = Math.sqrt(brush.amount);
    const dep0 = 0.22 * load * k;
    const r2 = rr * rr, seed = brush.seed || 0;
    let pickW = 0, pickA = 0; const pick = this._pick || (this._pick = new Float32Array(LATENT)); pick.fill(0);
    let used = 0;
    for (let y = ya; y <= yb; y++) {
      const oy = y - cy;
      for (let x = xa; x <= xb; x++) {
        const ox = x - cx, d2 = ox * ox + oy * oy;
        if (d2 >= r2) continue;
        let f = 1 - Math.sqrt(d2) / rr; f = f > 0.4 ? 1 : f / 0.4; f = f * f * (3 - 2 * f);
        // 刷毛条纹：按垂直于笔触方向的位置取值
        const perp = ox * -dy + oy * dx;
        const bi = ((perp * 1.4 + seed) | 0) & 255;
        const br = 0.45 + 1.1 * bristle[bi];
        const i = y * gw + x, o = i * LATENT, a = amt[i];
        // 记录画布原有颜料（用于手上颜料被沾染）
        if (a > 0.02) { const w = f * a; pickW += f; pickA += w; for (let c = 0; c < LATENT; c++) pick[c] += lat[o + c] * w; }
        const d = dep0 * f * br;
        if (d <= 0) continue;
        // 画布颜料 + 手上颜料：按量在潜空间混合（减色）
        const tot = a + d, wa = a / tot, wd = d / tot;
        for (let c = 0; c < LATENT; c++) lat[o + c] = lat[o + c] * wa + hl[c] * wd;
        amt[i] = tot > 1.6 ? 1.6 : tot;
        used += d;
      }
    }
    // 手上的颜料被画布沾染（湿画布越厚，沾得越多）
    if (!brush.fixed && pickA > 0 && pickW > 0) {
      const cover = pickA / pickW; // 平均厚度
      const kp = Math.min(0.05, 0.008 * cover * k);
      for (let c = 0; c < LATENT; c++) hl[c] = hl[c] * (1 - kp) + (pick[c] / pickA) * kp;
    }
    if (!brush.fixed) brush.amount = Math.max(0, brush.amount - used / 36000); // fixed：选中的颜色不变、不会用完
    this.dirty.push([Math.max(0, xa - 1), Math.max(0, ya - 1), Math.min(gw - 1, xb + 1), Math.min(gh - 1, yb + 1)]);
    return used;
  }

  /** 橡皮擦：沿线段把圆形区域擦回白纸（边缘柔和）。返回擦掉的颜料量。 */
  erase(x0, y0, x1, y1, r) {
    const [a0, b0] = this.toCell(x0, y0), [a1, b1] = this.toCell(x1, y1);
    const rr = Math.max(2, r / CELL), len = Math.hypot(a1 - a0, b1 - b0);
    const n = Math.max(1, Math.ceil(len / Math.max(1, rr * 0.35)));
    let removed = 0;
    for (let k = 1; k <= n; k++) removed += this._eraseDot(a0 + (a1 - a0) * k / n, b0 + (b1 - b0) * k / n, rr);
    return removed;
  }
  _eraseDot(cx, cy, rr) {
    const { gw, gh, amt } = this;
    const xa = Math.max(0, Math.floor(cx - rr)), xb = Math.min(gw - 1, Math.ceil(cx + rr));
    const ya = Math.max(0, Math.floor(cy - rr)), yb = Math.min(gh - 1, Math.ceil(cy + rr));
    if (xa > xb || ya > yb) return 0;
    const r2 = rr * rr; let removed = 0;
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const ox = x - cx, oy = y - cy, d2 = ox * ox + oy * oy;
      if (d2 >= r2) continue;
      const i = y * gw + x, a = amt[i]; if (a <= 0) continue;
      const f = 1 - Math.sqrt(d2) / rr, keep = f > 0.25 ? 0 : 1 - f / 0.25; // 中心直接擦干净，边缘渐变
      const na = a * keep < 0.02 ? 0 : a * keep;
      removed += a - na; amt[i] = na;
    }
    this.dirty.push([Math.max(0, xa - 1), Math.max(0, ya - 1), Math.min(gw - 1, xb + 1), Math.min(gh - 1, yb + 1)]);
    return removed;
  }

  /** 读取某点的颜色和厚度 */
  sample(x, y) {
    const [a, b] = this.toCell(x, y), i = Math.round(b) * this.gw + Math.round(a);
    if (a < 0 || b < 0 || a >= this.gw || b >= this.gh || this.amt[i] < 0.02) return null;
    return { rgb: toRgb(this.lat, [0, 0, 0], i * LATENT), amount: this.amt[i] };
  }

  snapshot() {
    this.undo.push({ lat: this.lat.slice(), amt: this.amt.slice() });
    if (this.undo.length > 8) this.undo.shift();
  }
  restore() {
    const s = this.undo.pop(); if (!s) return false;
    this.lat.set(s.lat); this.amt.set(s.amt); this.dirty.push([0, 0, this.gw - 1, this.gh - 1]); return true;
  }
  clear() { this.snapshot(); this.lat.fill(0); this.amt.fill(0); this.dirty.push([0, 0, this.gw - 1, this.gh - 1]); }

  _flush() {
    if (!this.dirty.length) return;
    const { gw, gh, lat, amt } = this, data = this.img.data, rgb = this._rgb;
    let ux0 = gw, uy0 = gh, ux1 = 0, uy1 = 0;
    for (const [xa, ya, xb, yb] of this.dirty) {
      ux0 = Math.min(ux0, xa); uy0 = Math.min(uy0, ya); ux1 = Math.max(ux1, xb); uy1 = Math.max(uy1, yb);
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
        const i = y * gw + x, p = i * 4, a = amt[i];
        if (a < 0.02) { data[p + 3] = 0; continue; }
        toRgb(lat, rgb, i * LATENT);
        // 湿颜料质感：厚度起伏产生的光照（左上方光源）+ 高光
        const l = x > 0 ? amt[i - 1] : a, r = x < gw - 1 ? amt[i + 1] : a, u = y > 0 ? amt[i - gw] : a, dn = y < gh - 1 ? amt[i + gw] : a;
        let sh = (l - r + u - dn) * 1.3; sh = sh < -0.5 ? -0.5 : sh > 0.5 ? 0.5 : sh;
        const spec = sh > 0.12 ? (sh - 0.12) * 380 : 0;
        const m = 1 + sh * 0.45;
        data[p] = clamp255(rgb[0] * m + spec); data[p + 1] = clamp255(rgb[1] * m + spec); data[p + 2] = clamp255(rgb[2] * m + spec);
        const cov = a > 0.3 ? 1 : a / 0.3; data[p + 3] = cov * 255;
      }
    }
    this.dirty.length = 0;
    this.cx.putImageData(this.img, 0, 0, ux0, uy0, ux1 - ux0 + 1, uy1 - uy0 + 1);
  }

  render(ctx) {
    this._flush();
    const r = this.rect;
    ctx.drawImage(this.paper, r.x, r.y);
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.cv, r.x, r.y, this.gw * CELL, this.gh * CELL); ctx.restore();
  }

  /** 导出画作（纸 + 颜料 + 线稿）为 PNG Blob */
  toBlob(lineArt) {
    this._flush();
    const r = this.rect, c = canvas(r.w, r.h), x = c.getContext('2d');
    x.drawImage(this.paper, 0, 0); x.imageSmoothingQuality = 'high'; x.drawImage(this.cv, 0, 0, this.gw * CELL, this.gh * CELL);
    if (lineArt) x.drawImage(lineArt, 0, 0);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }
}

const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

/** 水彩纸纹理（只生成一次） */
function makePaper(w, h) {
  const c = canvas(w, h), x = c.getContext('2d'), rng = makeRng(9);
  x.fillStyle = '#fbf8f1'; x.fillRect(0, 0, w, h);
  const t = canvas(128, 128), tx = t.getContext('2d'), id = tx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = rng(); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v > 0.5 ? 255 : 170; id.data[i * 4 + 3] = Math.abs(v - 0.5) * 40; }
  tx.putImageData(id, 0, 0);
  x.fillStyle = x.createPattern(t, 'repeat'); x.fillRect(0, 0, w, h);
  return c;
}
