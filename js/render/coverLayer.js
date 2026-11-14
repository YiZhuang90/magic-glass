// 渲染层 · 雾气 / 泥巴覆盖层。
// 用低分辨率覆盖度掩码（Float32，每格 0–1）记录哪里还被盖着：擦除、比例统计、回雾都在掩码上做，
// 显示时把掩码放大（双线性插值让边缘自然柔和）再与纹理合成。
import { fbmField, makeRng } from './noise.js';
import { canvas } from './cardArt.js';

const MASK_SCALE = 4; // 掩码每格 = 4×4 渲染像素

export class CoverLayer {
  constructor() {
    this.w = 1; this.h = 1; this.type = 'fog';
    this.alpha = 1;
    this.drips = [];
    this.strength = { fog: 1.25, mud: 0.34 };
  }

  /** 换题或改尺寸时重建。cardFull：完整卡片画布（雾气下隐约透出）。 */
  build(w, h, type, cardFull, seed = 1) {
    this.w = w; this.h = h; this.type = type;
    this.mw = Math.ceil(w / MASK_SCALE); this.mh = Math.ceil(h / MASK_SCALE);
    this.cov = new Float32Array(this.mw * this.mh).fill(1);
    this.grit = buildGrit(this.mw, this.mh, type, seed);
    this.mask = canvas(this.mw, this.mh);
    this.mctx = this.mask.getContext('2d');
    this.img = this.mctx.createImageData(this.mw, this.mh);
    const d = this.img.data; for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255; }
    this.mctx.putImageData(this.img, 0, 0);
    this.comp = canvas(w, h); this.cctx = this.comp.getContext('2d');
    this.texture = type === 'mud' ? buildMud(w, h, seed) : buildFog(w, h, cardFull, seed);
    this.drips = [];
    this.alpha = 1;
    this.dirty = null;
    this._ratio = 0; this._ratioAt = 0;
    this._compose(0, 0, this.mw - 1, this.mh - 1);
  }

  /** 沿线段盖章擦除。坐标为渲染像素。 */
  wipe(x0, y0, x1, y1, r) {
    const S = MASK_SCALE, rr = Math.max(1.5, r / S);
    const strength = this.strength[this.type] ?? 1;
    const mx0 = x0 / S, my0 = y0 / S, mx1 = x1 / S, my1 = y1 / S;
    const len = Math.hypot(mx1 - mx0, my1 - my0);
    const spacing = Math.max(0.8, rr * 0.35);
    if (len < 0.5) { this._stamp(mx1, my1, rr, strength * 0.22); return; }
    const n = Math.ceil(len / spacing);
    const per = strength / Math.max(1, (2 * rr) / spacing) * 1.6;
    for (let i = 1; i <= n; i++) {
      const t = i / n; this._stamp(mx0 + (mx1 - mx0) * t, my0 + (my1 - my0) * t, rr, per);
    }
  }

  _stamp(cx, cy, rr, amount) {
    const { mw, mh, cov, grit } = this;
    const xa = Math.max(0, Math.floor(cx - rr)), xb = Math.min(mw - 1, Math.ceil(cx + rr));
    const ya = Math.max(0, Math.floor(cy - rr)), yb = Math.min(mh - 1, Math.ceil(cy + rr));
    if (xa > xb || ya > yb) return;
    const r2 = rr * rr;
    for (let y = ya; y <= yb; y++) {
      const dy = y - cy, row = y * mw;
      for (let x = xa; x <= xb; x++) {
        const dx = x - cx, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const i = row + x;
        if (cov[i] <= 0) continue;
        let t = 1 - Math.sqrt(d2) / rr; t = t > 0.55 ? 1 : t / 0.55; t = t * t * (3 - 2 * t);
        const v = cov[i] - amount * t * grit[i];
        cov[i] = v < 0 ? 0 : v;
      }
    }
    this._markDirty(xa, ya, xb, yb);
  }

  _markDirty(xa, ya, xb, yb) {
    const d = this.dirty;
    if (!d) this.dirty = [xa, ya, xb, yb];
    else { d[0] = Math.min(d[0], xa); d[1] = Math.min(d[1], ya); d[2] = Math.max(d[2], xb); d[3] = Math.max(d[3], yb); }
  }

  /** 只更新变化区域：掩码像素 → 合成层（掩码放大 + 纹理 source-in）。每帧只剩一次整屏 drawImage。 */
  _flush() {
    const [xa, ya, xb, yb] = this.dirty, { mw, cov } = this, data = this.img.data;
    this.dirty = null;
    const mud = this.type === 'mud'; // 泥巴是厚的：擦掉一半时仍大部分不透明
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      const c = cov[y * mw + x];
      data[(y * mw + x) * 4 + 3] = (mud ? Math.max(0, Math.min(1, c * 1.8 - 0.1)) : c) * 255;
    }
    this.mctx.putImageData(this.img, 0, 0, xa, ya, xb - xa + 1, yb - ya + 1);
    this._compose(xa, ya, xb, yb);
  }

  _compose(xa, ya, xb, yb) {
    const S = MASK_SCALE, c = this.cctx;
    // 多取 1 格让双线性插值的边缘连续
    const sx = Math.max(0, xa - 1), sy = Math.max(0, ya - 1), ex = Math.min(this.mw, xb + 2), ey = Math.min(this.mh, yb + 2);
    const px = xa * S, py = ya * S, pw = (xb - xa + 1) * S, ph = (yb - ya + 1) * S;
    c.save();
    c.beginPath(); c.rect(px, py, pw, ph); c.clip();
    c.globalCompositeOperation = 'copy';
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'medium';
    c.drawImage(this.mask, sx, sy, ex - sx, ey - sy, sx * S, sy * S, (ex - sx) * S, (ey - sy) * S);
    c.globalCompositeOperation = 'source-in';
    c.drawImage(this.texture, px, py, pw, ph, px, py, pw, ph);
    c.restore();
  }

  /** 缓慢回雾：每秒恢复 rate 的覆盖度。 */
  refog(dt, rate) {
    const add = rate * dt, cov = this.cov;
    for (let i = 0; i < cov.length; i++) { const v = cov[i] + add; cov[i] = v > 1 ? 1 : v; }
    this._markDirty(0, 0, this.mw - 1, this.mh - 1);
  }

  /** 是否仍被覆盖（用于生成水滴）。 */
  coverageAt(x, y) {
    const mx = Math.floor(x / MASK_SCALE), my = Math.floor(y / MASK_SCALE);
    if (mx < 0 || my < 0 || mx >= this.mw || my >= this.mh) return 0;
    return this.cov[my * this.mw + mx];
  }

  /** 擦开比例：覆盖度 < 0.25 的格子占比。隔格采样，开销很小。 */
  clearedRatio(force = false) {
    const now = performance.now();
    if (!force && now - (this._ratioAt || 0) < 200) return this._ratio; // 节流：每 200 ms 统计一次
    this._ratioAt = now;
    const { cov, mw, mh } = this; let n = 0, c = 0;
    for (let y = 0; y < mh; y += 2) for (let x = 0; x < mw; x += 2) { n++; if (cov[y * mw + x] < 0.25) c++; }
    this._ratio = n ? c / n : 0;
    return this._ratio;
  }

  // ---------- 水滴（雾气模式）：从擦痕下沿流下，留下一道清晰的水痕 ----------
  maybeSpawnDrip(x, y, r) {
    if (this.type !== 'fog' || this.drips.length > 45 || Math.random() > 0.05) return;
    const px = x + (Math.random() - 0.5) * r * 1.2, py = y + r * 0.9;
    if (this.coverageAt(px, py + 6) < 0.6) return;
    const size = (2.5 + Math.random() * 3.5) * Math.max(1, this.w / 1400);
    this.drips.push({ x: px, y: py, r: size, v: 0, life: 2 + Math.random() * 4, pause: Math.random() * 0.4 });
  }

  updateDrips(dt) {
    for (const d of this.drips) {
      d.life -= dt;
      if (d.pause > 0) { d.pause -= dt; continue; }
      d.v = Math.min(140, d.v + 160 * dt);
      if (Math.random() < 0.02) { d.pause = 0.15 + Math.random() * 0.5; d.v = 0; }
      const y0 = d.y; d.y += d.v * dt; d.x += (Math.random() - 0.5) * 0.6;
      const S = MASK_SCALE, rr = Math.max(1, d.r * 0.9 / S);
      for (let y = y0; y <= d.y; y += S * 0.6) this._stamp(d.x / S, y / S, rr, 0.5);
    }
    this.drips = this.drips.filter(d => d.life > 0 && d.y < this.h + 10);
  }

  render(ctx) {
    if (this.alpha <= 0.001) return;
    if (this.dirty) this._flush();
    ctx.save(); ctx.globalAlpha = this.alpha; ctx.drawImage(this.comp, 0, 0); ctx.restore();
    // 水滴
    for (const d of this.drips) drawDrop(ctx, d.x, d.y, d.r, this.alpha);
  }
}

