// 渲染层 · 庆祝粒子：彩带、星星、闪光。
import { star } from './cardArt.js';

const COLORS = ['#ff4d6d', '#ffbe0b', '#3a86ff', '#8338ec', '#06d6a0', '#ff8fab', '#fb5607'];

export class Effects {
  constructor() { this.parts = []; this.w = 1; this.h = 1; }
  resize(w, h) { this.w = w; this.h = h; }

  /** 大庆祝：从两侧下角喷出彩带 + 中心星星爆开 */
  celebrate(big = false) {
    const { w, h } = this, s = Math.min(w, h) / 900;
    const n = big ? 260 : 160;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const a = (left ? -Math.PI / 3 : -Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.7;
      const v = (650 + Math.random() * 500) * s;
      this.parts.push({ kind: 'confetti', x: left ? 0 : w, y: h, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, size: (10 + Math.random() * 12) * s,
        color: COLORS[i % COLORS.length], life: 3 + Math.random() * 1.5 });
    }
    // 从顶部飘落的彩带雨
    for (let i = 0; i < (big ? 140 : 80); i++) {
      this.parts.push({ kind: 'confetti', x: Math.random() * w, y: -Math.random() * h * 0.6, vx: (Math.random() - 0.5) * 120 * s, vy: (80 + Math.random() * 120) * s,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, size: (10 + Math.random() * 12) * s,
        color: COLORS[i % COLORS.length], life: 4 + Math.random() * 1.5 });
    }
    for (let i = 0; i < (big ? 60 : 36); i++) {
      const a = Math.random() * Math.PI * 2, v = (250 + Math.random() * 650) * s;
      this.parts.push({ kind: 'star', x: w / 2, y: h * 0.45, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200 * s,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 6, size: (14 + Math.random() * 22) * s,
        color: ['#ffd60a', '#fff3b0', '#ffffff', '#ffb703'][i % 4], life: 1.6 + Math.random() * 1.2 });
    }
  }

  /** 小闪光（进度提示、擦拭时偶尔） */
  sparkle(x, y, count = 6) {
    const s = Math.min(this.w, this.h) / 900;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 160) * s;
      this.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: 0, vr: 0,
        size: (6 + Math.random() * 10) * s, color: '#fffbe0', life: 0.6 + Math.random() * 0.5 });
    }
  }

  /** 雾气消散时的“烟团” */
  puff(count = 40) {
    const { w, h } = this, s = Math.min(w, h) / 900;
    for (let i = 0; i < count; i++) {
      this.parts.push({ kind: 'puff', x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 80 * s, vy: -40 * s - Math.random() * 60 * s,
        rot: 0, vr: 0, size: (60 + Math.random() * 120) * s, color: '#ffffff', life: 0.9 + Math.random() * 0.6, max: 1.5 });
    }
  }

  get active() { return this.parts.length > 0; }

  update(dt) {
    const g = 900 * Math.min(this.w, this.h) / 900;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.kind === 'confetti') { p.vy += g * dt; p.vx *= 0.985; p.vy *= 0.985; const vmax = 220 * g / 900; if (p.vy > vmax) p.vy = vmax; p.vx += Math.sin(p.rot * 2) * 30 * dt; }
      else if (p.kind === 'star') { p.vy += g * 0.35 * dt; p.vx *= 0.98; }
      else if (p.kind === 'spark') { p.vx *= 0.92; p.vy *= 0.92; }
      else if (p.kind === 'puff') { p.size *= 1 + dt * 0.8; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter(p => p.life > 0 && p.y < this.h + 80);
  }

  render(ctx) {
    for (const p of this.parts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life / 0.5);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.8 + 0.2);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      } else if (p.kind === 'star') {
        ctx.shadowColor = '#fff7ae'; ctx.shadowBlur = p.size * 0.8; star(ctx, 0, 0, p.size);
      } else if (p.kind === 'spark') {
        ctx.shadowColor = '#fff'; ctx.shadowBlur = p.size; star(ctx, 0, 0, p.size * 0.7);
      } else if (p.kind === 'puff') {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life)) * 0.35;
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
}

/** 光标：手 = 海绵 + 指尖小点；鼠标/触屏 = 海绵。 */
export function drawCursor(ctx, c, scale, coverType) {
  const r = c.r * scale;
  const x = c.x * scale, y = c.y * scale;
  ctx.save();
  // 擦拭范围光圈
  ctx.globalAlpha = c.active ? 0.55 : 0.3;
  ctx.strokeStyle = c.color; ctx.lineWidth = Math.max(3, r * 0.06);
  ctx.setLineDash([r * 0.18, r * 0.12]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (c.tips && c.tips.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [tx, ty] of c.tips) { ctx.beginPath(); ctx.arc(tx * scale, ty * scale, Math.max(4, r * 0.09), 0, Math.PI * 2); ctx.fill(); }
  }
  // 海绵
  const sw = r * 1.05, sh = r * 0.72;
  ctx.translate(x, y); ctx.rotate(-0.18);
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = r * 0.15; ctx.shadowOffsetY = r * 0.06;
  ctx.fillStyle = coverType === 'mud' ? '#7ed957' : '#ffd84d';
  rr(ctx, -sw / 2, -sh / 2, sw, sh, sh * 0.3); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = coverType === 'mud' ? '#3fa34d' : '#4caf50';
  rr(ctx, -sw / 2, -sh / 2, sw, sh * 0.28, sh * 0.14); ctx.fill();
  ctx.fillStyle = 'rgba(160,110,0,0.35)';
  const holes = [[-0.28, 0.12, 0.07], [0.05, 0.25, 0.05], [0.3, 0.05, 0.08], [-0.05, 0.02, 0.04], [0.18, 0.3, 0.035], [-0.32, 0.32, 0.04]];
  for (const [hx, hy, hr] of holes) { ctx.beginPath(); ctx.arc(hx * sw, hy * sh * 1.2, hr * sw, 0, Math.PI * 2); ctx.fill(); }
  // 闪亮眼睛，让海绵像个小伙伴
  ctx.fillStyle = '#333';
  ctx.beginPath(); ctx.arc(-sw * 0.14, sh * 0.05, sw * 0.045, 0, Math.PI * 2); ctx.arc(sw * 0.14, sh * 0.05, sw * 0.045, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(2, sw * 0.025); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, sh * 0.13, sw * 0.09, 0.2, Math.PI - 0.2); ctx.stroke();
  ctx.restore();
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
