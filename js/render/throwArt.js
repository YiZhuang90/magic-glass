// 渲染层 · 投水球：后院草坪场景、软萌小怪兽、水球、篮子。全部用 canvas 程序绘制。
// 场景分三层缓存成离屏图（天空 / 篱笆 + 草地 / 灌木），每帧只贴图；怪兽身体按颜色和大小缓存成小图。
import { canvas, roundRect, ZH_FONT } from './cardArt.js';
import { MONSTER_KINDS, spritesReady, spriteFor, spriteScale } from './monsterSprites.js';

export const LABEL_FONT = `"Arial Rounded MT Bold","Nunito",${ZH_FONT}`;
export const MONSTER_COLORS = [
  { body: '#7ed6a5', dark: '#3fae73', name: 'green' },
  { body: '#ff9ec7', dark: '#e2639b', name: 'pink' },
  { body: '#9ab8ff', dark: '#5b7fe0', name: 'blue' },
  { body: '#ffd166', dark: '#e0a526', name: 'yellow' },
  { body: '#c8a2ff', dark: '#9466e0', name: 'purple' },
  { body: '#ffae7a', dark: '#e57a3c', name: 'orange' },
];
export const BALLOON_COLORS = ['#4cc9f0', '#f72585', '#7bd389', '#ffbe0b', '#b388ff', '#ff7f51'];

// 固定种子的随机数：场景每次画出来都一样
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** 场景布局（只依赖画布尺寸）。所有可玩元素都放在 inset 以内，远离屏幕边。 */
export function sceneLayout(W, H) {
  const u = Math.min(W, H);
  const fenceTop = H * 0.31, fenceBot = H * 0.47, bushTop = H * 0.56, bushBot = H * 0.68;
  return {
    W, H, u, fenceTop, fenceBot, bushTop, bushBot,
    inset: { x0: W * 0.045, y0: H * 0.035, x1: W * 0.955, y1: H * 0.965 },
    rows: [
      // 远排：躲在篱笆后面，从篱笆上面探头
      { id: 'far', r: u * 0.074, hideY: fenceTop + u * 0.074 * 1.25, upY: fenceTop - u * 0.074 * 0.88, x0: W * 0.16, x1: W * 0.84 },
      // 近排：躲在灌木丛后面
      { id: 'near', r: u * 0.085, hideY: bushTop + u * 0.085 * 1.3, upY: bushTop - u * 0.085 * 1.05, x0: W * 0.13, x1: W * 0.87 },
    ],
    // 篮子：底部中间，离底边留出一段（孩子手放低也够得到，但不贴边）
    basket: { x: W * 0.5 - u * 0.13, y: H * 0.79, w: u * 0.26, h: u * 0.13 },
  };
}

export function drawSky(L) {
  const { W, H } = L, c = canvas(W, H), x = c.getContext('2d'), r = rng(7);
  const g = x.createLinearGradient(0, 0, 0, L.fenceBot);
  g.addColorStop(0, '#7cc6ff'); g.addColorStop(1, '#d7f0ff');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // 太阳
  x.fillStyle = 'rgba(255,236,150,0.55)'; x.beginPath(); x.arc(W * 0.86, H * 0.1, L.u * 0.11, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#ffe36e'; x.beginPath(); x.arc(W * 0.86, H * 0.1, L.u * 0.07, 0, Math.PI * 2); x.fill();
  // 云
  x.fillStyle = 'rgba(255,255,255,0.92)';
  for (let i = 0; i < 4; i++) {
    const cx = W * (0.12 + i * 0.22 + r() * 0.06), cy = H * (0.07 + r() * 0.12), s = L.u * (0.05 + r() * 0.03);
    for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(cx + (k - 2) * s * 0.8, cy + Math.abs(k - 2) * s * 0.18, s * (1 - Math.abs(k - 2) * 0.18), 0, Math.PI * 2); x.fill(); }
  }
  return c;
}

