// 首页：三张大卡片选择玩法。手悬停 1 秒或鼠标点击。
import { roundRect, canvas, EMOJI_FONT } from '../render/cardArt.js';

export class HomeMode {
  constructor(ctx) { Object.assign(this, ctx); this.name = 'home'; this.W = 1; this.H = 1; this.t = 0; }
  enter() { this._buttons(); this.speech.say([{ text: '你想玩什么？', lang: 'zh' }], 2500); }
  exit() {}
  resize(W, H) { this.W = W; this.H = H; this.bg = null; this.effects.resize(W, H); this._buttons(); }
  applySettings(s) { this.settings = s; }

  _buttons() {
    // 三张卡片排在中间，左右离屏幕边都留出一段（安全区）
    const { W, H } = this, gap = W * 0.035, cw = W * 0.27, ch = H * 0.56, y = H * 0.3, x0 = (W - 3 * cw - 2 * gap) / 2;
    this.ui.set([
      { id: 'wipe', title: '擦玻璃', sub: '挥挥手，擦开雾气', icon: '🧽', colors: ['#8ec5fc', '#e0c3fc'], x: x0, y, w: cw, h: ch, dwell: 1, customDraw: true, onActivate: () => this.app.goMode('wipe') },
      { id: 'paint', title: '混色画画', sub: '抓颜料，调新颜色', icon: '🎨', colors: ['#fbc2eb', '#ffd86f'], x: x0 + cw + gap, y, w: cw, h: ch, dwell: 1, customDraw: true, onActivate: () => this.app.goMode('paint') },
      { id: 'throw', title: '投水球', sub: '拿水球，打小怪兽', icon: '🎈', colors: ['#a1ffce', '#faffd1'], x: x0 + 2 * (cw + gap), y, w: cw, h: ch, dwell: 1, customDraw: true, onActivate: () => this.app.goMode('throw') },
    ]);
  }

  update(dt) { this.t += dt; this.effects.update(dt); }

  _background() {
    const { W, H } = this, c = canvas(W, H), x = c.getContext('2d');
    const g = x.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#fff8e7'); g.addColorStop(0.55, '#bfe3f5'); g.addColorStop(1, '#9bc8e8');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#3a3a8c'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `900 ${H * 0.11}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    x.shadowColor = '#fff'; x.shadowOffsetY = H * 0.006;
    x.fillText('魔法玻璃', W / 2, H * 0.13);
    x.shadowColor = 'transparent';
    x.font = `600 ${H * 0.035}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; x.fillStyle = '#44506b';
    x.fillText('把手停在想玩的卡片上，数到三 ✋', W / 2, H * 0.23);
    return c;
  }

  render(ctx) {
    if (!this.bg) this.bg = this._background();
    ctx.drawImage(this.bg, 0, 0);
    for (const b of this.ui.buttons) this._card(ctx, b);
    this.effects.render(ctx);
  }

  _card(ctx, b) {
    const bob = Math.sin(this.t * 2 + b.x) * b.h * 0.01, s = b.hover ? 1.05 : 1;
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2 + bob); ctx.scale(s, s); ctx.translate(-b.w / 2, -b.h / 2);
    ctx.shadowColor = 'rgba(0,0,0,0.22)'; ctx.shadowBlur = b.h * 0.08; ctx.shadowOffsetY = b.h * 0.03;
    const g = ctx.createLinearGradient(0, 0, b.w, b.h); g.addColorStop(0, b.colors[0]); g.addColorStop(1, b.colors[1]);
    ctx.fillStyle = g; roundRect(ctx, 0, 0, b.w, b.h, b.h * 0.08); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${b.h * 0.36}px ${EMOJI_FONT}`; ctx.fillText(b.icon, b.w / 2, b.h * 0.36);
    ctx.fillStyle = '#2b2d42';
    ctx.font = `900 ${b.h * 0.13}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.fillText(b.title, b.w / 2, b.h * 0.72);
    ctx.font = `600 ${b.h * 0.055}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`; ctx.fillStyle = '#44506b';
    ctx.fillText(b.sub, b.w / 2, b.h * 0.86);
    // 悬停进度：卡片外圈
    if (b.progress > 0) {
      ctx.strokeStyle = '#ff7b54'; ctx.lineWidth = b.h * 0.025; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(b.w / 2, b.h * 0.36, b.h * 0.24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.progress); ctx.stroke();
    }
    ctx.restore();
  }
}
