// 渲染层 · 把擦玻璃的卡片变成可涂色的线稿（透明底 + 黑色线条，叠在颜料上方，像涂色本）。
import { renderCard, canvas, ROUND_FONT, ZH_FONT } from './cardArt.js';
import { loadImage } from '../content/cards.js';

/** 返回 w×h 的线稿画布 */
export async function makeLineArt(card, w, h) {
  const out = canvas(w, h), c = out.getContext('2d');
  const lw = Math.max(3, Math.min(w, h) * 0.006);
  if (card.image) {
    try { const img = await loadImage(card.image); edgesInto(c, img, 0, 0, w, h, true, lw); } catch {}
    return out;
  }
  const art = renderCard(card, w, h);
  const L = art.layout;
  c.lineJoin = 'round'; c.strokeStyle = '#222'; c.textAlign = 'center'; c.textBaseline = 'middle';
  // 字母：空心描边字
  c.font = `900 ${L.ls}px ${ROUND_FONT}`; c.lineWidth = lw * 1.6; c.strokeText(card.letter, L.lx, L.ly);
  // 单词：空心字
  c.font = `800 ${L.fs * 1.1}px ${ROUND_FONT}`; c.lineWidth = lw * 0.8;
  const t = `${card.word}  ${card.zh}`;
  c.font = `800 ${L.fs * 1.1}px ${ROUND_FONT}, ${ZH_FONT}`; c.strokeText(t, w / 2, L.ty);
  // 图画：对 emoji 做边缘检测
  if (art.emoji) {
    const b = art.emojiBox;
    edgesInto(c, art.emoji, b.x - b.s / 2, b.y - b.s / 2, b.s, b.s, false, lw);
  }
  return out;
}

/** Sobel 边缘检测，把线条画进 ctx 的 (x,y,w,h) 区域 */
function edgesInto(ctx, src, x, y, w, h, contain, lw) {
  let dw = w, dh = h, dx = x, dy = y;
  if (contain) { const k = Math.min(w / src.width, h / src.height) * 0.9; dw = src.width * k; dh = src.height * k; dx = x + (w - dw) / 2; dy = y + (h - dh) / 2; }
  const N = 360, k = N / Math.max(dw, dh), gw = Math.max(8, Math.round(dw * k)), gh = Math.max(8, Math.round(dh * k));
  const g = canvas(gw, gh), gc = g.getContext('2d', { willReadFrequently: true });
  gc.fillStyle = '#fff'; gc.fillRect(0, 0, gw, gh); gc.drawImage(src, 0, 0, gw, gh);
  const d = gc.getImageData(0, 0, gw, gh).data, L = new Float32Array(gw * gh);
  for (let i = 0; i < L.length; i++) L[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  const o = gc.createImageData(gw, gh), od = o.data;
  for (let yy = 1; yy < gh - 1; yy++) for (let xx = 1; xx < gw - 1; xx++) {
    const i = yy * gw + xx;
    const gx = -L[i - gw - 1] - 2 * L[i - 1] - L[i + gw - 1] + L[i - gw + 1] + 2 * L[i + 1] + L[i + gw + 1];
    const gy = -L[i - gw - 1] - 2 * L[i - gw] - L[i - gw + 1] + L[i + gw - 1] + 2 * L[i + gw] + L[i + gw + 1];
    const m = Math.hypot(gx, gy);
    if (m > 110) { od[i * 4] = od[i * 4 + 1] = od[i * 4 + 2] = 30; od[i * 4 + 3] = Math.min(255, (m - 110) * 2.5); }
  }
  gc.clearRect(0, 0, gw, gh); gc.putImageData(o, 0, 0);
  ctx.save(); ctx.imageSmoothingQuality = 'high';
  // 轻微加粗：错位画几次
  const t = lw * 0.35;
  for (const [ox, oy] of [[0, 0], [t, 0], [0, t], [t, t]]) ctx.drawImage(g, dx + ox, dy + oy, dw, dh);
  ctx.restore();
}