/** 篱笆 + 草地（篱笆以上透明，远排怪兽画在这一层下面，就像躲在篱笆后面） */
export function drawMid(L) {
  const { W, H, u } = L, c = canvas(W, H), x = c.getContext('2d'), r = rng(11);
  // 草地
  const g = x.createLinearGradient(0, L.fenceBot, 0, H);
  g.addColorStop(0, '#8fd16a'); g.addColorStop(1, '#5fb246');
  x.fillStyle = g; x.fillRect(0, L.fenceBot, W, H - L.fenceBot);
  // 远处的树篱
  x.fillStyle = '#6cbf55';
  for (let i = 0; i <= 24; i++) { x.beginPath(); x.arc(i * W / 24, L.fenceBot, u * 0.03 + r() * u * 0.015, Math.PI, 0); x.fill(); }
  // 篱笆：木桩 + 两条横杆
  const pw = u * 0.055, gap = u * 0.022, n = Math.ceil(W / (pw + gap)) + 1;
  x.fillStyle = '#d9a066'; x.strokeStyle = '#a86a3a'; x.lineWidth = Math.max(2, u * 0.004);
  const railH = u * 0.025;
  for (const ry of [L.fenceTop + (L.fenceBot - L.fenceTop) * 0.3, L.fenceTop + (L.fenceBot - L.fenceTop) * 0.72]) {
    x.fillRect(0, ry, W, railH); x.strokeRect(-2, ry, W + 4, railH);
  }
  for (let i = 0; i < n; i++) {
    const px = i * (pw + gap) - gap, top = L.fenceTop + (i % 2) * u * 0.008;
    x.fillStyle = i % 3 === 0 ? '#e4ad73' : '#ddb27c';
    x.beginPath(); x.moveTo(px, L.fenceBot); x.lineTo(px, top + pw * 0.4); x.lineTo(px + pw / 2, top); x.lineTo(px + pw, top + pw * 0.4); x.lineTo(px + pw, L.fenceBot); x.closePath();
    x.fill(); x.stroke();
  }
  // 草地上的小花和草丛
  for (let i = 0; i < 70; i++) {
    const fx = r() * W, fy = L.fenceBot + u * 0.03 + r() * (H - L.fenceBot - u * 0.04);
    if (r() < 0.6) { x.strokeStyle = 'rgba(40,120,40,0.5)'; x.lineWidth = 2; x.beginPath(); x.moveTo(fx, fy); x.lineTo(fx - 4, fy - 10); x.moveTo(fx, fy); x.lineTo(fx + 4, fy - 11); x.stroke(); }
    else { x.fillStyle = ['#fff', '#ffe066', '#ff99c8'][i % 3]; for (let k = 0; k < 5; k++) { const a = k * 1.256; x.beginPath(); x.arc(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4, 0, Math.PI * 2); x.fill(); } x.fillStyle = '#ffb703'; x.beginPath(); x.arc(fx, fy, 3, 0, Math.PI * 2); x.fill(); }
  }
  return c;
}

/** 前景灌木丛（透明背景；近排怪兽画在这层下面） */
export function drawBushes(L) {
  const { W, H, u } = L, c = canvas(W, H), x = c.getContext('2d'), r = rng(23);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * W / n + (r() - 0.5) * W * 0.02;
    for (let k = 0; k < 6; k++) {
      const bx = cx + (k - 2.5) * u * 0.05 + (r() - 0.5) * u * 0.02, by = L.bushTop + u * 0.06 + r() * u * 0.03, br = u * (0.055 + r() * 0.025);
      x.fillStyle = k % 2 ? '#3f9a3a' : '#4fae45'; x.beginPath(); x.arc(bx, by, br, 0, Math.PI * 2); x.fill();
    }
  }
  x.fillStyle = '#3f9a3a'; x.fillRect(0, L.bushTop + u * 0.07, W, L.bushBot - L.bushTop - u * 0.07);
  // 高光和小浆果
  for (let i = 0; i < 40; i++) {
    const bx = r() * W, by = L.bushTop + u * 0.02 + r() * (L.bushBot - L.bushTop - u * 0.03);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.beginPath(); x.arc(bx, by, u * 0.018, 0, Math.PI * 2); x.fill();
    if (i % 4 === 0) { x.fillStyle = '#ff5d73'; x.beginPath(); x.arc(bx + 6, by + 4, u * 0.007, 0, Math.PI * 2); x.fill(); }
  }
  // 灌木下沿的阴影
  const g = x.createLinearGradient(0, L.bushBot - u * 0.01, 0, L.bushBot + u * 0.03);
  g.addColorStop(0, 'rgba(30,80,20,0.35)'); g.addColorStop(1, 'rgba(30,80,20,0)');
  x.fillStyle = g; x.fillRect(0, L.bushBot - u * 0.01, W, u * 0.04);
  return c;
}

