// 投水球 · 纯逻辑（无 DOM，可在 node 里单测）：出手速度估计、瞄准辅助、题目 / 目标选择。

/**
 * 最小二乘拟合一段时间窗口里的位置 → 速度（像素 / 秒）。
 * samples: [{ x, y, t }]（t 毫秒，按时间排序）；只用 [t1 - win, t1] 内的点。点太少时返回 null。
 */
export function fitVelocity(samples, t1, win) {
  const s = samples.filter(p => p.t <= t1 + 1e-6 && p.t >= t1 - win - 1e-6);
  if (s.length < 2) return null;
  const n = s.length, mt = s.reduce((a, p) => a + p.t, 0) / n;
  const mx = s.reduce((a, p) => a + p.x, 0) / n, my = s.reduce((a, p) => a + p.y, 0) / n;
  let stt = 0, stx = 0, sty = 0;
  for (const p of s) { const dt = p.t - mt; stt += dt * dt; stx += dt * (p.x - mx); sty += dt * (p.y - my); }
  if (stt < 1e-6) return null;
  return [stx / stt * 1000, sty / stt * 1000];
}

/**
 * 出手速度：张开手的手势要防抖几帧才确认，那时手往往已经在减速。
 * 所以在“现在、60、120、180 ms 前”结束的四个 120 ms 窗口里各拟合一次，取最快的那个（挥手的峰值速度）。
 */
export function releaseVelocity(samples, now, { win = 120, lags = [0, 60, 120, 180] } = {}) {
  let best = [0, 0], bs = -1;
  for (const lag of lags) {
    const v = fitVelocity(samples, now - lag, win);
    if (!v) continue;
    const s = Math.hypot(v[0], v[1]);
    if (s > bs) { bs = s; best = v; }
  }
  return best;
}

/**
 * 根据出手点和速度算飞行：方向、落点、飞行时间、弧高。unit = 画面短边（像素）。
 * 速度太慢时按“轻轻往上抛”处理（方向朝上、最短射程），这样孩子轻轻一推也能扔出去。
 */
export function throwPlan(origin, v, unit, o = {}) {
  const { minSpeed = 0.15, rangeK = 0.42, minRange = 0.32, maxRange = 1.25 } = o;
  const speed = Math.hypot(v[0], v[1]) / unit; // 短边 / 秒
  const dir = speed < minSpeed ? [0, -1] : [v[0] / (speed * unit), v[1] / (speed * unit)];
  const dist = Math.min(maxRange, Math.max(minRange, speed * rangeK)) * unit;
  const landing = [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist];
  const dur = Math.min(0.8, Math.max(0.45, 0.3 + dist / unit * 0.35));
  return { dir, dist, landing, dur, speed, arc: unit * (0.1 + 0.08 * dist / unit) };
}

/**
 * 瞄准辅助（对 5 岁孩子很宽松）：在出手方向的锥形范围内（半角 coneDeg、距离不超过 maxDist），
 * 或离落点 radius 以内的怪兽里，挑离落点最近的一只。都没有就返回 null（扔偏了）。
 * monsters: [{ x, y, ... }]，只传可以被打中的怪兽。
 */
export function aimAssist(origin, dir, landing, monsters, unit, { coneDeg = 32, radius = 0.24, maxDist = 1.6 } = {}) {
  const cosC = Math.cos(coneDeg * Math.PI / 180);
  let best = null, bd = Infinity;
  for (const m of monsters) {
    const dx = m.x - origin[0], dy = m.y - origin[1], d = Math.hypot(dx, dy) || 1;
    const inCone = (dx * dir[0] + dy * dir[1]) / d >= cosC && d <= maxDist * unit;
    const dl = Math.hypot(m.x - landing[0], m.y - landing[1]);
    const near = dl <= radius * unit;
    if (!inCone && !near) continue;
    if (dl < bd) { bd = dl; best = m; }
  }
  return best;
}

// ---------- 题目内容 ----------
export const HANZI = ['大', '小', '人', '口', '山', '水', '火', '木', '日', '月', '上', '下', '天', '中', '手', '土', '田', '目', '耳', '工'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** content: 'num' | 'letter' | 'hanzi' | 'mix' → [{ type, text }] */
export function labelPool(content) {
  const num = Array.from({ length: 10 }, (_, i) => ({ type: 'num', text: String(i + 1) }));
  const letter = LETTERS.map(t => ({ type: 'letter', text: t }));
  const hanzi = HANZI.map(t => ({ type: 'hanzi', text: t }));
  if (content === 'letter') return letter;
  if (content === 'hanzi') return hanzi;
  if (content === 'mix') return [...num, ...letter, ...hanzi];
  return num;
}

/** 从题库里随机挑一个标签，避开 exclude（文字）里的。 */
export function pickLabel(pool, exclude = [], rng = Math.random) {
  const ex = new Set(exclude), c = pool.filter(l => !ex.has(l.text));
  const from = c.length ? c : pool;
  return from[Math.floor(rng() * from.length) % from.length];
}

/**
 * 选下一个目标：只从屏幕上“看得见、能打”的怪兽的标签里挑，且不和上一个目标相同（只剩它一个时除外）。
 * 返回怪兽对象或 null。
 */
export function pickTarget(monsters, lastText, rng = Math.random) {
  const vis = monsters.filter(m => m.label);
  if (!vis.length) return null;
  const c = vis.filter(m => m.label.text !== lastText);
  const from = c.length ? c : vis;
  return from[Math.floor(rng() * from.length) % from.length];
}

/** 语音提示内容：lang 'zh' | 'en' | 'both'；lead=true 时是从自由模式切换过来的第一句。 */
export function promptParts(label, lang, lead = false) {
  const t = label.text;
  const zh = label.type === 'num' ? `打 ${t} 号！` : label.type === 'letter' ? `打字母 ${t}！` : `打“${t}”字！`;
  const zhs = { text: lead ? `现在试试${zh}` : zh, lang: 'zh' };
  if (label.type === 'hanzi') {
    // 英文语音读不了汉字：英文模式说一句英文，再用中文读这个字
    if (lang === 'en') return [{ text: lead ? 'Now try to hit the character' : 'Hit the character', lang: 'en' }, { text: t, lang: 'zh' }];
    return [zhs];
  }
  const en = { text: (lead ? 'Now try to hit ' : 'Hit ') + (label.type === 'num' ? `number ${t}!` : `the letter ${t}!`), lang: 'en' };
  return lang === 'en' ? [en] : lang === 'zh' ? [zhs] : [zhs, en];
}
