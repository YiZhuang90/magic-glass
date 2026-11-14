// 渲染层 · 卡通虚拟手：手掌 + 五根手指，圆润、描边、半透明，与真实手的 21 个关键点一一对应。
// 每只手先画到一张只有手那么大的离屏小画布上，再整体以半透明合成，避免重叠处颜色变深。
import { canvas } from './cardArt.js';

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const PALM = [0, 1, 5, 9, 13, 17];
const layers = new Map();

/**
 * decor: { sponge?: 'fog'|'mud', paint?: { rgb, amount }, eraser?: bool, grab?: 0–1,
 *          tip?: { x, y, r, tool: null|'paint'|'eraser', rgb, active, pose, mouse } }
 */
export function drawHand(ctx, hand, decor = {}) {
  const pts = hand.pts, S = hand.size;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const pad = S * 0.5;
  const bx = Math.floor(minX - pad), by = Math.floor(minY - pad), bw = Math.ceil(maxX - minX + pad * 2), bh = Math.ceil(maxY - minY + pad * 2);
  let L = layers.get(hand.id);
  if (!L || L.width < bw || L.height < bh) { L = canvas(Math.max(bw, L?.width || 0), Math.max(bh, L?.height || 0)); layers.set(hand.id, L); }
  const c = L.getContext('2d');
  c.clearRect(0, 0, bw + 2, bh + 2);
  c.save(); c.translate(-bx, -by);
  const fw = S * 0.21;            // 手指粗细
  const ow = Math.max(3, S * 0.05); // 描边
  const { fill, stroke } = hand.style;
  c.lineCap = 'round'; c.lineJoin = 'round';
  // 描边层
  c.strokeStyle = stroke; c.fillStyle = stroke;
  palmPath(c, pts); c.lineWidth = fw * 1.1 + ow * 2; c.stroke(); c.fill();
  FINGERS.forEach((f, i) => { fingerPath(c, pts, f); c.lineWidth = (i === 0 ? fw * 1.1 : i === 4 ? fw * 0.85 : fw) + ow * 2; c.stroke(); });
  // 填充层
  c.strokeStyle = fill; c.fillStyle = fill;
  palmPath(c, pts); c.lineWidth = fw * 1.1; c.stroke(); c.fill();
  FINGERS.forEach((f, i) => { fingerPath(c, pts, f); c.lineWidth = i === 0 ? fw * 1.1 : i === 4 ? fw * 0.85 : fw; c.stroke(); });
  // 指甲高光
  c.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of FINGERS) {
    const t = pts[f[3]], p = pts[f[2]], dx = t[0] - p[0], dy = t[1] - p[1], l = Math.hypot(dx, dy) || 1;
    c.beginPath(); c.ellipse(t[0] - dx / l * fw * 0.12, t[1] - dy / l * fw * 0.12, fw * 0.22, fw * 0.3, Math.atan2(dy, dx) + Math.PI / 2, 0, Math.PI * 2); c.fill();
  }
  // 掌心小腮红
  const pc = palmCenter(pts);
  c.fillStyle = 'rgba(255,150,150,0.25)'; c.beginPath(); c.arc(pc[0], pc[1], S * 0.22, 0, Math.PI * 2); c.fill();
  c.restore();

  ctx.save();
  ctx.globalAlpha = hand.active === false ? 0.45 : 0.82;
  ctx.drawImage(L, 0, 0, bw, bh, bx, by, bw, bh);
  ctx.restore();

  // 手心装饰（不透明）
  if (decor.sponge) drawSponge(ctx, pc[0], pc[1] + S * 0.05, S * 0.5, decor.sponge);
  if (decor.paint) drawPaintBall(ctx, pc[0], pc[1], S, decor.paint);
  if (decor.eraser) drawEraserIcon(ctx, pc[0], pc[1], S * 0.62);
  if (decor.tip) drawTip(ctx, decor.tip, S);
  if (hand.person) drawPlayerBadge(ctx, hand, S);
  if (decor.grab > 0) {
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = S * 0.08; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(pc[0], pc[1], S * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * decor.grab); ctx.stroke(); ctx.restore();
  }
}

