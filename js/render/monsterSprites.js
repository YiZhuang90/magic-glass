// 渲染层 · 小怪兽贴图（AI 生成的原画，tools/cut_monsters.py 抠图）。
// 8 只怪兽（没有角 / 翅膀）× 开心 / 哭脸。原图最长边 384px；按实际画出来的大小预缩放到离屏小画布并缓存，每帧只是一次不缩放的 drawImage（流畅优先）。
// 某一种还没加载好（或加载失败）时 kindReady(k) 为 false：出场只挑已加载好的种类；一种都没有时退回程序绘制的旧怪兽。
import { canvas } from './cardArt.js';

// 每只的尺寸和肚皮（放标签的奶油色椭圆）位置，均为相对整张贴图的归一化值；anchorY = 身体底部（脚底）的位置。
export const MONSTER_KINDS = [
  { name: 'pink',     w: 351, h: 384, anchorY: 0.9794, body: { w: 0.955, h: 0.9265 }, belly: { x: 0.5023, y: 0.6983, w: 0.3505, h: 0.2765 } },
  { name: 'mint',     w: 336, h: 384, anchorY: 0.9803, body: { w: 0.955, h: 0.938 }, belly: { x: 0.4972, y: 0.7118, w: 0.3408, h: 0.2592 } },
  { name: 'sky',      w: 346, h: 384, anchorY: 0.9795, body: { w: 0.9545, h: 0.9327 }, belly: { x: 0.4988, y: 0.7025, w: 0.3506, h: 0.2719 } },
  { name: 'peach',    w: 349, h: 384, anchorY: 0.9795, body: { w: 0.9421, h: 0.9357 }, belly: { x: 0.4948, y: 0.7033, w: 0.3473, h: 0.2719 } },
  { name: 'lavender', w: 339, h: 384, anchorY: 0.981, body: { w: 0.9202, h: 0.9458 }, belly: { x: 0.5025, y: 0.6908, w: 0.4356, h: 0.3333 } },
  { name: 'lemon',    w: 296, h: 384, anchorY: 0.9828, body: { w: 0.9429, h: 0.9461 }, belly: { x: 0.4999, y: 0.7424, w: 0.4317, h: 0.2721 } },
  { name: 'coral',    w: 340, h: 384, anchorY: 0.9799, body: { w: 0.9547, h: 0.9284 }, belly: { x: 0.4978, y: 0.7037, w: 0.4304, h: 0.3095 } },
  { name: 'lime',     w: 333, h: 384, anchorY: 0.9813, body: { w: 0.8985, h: 0.9627 }, belly: { x: 0.4958, y: 0.6937, w: 0.4308, h: 0.3307 } },
];
const BASE = new URL('../../assets/monsters/', import.meta.url).href;
const imgs = {};      // 'pink_happy' → HTMLImageElement（已解码）
let started = false, loadedCount = 0;
const VER = '?v=9';   // 换图时改这里：v8 也有 pink / mint / lavender 同名文件，避免浏览器拿到旧缓存

function load(key) {
  return new Promise(res => {
    const im = new Image(); im.decoding = 'async';
    let triedPng = false;
    im.onload = () => { (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => { imgs[key] = im; loadedCount++; res(); }); };
    im.onerror = () => { if (!triedPng) { triedPng = true; im.src = BASE + key + '.png' + VER; } else res(); };  // WebP 不支持时退回 PNG
    im.src = BASE + key + '.webp' + VER;
  });
}

/** 开始预加载（只加载一次）：每只一对（开心 + 哭脸），一对一对按顺序来，最多同时 4 张，不和识别模型抢网络。返回全部完成的 Promise。 */
export function preloadMonsters() {
  if (started) return preloadMonsters._p; started = true;
  const queue = MONSTER_KINDS.flatMap(k => [k.name + '_happy', k.name + '_cry']);
  const worker = async () => { while (queue.length) await load(queue.shift()); };
  return (preloadMonsters._p = Promise.all([worker(), worker(), worker(), worker()]));
}
/** 这一种的开心 + 哭脸都加载好了 */
export function kindReady(k) { const n = MONSTER_KINDS[k]?.name; return !!(n && imgs[n + '_happy'] && imgs[n + '_cry']); }
export function readyKinds() { return MONSTER_KINDS.map((_, k) => k).filter(kindReady); }
export function spritesReady() { return loadedCount >= MONSTER_KINDS.length * 2; }

// 按 (种类, 表情, 尺寸) 缓存预缩放好的小画布
const cache = new Map();
/** 怪兽 r（身体半径，单位：画布像素）→ 贴图缩放：身体宽度 = 2.15r（头顶的小叶子 / 耳朵另算） */
export function spriteScale(kind, r) { const K = MONSTER_KINDS[kind]; return (2.15 * r) / (K.body.w * K.w); }
export function spriteFor(kind, face, r) {
  const K = MONSTER_KINDS[kind]; if (!K) return null;
  const key = kind + face + Math.round(r * 2);
  let c = cache.get(key); if (c) return c;
  const im = imgs[K.name + '_' + face]; if (!im) return null;
  const s = spriteScale(kind, r), w = Math.max(1, Math.round(K.w * s)), h = Math.max(1, Math.round(K.h * s));
  c = canvas(w, h); const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  // 大比例缩小时分两步，边缘更干净（只做一次，结果缓存）
  if (im.naturalWidth > w * 2.5) { const m = canvas(w * 2, h * 2), mx = m.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(im, 0, 0, w * 2, h * 2); x.drawImage(m, 0, 0, w, h); }
  else x.drawImage(im, 0, 0, w, h);
  c.ax = w / 2; c.ay = h * K.anchorY;   // 锚点：脚底中点
  if (cache.size > 72) cache.clear();   // 画布尺寸变了会产生新尺寸，别无限增长
  cache.set(key, c);
  return c;
}
