// 悬停按钮：手停在按钮上 dwell 秒触发（有进度环），鼠标/触屏点击立即触发。
import { roundRect } from '../render/cardArt.js';

export class HoverUI {
  constructor() { this.buttons = []; this.W = 0; this.H = 0; }
  /** 画布尺寸：用来把贴近屏幕边的按钮的感应区一直延伸到屏幕边（手被安全区夹在边上时也能碰到） */
  setBounds(W, H) { this.W = W; this.H = H; }
  set(buttons) {
    const old = new Map(this.buttons.map(b => [b.id, b]));
    this.buttons = buttons.map(b => ({ progress: 0, cooldown: 0, ...old.get(b.id), ...b }));
  }
  get(id) { return this.buttons.find(b => b.id === id); }
  /** 点是否在任何可见按钮上（用于避免在按钮上涂抹） */
  hit(x, y, pad = 0) { return this.buttons.some(b => b.visible !== false && inRect(x, y, b, pad)); }

  update(dt, hands, clicks) {
    for (const b of this.buttons) {
      if (b.visible === false) { b.progress = 0; continue; }
      b.cooldown = Math.max(0, b.cooldown - dt);
      // 用掌心判断悬停（比指尖稳定）；鼠标也能悬停
      const over = hands.some(h => (h.source === 'hand' ? edgeRect(h.palm[0], h.palm[1], b, this.W, this.H) : inRect(h.palm[0], h.palm[1], b)) && (h.source === 'hand' || !h.down));
      b.hover = over;
      if (over && b.cooldown <= 0) b.progress += dt / (b.dwell || 1);
      else if (!over) { b.progress = Math.max(0, b.progress - dt * 2); }
      if (b.progress >= 1) { b.progress = 0; b.cooldown = 1.2; b.onActivate?.(); }
    }
    for (const c of clicks) {
      const b = this.buttons.find(b => b.visible !== false && inRect(c.x, c.y, b));
      if (b) { c.pointer.consumed = true; b.progress = 0; b.cooldown = 0.6; b.onActivate?.(); }
    }
  }

  render(ctx) { for (const b of this.buttons) if (b.visible !== false && !b.customDraw) drawPill(ctx, b); }
}

/**
 * 和 inRect 一样，但按钮离屏幕边不到 edge（默认短边的 5%）时，那一侧的感应区一直延伸到屏幕外，
 * 手被夹在屏幕边上也算碰到。W/H 为 0 时退化为 inRect。
 */
export function edgeRect(x, y, b, W, H, pad = 0, edge = 0.05) {
  if (!W || !H) return inRect(x, y, b, pad);
  const e = Math.min(W, H) * edge;
  const x0 = b.x <= e ? -Infinity : b.x - pad, y0 = b.y <= e ? -Infinity : b.y - pad;
  const x1 = b.x + b.w >= W - e ? Infinity : b.x + b.w + pad, y1 = b.y + b.h >= H - e ? Infinity : b.y + b.h + pad;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function inRect(x, y, b, pad = 0) { return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad; }

export function drawPill(ctx, b) {
  const s = b.hover ? 1.06 : 1;
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(s, s); ctx.translate(-b.w / 2, -b.h / 2);
  ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = b.h * 0.2; ctx.shadowOffsetY = b.h * 0.06;
  ctx.fillStyle = b.bg || 'rgba(255,255,255,0.92)';
  roundRect(ctx, 0, 0, b.w, b.h, Math.min(b.h / 2, b.w / 2)); ctx.fill();
  ctx.shadowColor = 'transparent';
  if (b.progress > 0) {
    ctx.save(); roundRect(ctx, 0, 0, b.w, b.h, Math.min(b.h / 2, b.w / 2)); ctx.clip();
    ctx.fillStyle = 'rgba(255,190,60,0.55)'; ctx.fillRect(0, 0, b.w * b.progress, b.h); ctx.restore();
  }
  ctx.fillStyle = b.color || '#2b2d42'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = b.h * 0.42;
  ctx.font = `700 ${fs}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  ctx.fillText(b.label, b.w / 2, b.h / 2 + fs * 0.04);
  ctx.restore();
}
