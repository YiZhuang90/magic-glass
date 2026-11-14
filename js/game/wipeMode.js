// 玩法层 · 擦玻璃模式。
// 生命周期：intro（起雾）→ play（擦）→ reveal（消散 + 庆祝 + 朗读）→ 下一张。
// 模式接口（混色画画等后续模式照此实现）：enter / exit / resize / applySettings / update / render / skip
import { renderCard, star } from '../render/cardArt.js';
import { CoverLayer } from '../render/coverLayer.js';
import { loadImage } from '../content/cards.js';

const FINGER_PTS = [3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16, 18, 19, 20];

export class WipeMode {
  constructor(ctx) {
    Object.assign(this, ctx); // { effects, sfx, speech, content, bus, log, settings, ui, app }
    this.name = 'wipe';
    this.cover = new CoverLayer();
    this.W = 1; this.H = 1;
    this.state = 'idle';
    this.t = 0; this.card = null; this.art = null;
    this.completed = 0; this.milestones = new Set();
    this.seed = 1;
    this.lastPos = null;
  }

  enter() { this._buttons(); this.nextCard(); }
  exit() { this.state = 'idle'; this.speech.cancel(); this.sfx.setWipe(0); }

  resize(W, H) {
    const changed = Math.abs(W - this.W) > 2 || Math.abs(H - this.H) > 2;
    this.W = W; this.H = H; this.effects.resize(W, H); this._buttons();
    if (changed && this.card) this._buildCard(this.card, true);
  }

  applySettings(s) {
    const typeChanged = s.cover !== this.settings.cover;
    this.settings = s;
    if (typeChanged && this.card && this.state !== 'reveal') this._buildCard(this.card, true);
  }

  _buttons() {
    const { W, H } = this, bh = H * 0.075;
    this.ui.set([
      { id: 'home', label: '🏠 首页', x: W * 0.012, y: H * 0.022, w: W * 0.1, h: bh, dwell: 1.5, onActivate: () => this.app.goMode('home') },
      // C：过关后可以把这张图带去涂颜色（线稿）
      { id: 'color', label: '🎨 去给它涂颜色', x: W * 0.72, y: H * 0.86, w: W * 0.25, h: H * 0.1, dwell: 1.2, visible: false,
        onActivate: () => this.app.goMode('paint', { card: this.card }) },
    ]);
  }

  async nextCard() {
    this.state = 'loading';
    const card = this.content.next();
    await this._buildCard(card, false);
  }

  /** 跳过当前（家长设置里的“下一张”） */
  skip() { this.speech.cancel(); this.nextCard(); }

  async _buildCard(card, keepState) {
    this.card = card;
    let img = null;
    if (card.image) { try { img = await loadImage(card.image); } catch { img = null; } }
    this.art = renderCard(card, this.W, this.H, img);
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    this.cover.build(this.W, this.H, this.settings.cover, this.art.full, this.seed % 1000 + 1);
    this.milestones.clear();
    if (!keepState || this.state === 'loading' || this.state === 'idle') {
      this.state = 'intro'; this.t = 0; this.cover.alpha = 1;
    } else { this.state = 'play'; }
    this.startedAt = performance.now();
    this.bus.emit('card:start', { id: card.id, cover: this.settings.cover });
  }

  /** 虚拟手就是擦拭面：掌心 + 每根手指的关节和指尖都会擦 */
  _segments(hands) {
    const segs = [], k = this.settings.brushSize || 1;
    for (const h of hands) {
      const mouse = h.source !== 'hand';
      if (mouse ? !(h.down && !h.consumed) : !h.active) continue;
      if (this.ui.hit(h.palm[0], h.palm[1])) continue;
      const S = h.size * k;
      segs.push({ x0: h.prevPalm[0], y0: h.prevPalm[1], x1: h.palm[0], y1: h.palm[1], r: S * (mouse ? 0.62 : 0.5), palm: true });
      for (const i of FINGER_PTS) segs.push({ x0: h.prevPts[i][0], y0: h.prevPts[i][1], x1: h.pts[i][0], y1: h.pts[i][1], r: S * 0.14 });
    }
    return segs;
  }

  handDecor() { return { sponge: this.settings.cover }; }