const bodyCache = new Map();
/** 怪兽身体（不含眼睛 / 嘴巴 / 标签）：圆滚滚的团子 + 小角 + 小脚 + 腮红。缓存。 */
function monsterBody(col, r, variant) {
  const key = col.name + '|' + Math.round(r) + '|' + variant;
  let c = bodyCache.get(key); if (c) return c;
  const s = Math.ceil(r * 3.0); c = canvas(s, s); const x = c.getContext('2d'); const cx = s / 2, cy = s / 2 + r * 0.15;
  x.lineWidth = Math.max(3, r * 0.07); x.strokeStyle = col.dark; x.lineJoin = 'round';
  // 小角 / 小耳朵
  x.fillStyle = col.body;
  if (variant % 3 === 0) { for (const sx of [-1, 1]) { x.beginPath(); x.moveTo(cx + sx * r * 0.35, cy - r * 0.8); x.lineTo(cx + sx * r * 0.55, cy - r * 1.32); x.lineTo(cx + sx * r * 0.72, cy - r * 0.62); x.closePath(); x.fill(); x.stroke(); } }
  else if (variant % 3 === 1) { for (const sx of [-1, 1]) { x.beginPath(); x.arc(cx + sx * r * 0.62, cy - r * 0.78, r * 0.26, 0, Math.PI * 2); x.fill(); x.stroke(); } }
  else { x.beginPath(); x.moveTo(cx, cy - r * 0.95); x.quadraticCurveTo(cx + r * 0.1, cy - r * 1.45, cx + r * 0.32, cy - r * 1.35); x.stroke(); x.fillStyle = '#ffef7a'; x.beginPath(); x.arc(cx + r * 0.34, cy - r * 1.35, r * 0.13, 0, Math.PI * 2); x.fill(); x.stroke(); x.fillStyle = col.body; }
  // 小脚
  for (const sx of [-1, 1]) { x.beginPath(); x.ellipse(cx + sx * r * 0.45, cy + r * 0.92, r * 0.26, r * 0.16, 0, 0, Math.PI * 2); x.fill(); x.stroke(); }
  // 身体：略扁的团子
  x.beginPath(); x.ellipse(cx, cy, r * 1.0, r * 0.95, 0, 0, Math.PI * 2);
  const g = x.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.1, cx, cy, r * 1.05);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, col.body); g.addColorStop(1, col.body);
  x.fillStyle = g; x.fill(); x.stroke();
  // 肚皮（放标签的地方）
  x.fillStyle = 'rgba(255,255,255,0.75)'; x.beginPath(); x.ellipse(cx, cy + r * 0.42, r * 0.56, r * 0.42, 0, 0, Math.PI * 2); x.fill();
  // 腮红
  x.fillStyle = 'rgba(255,110,140,0.45)';
  for (const sx of [-1, 1]) { x.beginPath(); x.ellipse(cx + sx * r * 0.64, cy - r * 0.2, r * 0.15, r * 0.09, 0, 0, Math.PI * 2); x.fill(); }
  c.ox = cx; c.oy = cy; bodyCache.set(key, c);
  return c;
}

/**
 * 画一只怪兽。m: { x, cy（身体中心）, r, col, variant, label, wet(0–1), mood: 'happy'|'giggle'|'wet'|'surprise', t, squash, blink }
 */