function drawDrop(ctx, x, y, r, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(220,235,245,0.35)'); g.addColorStop(1, 'rgba(90,110,130,0.45)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function buildGrit(mw, mh, type, seed) {
  const g = new Float32Array(mw * mh);
  if (type === 'mud') {
    const f = fbmField(mw, mh, { scale: 0.06, octaves: 3, seed: seed + 11 });
    for (let i = 0; i < g.length; i++) g[i] = 0.45 + f[i] * 1.2; // 泥巴厚薄不均，擦出条纹
  } else {
    const f = fbmField(mw, mh, { scale: 0.05, octaves: 2, seed: seed + 3 });
    for (let i = 0; i < g.length; i++) g[i] = 0.85 + f[i] * 0.3;
  }
  return g;
}

/** 雾气：模糊透出的画面 + 白雾 + 云状浓淡 + 细颗粒 + 小水珠 */
function buildFog(w, h, cardFull, seed) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const minD = Math.min(w, h), rng = makeRng(seed + 5);
  ctx.fillStyle = '#dfe8ef'; ctx.fillRect(0, 0, w, h);
  if (cardFull) {
    // 模糊只在换题时做一次，并且在 1/4 分辨率上做（大半径模糊开销小很多，放大后效果一样）
    const sw = Math.ceil(w / 4), sh = Math.ceil(h / 4), small = canvas(sw, sh), sc = small.getContext('2d');
    sc.filter = `blur(${Math.max(2, Math.round(minD * 0.035 / 4))}px) saturate(0.8) brightness(1.1)`;
    sc.drawImage(cardFull, 0, 0, sw, sh);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(small, 0, 0, w, h);
  }
  ctx.fillStyle = 'rgba(234,241,247,0.70)'; ctx.fillRect(0, 0, w, h);
  // 下方更浓（冷凝）
  const vg = ctx.createLinearGradient(0, 0, 0, h);
  vg.addColorStop(0, 'rgba(255,255,255,0.0)'); vg.addColorStop(1, 'rgba(250,252,255,0.28)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  // 云状浓淡
  const lw = Math.ceil(w / 6), lh = Math.ceil(h / 6);
  const f = fbmField(lw, lh, { scale: 0.035, octaves: 5, seed });
  const cl = canvas(lw, lh), cx = cl.getContext('2d'), id = cx.createImageData(lw, lh);
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v > 0.5) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = (v - 0.5) * 2 * 120; }
    else { id.data[i * 4] = 170; id.data[i * 4 + 1] = 185; id.data[i * 4 + 2] = 200; id.data[i * 4 + 3] = (0.5 - v) * 2 * 50; }
  }
  cx.putImageData(id, 0, 0);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cl, 0, 0, w, h);
  // 细颗粒
  ctx.fillStyle = pattern(ctx, 'fog', seed);
  ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
  // 小水珠
  const n = Math.round((w * h) / 2600);
  for (let i = 0; i < n; i++) {
    const big = rng() < 0.06;
    const r = (big ? 4 + rng() * 6 : 0.8 + rng() * 2.2) * Math.max(1, minD / 900);
    const x = rng() * w, y = rng() * h;
    ctx.fillStyle = 'rgba(110,130,150,0.22)'; ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.25, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(250,253,255,0.65)'; ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

/** 泥巴：深浅棕色斑块 + 裂纹 + 湿润高光 + 沙粒 */
function buildMud(w, h, seed) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  const minD = Math.min(w, h), rng = makeRng(seed + 9);
  const lw = Math.ceil(w / 4), lh = Math.ceil(h / 4);
  const f = fbmField(lw, lh, { scale: 0.03, octaves: 5, seed });
  const f2 = fbmField(lw, lh, { scale: 0.08, octaves: 3, seed: seed + 1 });
  const cl = canvas(lw, lh), cx = cl.getContext('2d'), id = cx.createImageData(lw, lh);
  const dark = [62, 38, 20], mid = [110, 70, 38], light = [150, 102, 58];
  for (let i = 0; i < f.length; i++) {
    const v = Math.min(1, Math.max(0, (f[i] - 0.25) * 2)), wv = f2[i];
    const a = v < 0.5 ? lerp3(dark, mid, v * 2) : lerp3(mid, light, (v - 0.5) * 2);
    const k = 0.85 + wv * 0.3;
    id.data[i * 4] = a[0] * k; id.data[i * 4 + 1] = a[1] * k; id.data[i * 4 + 2] = a[2] * k; id.data[i * 4 + 3] = 255;
  }
  cx.putImageData(id, 0, 0);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cl, 0, 0, w, h);
  // 斑块
  for (let i = 0; i < 90; i++) {
    const x = rng() * w, y = rng() * h, r = minD * (0.03 + rng() * 0.12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const col = rng() < 0.5 ? '70,42,22' : '135,92,52';
    g.addColorStop(0, `rgba(${col},${0.35 + rng() * 0.3})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // 裂纹
  ctx.lineCap = 'round';
  for (let i = 0; i < 28; i++) {
    let x = rng() * w, y = rng() * h, a = rng() * Math.PI * 2;
    const pts = [[x, y]];
    for (let k = 0; k < 6 + rng() * 10; k++) { a += (rng() - 0.5) * 1.2; const s = minD * (0.01 + rng() * 0.025); x += Math.cos(a) * s; y += Math.sin(a) * s; pts.push([x, y]); }
    ctx.strokeStyle = 'rgba(180,135,90,0.35)'; ctx.lineWidth = 2.5; path(ctx, pts, 1, 1); ctx.stroke();
    ctx.strokeStyle = 'rgba(35,20,10,0.75)'; ctx.lineWidth = 1.6; path(ctx, pts, 0, 0); ctx.stroke();
  }
  // 湿润高光
  for (let i = 0; i < 140; i++) {
    const x = rng() * w, y = rng() * h, r = minD * (0.004 + rng() * 0.018);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,240,220,0.45)'); g.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // 沙粒
  ctx.fillStyle = pattern(ctx, 'mud', seed); ctx.fillRect(0, 0, w, h);
  // 泥点
  for (let i = 0; i < 60; i++) {
    const x = rng() * w, y = rng() * h, r = minD * (0.003 + rng() * 0.01);
    ctx.fillStyle = rng() < 0.5 ? 'rgba(50,30,15,0.8)' : 'rgba(160,115,70,0.7)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function pattern(ctx, type, seed) {
  const s = 192, p = canvas(s, s), pc = p.getContext('2d'), rng = makeRng(seed + 77), id = pc.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = rng();
    if (type === 'fog') { const c = v > 0.5 ? 255 : 150; id.data[i * 4] = id.data[i * 4 + 1] = c; id.data[i * 4 + 2] = c + (c < 255 ? 20 : 0); id.data[i * 4 + 3] = Math.abs(v - 0.5) * 60; }
    else { const c = v > 0.5 ? 200 : 30; id.data[i * 4] = c; id.data[i * 4 + 1] = c * 0.75; id.data[i * 4 + 2] = c * 0.5; id.data[i * 4 + 3] = rng() < 0.25 ? 90 : 0; }
  }
  pc.putImageData(id, 0, 0);
  return ctx.createPattern(p, 'repeat');
}
function path(ctx, pts, ox, oy) { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)); }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