  update(dt, { hands }) {
    const segments = this._segments(hands);
    this.t += dt;
    const cover = this.cover;
    if (this.state === 'intro') {
      if (this.t > 0.7) { this.state = 'play'; this.t = 0; }
    }

    let moved = 0;
    if (this.state === 'play' || this.state === 'intro') {
      for (const s of segments) {
        cover.wipe(s.x0, s.y0, s.x1, s.y1, s.r);
        if (s.palm) { cover.maybeSpawnDrip(s.x1, s.y1, s.r); moved += Math.hypot(s.x1 - s.x0, s.y1 - s.y0); this.lastPos = [s.x1, s.y1]; }
      }
      // 回雾节流：每 0.25 秒统一回填一次
      this._refogAcc = (this._refogAcc || 0) + dt;
      if (this.settings.refog && this.state === 'play' && this._refogAcc > 0.25) { cover.refog(this._refogAcc, this.settings.refogSpeed); this._refogAcc = 0; }
    }
    const speed = dt > 0 ? moved / dt / Math.min(this.W, this.H) : 0; // 每秒划过多少个“屏幕短边”
    this.sfx.setWipe(this.state === 'play' ? Math.min(1, speed / 2.5) : 0, this.settings.cover);
    cover.updateDrips(dt);

    if (this.state === 'play') {
      const ratio = cover.clearedRatio();
      this.ratio = ratio;
      const goal = this.settings.threshold;
      for (const m of [0.3, 0.6]) {
        if (ratio >= goal * m && !this.milestones.has(m)) {
          this.milestones.add(m); this.sfx.ding(this.milestones.size - 1);
          if (this.lastPos) this.effects.sparkle(this.lastPos[0], this.lastPos[1], 10);
        }
      }
      if (ratio >= goal) this._reveal();
    }

    if (this.state === 'reveal') {
      cover.alpha = Math.max(0, 1 - this.t / 0.9);
      if (!this._celebrated && this.t > 0.25) {
        this._celebrated = true;
        const big = this.completed % 3 === 0;
        this.effects.celebrate(big); this.sfx.fanfare(big);
        this.speech.say(this.speech.cardParts(this.card, this.settings.lang)).then(() => { this._spoken = true; });
      }
      const colorBtn = this.ui.get('color');
      const holding = colorBtn && colorBtn.progress > 0;
      if (!holding && (this._spoken && this.t > 4.5 || this.t > 10)) { this.state = 'between'; this.t = 0; }
    }
    const cb = this.ui.get('color'); if (cb) cb.visible = this.state === 'reveal';
    if (this.state === 'between' && this.t > 0.6) this.nextCard();

    this.effects.update(dt);
  }

  _reveal() {
    this.state = 'reveal'; this.t = 0; this._celebrated = false; this._spoken = false;
    this.completed++;
    this.sfx.whoosh(); this.effects.puff(this.settings.cover === 'mud' ? 0 : 45);
    const seconds = (performance.now() - this.startedAt) / 1000;
    this.log.record('card_complete', { id: this.card.id, cover: this.settings.cover, seconds });
    this.bus.emit('card:complete', { id: this.card.id, seconds });
  }

  render(ctx) {
    if (!this.art) { ctx.fillStyle = '#dfe8ef'; ctx.fillRect(0, 0, this.W, this.H); return; }
    const { base, emoji, emojiBox } = this.art;
    // 揭晓时整张卡轻微弹一下
    let s = 1;
    if (this.state === 'reveal') s = 1 + 0.035 * Math.sin(Math.min(1, this.t / 0.8) * Math.PI);
    ctx.save();
    ctx.translate(this.W / 2, this.H / 2); ctx.scale(s, s); ctx.translate(-this.W / 2, -this.H / 2);
    ctx.drawImage(base, 0, 0);
    if (emoji) {
      let es = 1, rot = 0, dy = 0;
      if (this.state === 'reveal' || this.state === 'between') {
        const t = this.t + (this.state === 'between' ? 3.6 : 0);
        es = 1 + 0.18 * Math.abs(Math.sin(t * 5)) * Math.exp(-t * 0.5);
        rot = 0.12 * Math.sin(t * 7) * Math.exp(-t * 0.6);
        dy = -Math.abs(Math.sin(t * 5)) * emojiBox.s * 0.08 * Math.exp(-t * 0.5);
      }
      ctx.save(); ctx.translate(emojiBox.x, emojiBox.y + dy); ctx.rotate(rot); ctx.scale(es, es);
      ctx.drawImage(emoji, -emojiBox.s / 2, -emojiBox.s / 2); ctx.restore();
    }
    ctx.restore();
    this.cover.render(ctx);
    // 换题过渡：先渐变成一片白雾，再从白雾中显出新玻璃（不会提前露出答案）
    let veil = 0;
    if (this.state === 'between') veil = Math.min(1, this.t / 0.6);
    else if (this.state === 'intro') veil = Math.max(0, 1 - this.t / 0.7);
    else if (this.state === 'loading') veil = 1;
    if (veil > 0) { ctx.save(); ctx.globalAlpha = veil; ctx.fillStyle = '#e6eef4'; ctx.fillRect(0, 0, this.W, this.H); ctx.restore(); }
    this.effects.render(ctx);
    if (this.state === 'play') this._renderProgress(ctx);
    this.ui.render(ctx);
  }

  /** 顶部 5 颗星：按擦开进度点亮（不用数字，孩子也看得懂） */
  _renderProgress(ctx) {
    const p = Math.min(1, (this.ratio || 0) / this.settings.threshold);
    const n = 5, size = Math.min(this.W, this.H) * 0.028, gap = size * 2.6;
    const x0 = this.W / 2 - ((n - 1) * gap) / 2, y = size * 1.8;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const lit = p >= (i + 1) / n;
      ctx.fillStyle = lit ? '#ffd60a' : 'rgba(255,255,255,0.55)';
      ctx.shadowColor = lit ? '#fff3a0' : 'rgba(0,0,0,0.2)'; ctx.shadowBlur = lit ? size : 4;
      star(ctx, x0 + i * gap, y, size);
    }
    ctx.restore();
  }
}