function palmPath(c, p) { c.beginPath(); PALM.forEach((i, k) => k ? c.lineTo(p[i][0], p[i][1]) : c.moveTo(p[i][0], p[i][1])); c.closePath(); }
function fingerPath(c, p, f) { c.beginPath(); c.moveTo(p[f[0]][0], p[f[0]][1]); for (let k = 1; k < f.length; k++) c.lineTo(p[f[k]][0], p[f[k]][1]); }
export function palmCenter(p) { const ids = [0, 5, 9, 13, 17]; let x = 0, y = 0; for (const i of ids) { x += p[i][0]; y += p[i][1]; } return [x / 5, y / 5]; }

/** 手心颜料球：大小和外圈表示剩余量 */
function drawPaintBall(ctx, x, y, S, { rgb, amount }) {
  const a = Math.max(0, Math.min(1, amount));
  const r = S * (0.14 + 0.2 * Math.sqrt(a));
  ctx.save();
  // 剩余量环
  ctx.lineCap = 'round'; ctx.lineWidth = S * 0.06;
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(x, y, S * 0.44, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; ctx.beginPath(); ctx.arc(x, y, S * 0.44, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * a); ctx.stroke();
  if (a > 0.01) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, `rgb(${Math.min(255, rgb[0] + 90)},${Math.min(255, rgb[1] + 90)},${Math.min(255, rgb[2] + 90)})`);
    g.addColorStop(0.45, `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`);
    g.addColorStop(1, `rgb(${rgb[0] * 0.6 | 0},${rgb[1] * 0.6 | 0},${rgb[2] * 0.6 | 0})`);
    ctx.fillStyle = g; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.4; ctx.shadowOffsetY = r * 0.15;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.4, r * 0.25, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * 笔尖光标（画画模式，画在食指指尖）：
 * - 画笔姿势（只伸食指）且有颜色：实心颜色点 + 发光 + 白色外圈，表示“正在画”
 * - 其他姿势：空心的颜色圈（虚线），只显示笔会落在哪里
 * - 橡皮擦：灰色虚线圈表示擦除范围，姿势正确时圈变实、中间出现小橡皮
 * - 还没选颜色：白色问号小圈
 */
function drawTip(ctx, t, S) {
  const { x, y, r } = t;
  const on = t.pose && t.tool;
  ctx.save();
  ctx.lineCap = 'round';
  if (t.tool === 'eraser') {
    ctx.fillStyle = on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = on ? '#ff5d8f' : 'rgba(80,80,100,0.8)'; ctx.lineWidth = Math.max(3, S * 0.04);
    if (!on) ctx.setLineDash([S * 0.08, S * 0.06]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    drawEraserIcon(ctx, x, y, Math.min(r * 1.1, S * 0.42), on ? 1 : 0.6);
  } else if (t.tool === 'paint') {
    const c = `rgb(${t.rgb[0]},${t.rgb[1]},${t.rgb[2]})`;
    if (on) {
      // 指尖发光
      const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.2);
      g.addColorStop(0, `rgba(${t.rgb[0]},${t.rgb[1]},${t.rgb[2]},0.6)`); g.addColorStop(1, `rgba(${t.rgb[0]},${t.rgb[1]},${t.rgb[2]},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c; ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(3, S * 0.045); ctx.beginPath(); ctx.arc(x, y, r + ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = Math.max(5, S * 0.07);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(3, S * 0.04); ctx.setLineDash([S * 0.08, S * 0.06]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(80,80,100,0.7)'; ctx.lineWidth = Math.max(2, S * 0.03); ctx.setLineDash([S * 0.06, S * 0.05]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(x, y, S * 0.13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#556'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${S * 0.16}px sans-serif`; ctx.fillText('?', x, y + S * 0.01);
  }
  ctx.restore();
}

/** 玩家标记（不是人脸图像）：手腕旁一个带号码的彩色小圆 + 左 / 右 */
export function drawPlayerBadge(ctx, hand, S) {
  const w = hand.pts[0], m = hand.pts[9];
  const dx = w[0] - m[0], dy = w[1] - m[1], l = Math.hypot(dx, dy) || 1;
  const x = w[0] + dx / l * S * 0.32, y = w[1] + dy / l * S * 0.32, r = S * 0.17;
  ctx.save();
  ctx.fillStyle = hand.style.stroke; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, S * 0.035);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.5;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${r * 1.25}px "Arial Rounded MT Bold","Nunito",sans-serif`;
  ctx.fillText(String(hand.person.slot), x, y + r * 0.06);
  if (hand.handed) {
    const t = hand.handed === 'left' ? '左' : '右', tx = x + r * 1.05, ty = y + r * 0.75, tr = r * 0.62;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tx, ty, tr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hand.style.stroke; ctx.lineWidth = Math.max(1.5, S * 0.02); ctx.stroke();
    ctx.fillStyle = '#2b2d42'; ctx.font = `800 ${tr * 1.15}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    ctx.fillText(t, tx, ty + tr * 0.05);
  }
  ctx.restore();
}

/** 玩家位置的淡色小标记（画在脸的位置附近，只有颜色和号码） */
export function drawPlayerMark(ctx, m, S) {
  ctx.save(); ctx.globalAlpha = m.fresh ? 0.55 : 0.25;
  const r = S * 0.2;
  ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * 0.15); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${r * 1.2}px "Arial Rounded MT Bold","Nunito",sans-serif`; ctx.fillText(String(m.slot), m.x, m.y + r * 0.06);
  ctx.restore();
}

/** 橡皮擦图标：斜放的粉色橡皮 + 蓝色纸套。w = 图标宽度 */
export function drawEraserIcon(ctx, x, y, w, alpha = 1) {
  const h = w * 0.42;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(-0.5);
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.04;
  ctx.fillStyle = '#ff8fab'; rr(ctx, -w / 2, -h / 2, w, h, h * 0.25); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#4d96ff'; rr(ctx, -w * 0.02, -h / 2, w * 0.52, h, h * 0.25); ctx.fill();
  ctx.fillRect(-w * 0.02, -h / 2, w * 0.1, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; rr(ctx, -w * 0.44, -h * 0.36, w * 0.34, h * 0.16, h * 0.08); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(1.5, w * 0.025); rr(ctx, -w / 2, -h / 2, w, h, h * 0.25); ctx.stroke();
  ctx.restore();
}

/** 小海绵（擦玻璃模式手心） */
export function drawSponge(ctx, x, y, w, type) {
  const h = w * 0.68;
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.15);
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = w * 0.12; ctx.shadowOffsetY = w * 0.05;
  ctx.fillStyle = type === 'mud' ? '#7ed957' : '#ffd84d';
  rr(ctx, -w / 2, -h / 2, w, h, h * 0.3); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = type === 'mud' ? '#3fa34d' : '#4caf50';
  rr(ctx, -w / 2, -h / 2, w, h * 0.28, h * 0.14); ctx.fill();
  ctx.fillStyle = 'rgba(160,110,0,0.35)';
  for (const [hx, hy, hr] of [[-0.28, 0.12, 0.07], [0.05, 0.25, 0.05], [0.3, 0.05, 0.08], [0.18, 0.3, 0.035], [-0.32, 0.32, 0.04]]) { ctx.beginPath(); ctx.arc(hx * w, hy * h * 1.2, hr * w, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(-w * 0.14, h * 0.05, w * 0.045, 0, Math.PI * 2); ctx.arc(w * 0.14, h * 0.05, w * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(2, w * 0.025); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, h * 0.13, w * 0.09, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