export function drawMonster(ctx, m) {
  if (m.kind != null && spritesReady()) { const spr = spriteFor(m.kind, m.mood === 'cry' ? 'cry' : 'happy', m.r); if (spr) return drawSpriteMonster(ctx, m, spr); }
  const { r } = m, body = monsterBody(m.col, r, m.variant);
  const sq = m.squash || 0, sx = 1 + sq * 0.12, sy = 1 - sq * 0.12, tilt = m.tilt || 0;
  ctx.save();
  ctx.translate(m.x, (m.cy ?? m.y) + r * 0.95); ctx.rotate(tilt); ctx.scale(sx, sy); ctx.translate(0, -r * 0.95);
  ctx.drawImage(body, -body.ox, -body.oy);
  // 眼睛
  const ey = -r * 0.42, ex = r * 0.32, er = r * 0.19;
  ctx.lineCap = 'round';
  if (m.mood === 'giggle' || m.mood === 'wet' || m.mood === 'cry') {
    // 眯眼笑 ^ ^ 或被打湿的 > <
    ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = r * 0.08;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      if (m.mood === 'giggle') { ctx.moveTo(s * ex - er * 0.8, ey + er * 0.3); ctx.lineTo(s * ex, ey - er * 0.4); ctx.lineTo(s * ex + er * 0.8, ey + er * 0.3); }
      else { ctx.moveTo(s * ex - s * er * 0.7, ey - er * 0.5); ctx.lineTo(s * ex + s * er * 0.5, ey); ctx.lineTo(s * ex - s * er * 0.7, ey + er * 0.5); }
      ctx.stroke();
    }
  } else {
    const blink = m.blink ? 0.15 : 1;
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(s * ex, ey, er, er * 1.1 * blink, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = r * 0.04; ctx.stroke();
      if (blink > 0.5) {
        const lx = (m.look || 0) * er * 0.3;
        ctx.fillStyle = '#2b2d42'; ctx.beginPath(); ctx.arc(s * ex + lx, ey + er * 0.15, er * (m.mood === 'surprise' ? 0.4 : 0.58), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s * ex + lx + er * 0.2, ey - er * 0.15, er * 0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  // 嘴巴
  ctx.strokeStyle = '#2b2d42'; ctx.lineWidth = r * 0.06; ctx.fillStyle = '#ff5d73';
  const my = -r * 0.16; // 嘴巴放高一点，和肚皮上的字分开（不然“木”看起来像“术”）
  if (m.mood === 'giggle' || m.mood === 'wet' || m.mood === 'cry' || m.mood === 'surprise') { ctx.beginPath(); ctx.ellipse(0, my + r * 0.04, r * 0.13, r * (m.mood === 'surprise' ? 0.12 : 0.09), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  else { ctx.beginPath(); ctx.arc(0, my - r * 0.04, r * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  // 标签（肚皮上，大字）
  if (m.label) {
    const fs = r * (m.label.type === 'hanzi' ? 0.58 : m.label.text.length > 1 ? 0.54 : 0.62);
    ctx.font = `900 ${fs}px ${LABEL_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = fs * 0.12; ctx.strokeStyle = '#fff'; ctx.strokeText(m.label.text, 0, r * 0.45);
    ctx.fillStyle = '#2b2d42'; ctx.fillText(m.label.text, 0, r * 0.45);
  }
  // 被打湿：水光 + 水滴
  if (m.wet > 0.02) {
    ctx.globalAlpha = Math.min(1, m.wet);
    ctx.fillStyle = 'rgba(80,170,255,0.28)'; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7fd0ff';
    for (let i = 0; i < 5; i++) {
      const a = -2.4 + i * 0.55, dx = Math.cos(a) * r * 0.95, dy = Math.sin(a) * r * 0.9 + ((m.t * 120 + i * 37) % (r * 0.8));
      drop(ctx, dx, dy, r * 0.09);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------- 贴图怪兽 ----------
const LABEL_INK = '#3a2733';
const labelW = new Map();   // 文字 → 100px 字号下的宽度（measureText 结果缓存）
function labelWidth100(ctx, text) {
  let w = labelW.get(text); if (w != null) return w;
  ctx.font = `900 100px ${LABEL_FONT}`; w = ctx.measureText(text).width || 60 * text.length; labelW.set(text, w); return w;
}
/** 肚皮椭圆在画布上的位置（相对脚底锚点，未计入挤压 / 倾斜）：{ x, y, w, h } */
export function bellyRect(m) {
  const K = MONSTER_KINDS[m.kind], s = spriteScale(m.kind, m.r), W = K.w * s, H = K.h * s;
  return { x: (K.belly.x - 0.5) * W, y: (K.belly.y - K.anchorY) * H, w: K.belly.w * W, h: K.belly.h * H };
}
/** 贴图怪兽的包围盒（世界坐标；脚底在 cy + 0.95r） */
export function monsterBox(m) {
  if (m.kind == null || !spritesReady()) return { x: m.x - m.r * 1.05, y: m.cy - m.r * 1.45, w: m.r * 2.1, h: m.r * 2.6 };
  const K = MONSTER_KINDS[m.kind], s = spriteScale(m.kind, m.r), W = K.w * s, H = K.h * s, fy = m.cy + m.r * 0.95;
  return { x: m.x - W / 2, y: fy - H * K.anchorY, w: W, h: H };
}
function drawSpriteMonster(ctx, m, spr) {
  const r = m.r, sq = m.squash || 0, breath = Math.sin(m.t * 2.6) * 0.022, sob = m.sob || 0;
  const sx = 1 + sq * 0.12 - breath + sob * 0.5, sy = 1 - sq * 0.12 + breath - sob;
  ctx.save();
  ctx.translate(m.x, m.cy + r * 0.95); ctx.rotate(m.tilt || 0); ctx.scale(sx, sy);
  ctx.drawImage(spr, -spr.ax, -spr.ay);
  const b = bellyRect(m);
  if (m.label) {
    const t = m.label.text, k = m.label.type === 'hanzi' ? 0.74 : 0.8;
    const fs = Math.min(b.h * k, (b.w * 0.82) / (labelWidth100(ctx, t) / 100));
    ctx.font = `900 ${fs}px ${LABEL_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = LABEL_INK; ctx.fillText(t, b.x, b.y + fs * 0.04);
  } else if (m.heart !== false) {
    // 自由模式：肚皮上一个小爱心
    const hs = b.h * 0.2, hx = b.x, hy = b.y - hs * 0.1;
    ctx.fillStyle = 'rgba(255,120,150,0.85)'; ctx.beginPath();
    ctx.moveTo(hx, hy + hs * 0.9);
    ctx.bezierCurveTo(hx - hs * 1.3, hy, hx - hs * 0.7, hy - hs, hx, hy - hs * 0.35);
    ctx.bezierCurveTo(hx + hs * 0.7, hy - hs, hx + hs * 1.3, hy, hx, hy + hs * 0.9); ctx.fill();
  }
  ctx.restore();
}
/** 哭的时候眼泪从哪里掉：返回左右两点（世界坐标，脸颊上眼泪流下来的位置） */
export function tearPoints(m) {
  if (m.kind == null || !spritesReady()) return [[m.x - m.r * 0.32, m.cy - m.r * 0.3], [m.x + m.r * 0.32, m.cy - m.r * 0.3]];
  const b = bellyRect(m), fy = m.cy + m.r * 0.95, y = fy + b.y - b.h * 0.55;
  return [[m.x + b.x - b.w * 0.48, y], [m.x + b.x + b.w * 0.48, y]];
}
export function drawTear(ctx, x, y, s) { drop(ctx, x, y, s); }

function drop(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x, y - s * 1.6); ctx.quadraticCurveTo(x + s, y, x, y + s); ctx.quadraticCurveTo(x - s, y, x, y - s * 1.6); ctx.fill(); }

/** 水球：圆圆的气球 + 小结 + 高光；wob 让它在手里晃 */
export function drawBalloon(ctx, x, y, r, color, wob = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(wob * 7) * 0.12); ctx.scale(1 + Math.sin(wob * 11) * 0.05, 1 - Math.sin(wob * 11) * 0.05);
  ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = Math.max(2, r * 0.08);
  ctx.beginPath(); ctx.moveTo(0, -r * 1.1);
  ctx.bezierCurveTo(r * 1.05, -r * 1.1, r * 1.05, r * 0.7, 0, r * 0.95);
  ctx.bezierCurveTo(-r * 1.05, r * 0.7, -r * 1.05, -r * 1.1, 0, -r * 1.1); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r * 0.18, r * 1.2); ctx.lineTo(0, r * 0.92); ctx.lineTo(r * 0.18, r * 1.2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.45, r * 0.18, r * 0.3, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** 篮子（里面堆着水球） */
export function drawBasket(ctx, b, t, hover) {
  const r = b.h * 0.32;
  ctx.save();
  if (hover) { ctx.shadowColor = '#fff59d'; ctx.shadowBlur = b.h * 0.5; }
  // 篮子里的水球
  const pos = [[0.22, 0.12], [0.42, 0.02], [0.62, 0.1], [0.8, 0.16], [0.33, 0.22], [0.55, 0.24]];
  pos.forEach(([px, py], i) => drawBalloon(ctx, b.x + b.w * px, b.y + b.h * py, r, BALLOON_COLORS[i % BALLOON_COLORS.length], hover ? t + i : 0));
  // 篮身
  ctx.fillStyle = '#c98b4b'; ctx.strokeStyle = '#8a5528'; ctx.lineWidth = Math.max(3, b.h * 0.05);
  ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h * 0.3); ctx.lineTo(b.x + b.w, b.y + b.h * 0.3); ctx.lineTo(b.x + b.w * 0.9, b.y + b.h); ctx.lineTo(b.x + b.w * 0.1, b.y + b.h); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(120,70,30,0.55)'; ctx.lineWidth = Math.max(2, b.h * 0.03);
  for (let i = 1; i < 6; i++) { const fx = b.x + b.w * i / 6; ctx.beginPath(); ctx.moveTo(fx, b.y + b.h * 0.3); ctx.lineTo(b.x + b.w * 0.5 + (fx - b.x - b.w * 0.5) * 0.8, b.y + b.h); ctx.stroke(); }
  for (let k = 1; k < 3; k++) { const y = b.y + b.h * (0.3 + k * 0.23); ctx.beginPath(); ctx.moveTo(b.x + b.w * 0.04 * k, y); ctx.lineTo(b.x + b.w * (1 - 0.04 * k), y); ctx.stroke(); }
  ctx.fillStyle = '#e0a56a'; roundRect(ctx, b.x - b.w * 0.03, b.y + b.h * 0.24, b.w * 1.06, b.h * 0.14, b.h * 0.07); ctx.fill(); ctx.stroke();
  ctx.restore();
}
