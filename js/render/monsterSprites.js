// 渲染层 · 小怪兽贴图（AI 生成的原画，tools/cut_monsters.py 抠图）。
// 4 只怪兽 × 开心 / 哭脸。原图最长边 384px；按实际画出来的大小预缩放到离屏小画布并缓存，每帧只是一次不缩放的 drawImage（流畅优先）。
// 图片没加载好（或加载失败）时 ready() 为 false，调用方退回程序绘制的旧怪兽。
import { canvas } from './cardArt.js';

// 每只的尺寸和肚皮（放标签的奶油色椭圆）位置，均为相对整张贴图的归一化值；anchorY = 身体底部（脚底）的位置。
export const MONSTER_KINDS = [
  { name: 'pink',     w: 363, h: 384, anchorY: 0.979,  body: { w: 0.8698, h: 0.9189 }, belly: { x: 0.5186, y: 0.7089, w: 0.5143, h: 0.3694 } },
  { name: 'mint',     w: 342, h: 384, anchorY: 0.9807, body: { w: 0.9006, h: 0.9337 }, belly: { x: 0.5011, y: 0.7424, w: 0.4565, h: 0.3204 } },
  { name: 'yellow',   w: 384, h: 315, anchorY: 0.9775, body: { w: 0.9631, h: 0.9003 }, belly: { x: 0.4988, y: 0.7205, w: 0.3562, h: 0.3441 } },
  { name: 'lavender', w: 341, h: 384, anchorY: 0.9798, body: { w: 0.9283, h: 0.9306 }, belly: { x: 0.4285, y: 0.6865, w: 0.4495, h: 0.3526 } },
];
const BASE = new URL('../../assets/monsters/', import.meta.url).href;
const imgs = {};      // 'pink_happy' → HTMLImageElement（已解码）
let loaded = 0, total = 0, started = false;

function load(key) {
  return new Promise(res => {
    const im = new Image(); im.decoding = 'async';
    let triedPng = false;
    im.onload = () => { (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => { imgs[key] = im; loaded++; res(); }); };
    im.onerror = () => { if (!triedPng) { triedPng = true; im.src = BASE + key + '.png'; } else res(); };  // WebP 不支持时退回 PNG
    im.src = BASE + key + '.webp';
  });
}

/** 开始预加载（可多次调用，只加载一次）。返回全部加载完成的 Promise。 */
export function preloadMonsters() {
  if (started) return preloadMonsters._p; started = true;
  const keys = []; for (const k of MONSTER_KINDS) keys.push(k.name + '_happy', k.name + '_cry');
  total = keys.length;
  return (preloadMonsters._p = Promise.all(keys.map(load)));
}
export function spritesReady() { return total > 0 && loaded === total; }

// 按 (种类, 表情, 尺寸) 缓存预缩放好的小画布
const cache = new Map();
/** 怪兽 r（身体半径，单位：画布像素）→ 贴图缩放：身体高度 = 2.25r */
export function spriteScale(kind, r) { const K = MONSTER_KINDS[kind]; return (2.25 * r) / (K.body.h * K.h); }
export function spriteFor(kind, face, r) {
  const K = MONSTER_KINDS[kind], key = kind + face + Math.round(r * 2);
  let c = cache.get(key); if (c) return c;
  const im = imgs[K.name + '_' + face]; if (!im) return null;
  const s = spriteScale(kind, r), w = Math.max(1, Math.round(K.w * s)), h = Math.max(1, Math.round(K.h * s));
  c = canvas(w, h); const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  // 大比例缩小时分两步，边缘更干净（只做一次，结果缓存）
  if (im.naturalWidth > w * 2.5) { const m = canvas(w * 2, h * 2), mx = m.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(im, 0, 0, w * 2, h * 2); x.drawImage(m, 0, 0, w, h); }
  else x.drawImage(im, 0, 0, w, h);
  c.ax = w / 2; c.ay = h * K.anchorY;   // 锚点：脚底中点
  if (cache.size > 48) cache.clear();   // 画布尺寸变了会产生新尺寸，别无限增长
  cache.set(key, c);
  return c;
}
