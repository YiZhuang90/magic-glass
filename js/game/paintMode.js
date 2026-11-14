// 玩法层 · 抓颜色混色画画。
// 握拳停在颜料罐（或橡皮擦）上约 1 秒 = 选中它，握拳只用来“选”，不会画；
// 只伸出食指 = 画笔（食指指尖），张开手 / 握拳 / 其他手势都不画；
// 选中的颜色一直保持（不会用完、不被沾染），直到再抓下一个颜色；颜色在画纸上按 Mixbox 真实混合。
// 每只手（黄手 / 蓝手…）各自记住自己选的颜色，识别短暂丢失后也不会丢。
import { PIGMENTS, toLatent, toRgb, nameColor } from '../paint/mixer.js';
import { PaintCanvas } from '../paint/paintCanvas.js';
import { makeLineArt } from '../render/lineArt.js';
import { roundRect, star } from '../render/cardArt.js';
import { drawPill, edgeRect } from '../ui/hoverUI.js';
import { drawEraserIcon } from '../render/handRenderer.js';

const GRAB_SEC = 1.0, GRAB_SEC_MOUSE = 0.5;

export class PaintMode {
  constructor(ctx) {
    Object.assign(this, ctx); // { effects, sfx, speech, bus, log, settings, ui, app }
    this.name = 'paint';
    this.W = 1; this.H = 1;
    this.trackKey = new Map();    // 手的跟踪编号 → 上一帧用的颜色记忆编号
    this.trackSince = new Map();  // 手的跟踪编号 → 第一次出现的时间
    this.brushes = new Map();     // 手的固定编号（按手的颜色）→ { tool: null|'paint'|'eraser', lat, rgb, sel, grab, pot, active }
    this.discovered = [];         // [{ id, zh, en, rgb, t }]
    this.streak = new Map();      // handId → { id, n }
    this.lastPaintAt = 0;
    this.lineArt = null; this.lineCard = null;
  }

  enter(params = {}) {
    this.lineCard = params.card || null;
    this._layout(true);
    this._buttons();
    if (this.lineCard) this._buildLineArt();
    this.bus.emit('paint:start', { lineArt: !!this.lineCard });
    this._sayHint();
  }

  _sayHint() {
    const lang = this.settings.lang;
    const zh = { text: '握拳抓颜色，伸出食指画画', lang: 'zh' }, en = { text: 'Make a fist to pick a color. Point one finger to paint.', lang: 'en' };
    this.speech.say(lang === 'en' ? [en] : lang === 'zh' ? [zh] : [zh, en], 6000);
    this.app.toast('✊ 握拳抓颜色 · ☝️ 伸出食指画画 · ✋ 张开手不画', 4000);
  }
  exit() { this.brushes.clear(); this.sfx.setWipe(0); }

  resize(W, H) {
    const changed = Math.abs(W - this.W) > 2 || Math.abs(H - this.H) > 2;
    this.W = W; this.H = H; this.effects.resize(W, H); this._bgKey = -1;
    if (changed && this.canvas) { this._layout(true); this._buttons(); if (this.lineCard) this._buildLineArt(); }
  }
  applySettings(s) { this.settings = s; }

  _layout(reset) {
    const { W, H } = this, m = Math.min(W, H);
    const side = W * 0.115, top = H * 0.12;
    this.rect = { x: Math.round(side + W * 0.015), y: Math.round(top), w: Math.round(W - 2 * side - W * 0.03), h: Math.round(H - top - H * 0.03) };
    // 颜料罐：左边 红黄蓝，右边 白黑
    const potW = side * 0.86, potH = Math.min(H * 0.2, potW * 1.15);
    const left = PIGMENTS.slice(0, 3), right = PIGMENTS.slice(3);
    const ly0 = top + (H - top - potH * 3) / 4;
    this.pots = [
      ...left.map((p, i) => ({ ...p, lat: toLatent(p.rgb), x: W * 0.012, y: ly0 + i * (potH + ly0 - top + (ly0 - top) * 0), w: potW, h: potH })),
      ...right.map((p, i) => ({ ...p, lat: toLatent(p.rgb), x: W - W * 0.012 - potW, y: top + H * 0.02 + i * (potH * 0.82 + H * 0.025), w: potW, h: potH * 0.82 })),
    ];
    // 橡皮擦：和颜料罐一样握拳选中（不算颜色）
    this.eraser = { id: 'eraser', isEraser: true, zh: '橡皮擦', en: 'Eraser', x: W - W * 0.012 - potW, y: top + H * 0.02 + 2 * (potH * 0.82 + H * 0.025), w: potW, h: potH * 0.82 };
    this.tiles = [...this.pots, this.eraser];
    // 均匀排开左侧三罐
    const gap = (H - top - potH * 3) / 4;
    this.pots.slice(0, 3).forEach((p, i) => { p.y = top + gap + i * (potH + gap); });
    // 右下角：发现的颜色卡
    const cardY = top + H * 0.02 + 3 * (potH * 0.82 + H * 0.025);
    this.colorCard = { x: W - W * 0.012 - potW, y: cardY, w: potW, h: H - cardY - H * 0.03 };
    if (reset || !this.canvas) this.canvas = new PaintCanvas(this.rect);
    this.unit = m;
  }

  _buttons() {
    const { W, H } = this, bh = H * 0.075, y = H * 0.022;
    this.ui.set([
      { id: 'home', label: '🏠 首页', x: W * 0.012, y, w: W * 0.1, h: bh, dwell: 1.5, onActivate: () => this.app.goMode('home') },
      { id: 'undo', label: '↩️ 撤销', x: W * 0.36, y, w: W * 0.09, h: bh, dwell: 1.2, onActivate: () => this.undo() },
      { id: 'clear', label: '🧽 清空', x: W * 0.455, y, w: W * 0.09, h: bh, dwell: 1.5, onActivate: () => this.clear() },
      { id: 'save', label: '💾 保存', x: W * 0.55, y, w: W * 0.09, h: bh, dwell: 1.2, onActivate: () => this.save() },
    ]);
  }

  async _buildLineArt() {
    const card = this.lineCard;
    const art = await makeLineArt(card, this.rect.w, this.rect.h);
    if (card === this.lineCard) this.lineArt = art;
  }

  undo() { if (this.canvas.restore()) { this.sfx.pop(); } }
  clear() { this.canvas.clear(); this.sfx.whoosh(); }
  async save() {
    const blob = await this.canvas.toBlob(this.lineArt);
    if (!blob) return;
    const a = document.createElement('a');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    a.download = `魔法玻璃画画_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.png`;
    a.href = URL.createObjectURL(blob); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.sfx.fanfare(false); this.effects.sparkle(this.W * 0.595, this.H * 0.06, 14);
    this.app.toast('画已保存到“下载”文件夹 📁');
    this.bus.emit('paint:save', {});
  }

  /** 测试用：直接给鼠标手装上颜料 */
  debugLoad(id) { const p = this.tiles.find(p => p.id === id); this._pendingLoad = p; }

  /**
   * 颜色记忆的编号：
   * - 区分玩家开启、这只手属于某个玩家：按（玩家, 左/右手）记，例如 'p3:left'
   * - 没检测到人脸 / 关闭区分玩家：按手的颜色槽位（第一只手总是黄手）'h:黄手'
   * - 鼠标 / 触屏：按指针
   */
  _key(hand) {
    if (hand.source === 'touch') return 'touch'; // 每次手指按下都是新的触点编号：触屏共用一份颜色记忆
    if (hand.source !== 'hand') return hand.id;
    if (hand.person && this.settings.players !== false) return `p${hand.person.id}:${hand.handed || 'any'}`;
    return 'h:' + (hand.slotName || hand.style?.name || hand.id);
  }

  _copyTool(from, to) { to.tool = from.tool; to.lat.set(from.lat); to.rgb = [...from.rgb]; to.sel = from.sel; to.usedAt = from.usedAt; to.amount = from.amount; }

  _brush(hand) {
    const k = this._key(hand);
    let b = this.brushes.get(k);
    if (!b) {
      b = { tool: null, lat: new Float32Array(7), amount: 0, fixed: true, seed: Math.random() * 255, grab: 0, pot: null, sel: null, rgb: [255, 255, 255], source: hand.source, active: false, tip: null, usedAt: 0 };
      this.brushes.set(k, b);
    }
    return b;
  }

  /** 只有一只真手时，如果它（因为识别丢失后换了颜色槽位）还没有工具，就接过最近用过的那只手的颜色 */
  _adopt(b, liveKeys, key) {
    if (b.tool || b.source !== 'hand' || !key.startsWith('h:')) return; // 只在“按手区分”时接手；不同玩家之间不互相接颜色
    let best = null;
    for (const [k, o] of this.brushes) if (o !== b && o.tool && k.startsWith('h:') && !liveKeys.has(k) && (!best || o.usedAt > best.usedAt)) best = o;
    if (!best) return;
    b.tool = best.tool; b.lat.set(best.lat); b.rgb = [...best.rgb]; b.sel = best.sel; b.usedAt = best.usedAt;
    best.tool = null; best.sel = null;
  }

  /** 测试 / 调试用：某只手现在的工具 */
  brushOf(hand) { return this.brushes.get(this._key(hand)); }

  /** 这只手此刻是不是“画笔”姿势（真手：只伸食指；鼠标：按住） */
  static isBrushPose(hand) {
    if (hand.source !== 'hand') return !!(hand.down && !hand.consumed);
    return hand.active !== false && hand.gesture === 'point';
  }

  update(dt, { hands, now }) {
    let moved = 0, painting = false;
    this._lastHands = hands;
    const seen = new Set(), liveKeys = new Set(hands.map(h => this._key(h)));
    const nReal = hands.filter(h => h.source === 'hand').length;
    for (const hand of hands) {
      // 同一只手换了编号（例如刚认出是谁的手、或人脸暂时丢了）：手上的颜色跟着手走
      const key = this._key(hand), pk = this.trackKey.get(hand.id);
      const b = this._brush(hand); seen.add(b);
      if (!this.trackSince.has(hand.id)) this.trackSince.set(hand.id, now);
      if (pk && pk !== key) {
        // 换到“按手区分”的临时编号：一定带着颜色；换到玩家编号：玩家原来记住的颜色优先，
        // 除非这个颜色是这只手这次出现以后才抓的
        const ob = this.brushes.get(pk);
        if (ob && ob.tool && (key.startsWith('h:') || !b.tool || ob.usedAt >= this.trackSince.get(hand.id))) this._copyTool(ob, b);
      }
      this.trackKey.set(hand.id, key);
      if (nReal === 1) this._adopt(b, liveKeys, key);
      if (this._pendingLoad && hand.source !== 'hand') { this._load(b, this._pendingLoad, hand); this._pendingLoad = null; }
      const isMouse = hand.source !== 'hand';
      const [px, py] = hand.palm;
      // 贴着屏幕左右边的颜料罐：感应区延伸到屏幕边（真手被安全区夹在边上也能抓到）
      const tile = this.tiles.find(p => isMouse ? inside(px, py, p, this.unit * 0.02) : edgeRect(px, py, p, this.W, this.H, this.unit * 0.02));
      // 笔尖：真手 = 食指指尖；鼠标 = 指针
      const tip = isMouse ? hand.palm : hand.pts[8], prevTip = isMouse ? hand.prevPalm : hand.prevPts[8];
      const S = hand.size * (this.settings.brushSize || 1);
      b.r = b.tool === 'eraser' ? S * 0.5 : S * (isMouse ? 0.3 : 0.2);
      b.tip = tip; b.active = false;
      // ① 握拳停在颜料罐 / 橡皮擦上 = 选中（只选，不画）
      const grabbing = tile && (isMouse ? (hand.down && !hand.consumed) : (hand.active !== false && hand.gesture === 'fist'));
      if (grabbing) {
        if (b.pot !== tile) { b.pot = tile; b.grab = 0; }
        if (b.grab >= 0) b.grab += dt / (isMouse ? GRAB_SEC_MOUSE : GRAB_SEC);
        if (b.grab >= 1) { this._load(b, tile, hand); b.grab = -0.8; }
        continue;
      }
      if (b.grab > 0) b.grab = Math.max(0, b.grab - dt * 3); else if (b.grab < 0) b.grab = Math.min(0, b.grab + dt);
      if (!tile) b.pot = null;
      // ② 只有画笔姿势才画；张开手、握拳、其他手势都只是移动
      if (!PaintMode.isBrushPose(hand) || tile) continue;
      if (!b.tool) {
        if (now - (b.hintAt || -1e9) > 8000 && this.canvas.inside(tip[0], tip[1])) {
          b.hintAt = now; this.app.toast('先把手握成拳头，放在颜料罐上抓一个颜色 ✊', 2400);
          const lang = this.settings.lang, zh = { text: '先握拳抓一个颜色', lang: 'zh' }, en = { text: 'Grab a color first', lang: 'en' };
          this.speech.say(lang === 'en' ? [en] : lang === 'zh' ? [zh] : [zh, en], 3000);
        }
        continue;
      }
      if (!this.canvas.inside(tip[0], tip[1]) || this.ui.hit(tip[0], tip[1])) continue;
      b.active = true; b.usedAt = now;
      if (now - this.lastPaintAt > 350) this.canvas.snapshot(); // 新的一笔：存一份撤销点
      this.lastPaintAt = now; painting = true;
      if (b.tool === 'eraser') this.canvas.erase(prevTip[0], prevTip[1], tip[0], tip[1], b.r);
      else {
        b.amount = 1; // 选中的颜色不会用完
        this.canvas.stroke(prevTip[0], prevTip[1], tip[0], tip[1], b.r, b);
        this._checkDiscovery(hand, tip);
      }
      moved += Math.hypot(tip[0] - prevTip[0], tip[1] - prevTip[1]);
    }
    for (const b of this.brushes.values()) if (!seen.has(b)) { b.active = false; b.grab = 0; b.pot = null; } // 手丢了：颜色保留，只清掉进行中的抓取
    const liveIds = new Set(hands.map(h => h.id));
    for (const id of this.trackKey.keys()) if (!liveIds.has(id)) { this.trackKey.delete(id); this.trackSince.delete(id); }
    const speed = dt > 0 ? moved / dt / this.unit : 0;
    this.sfx.setWipe(painting ? Math.min(0.6, speed / 4) : 0, 'mud');
    this.effects.update(dt);
  }

  _load(b, pot, hand) {
    b.sel = pot; b.seed = Math.random() * 255; b.usedAt = performance.now();
    if (pot.isEraser) { b.tool = 'eraser'; }
    else { b.tool = 'paint'; b.lat.set(pot.lat); b.amount = 1; b.rgb = [...pot.rgb]; }
    this.sfx.pop(); this.effects.sparkle(pot.x + pot.w / 2, pot.y + pot.h * 0.45, 10);
    const lang = this.settings.lang;
    this.speech.say(lang === 'en' ? [{ text: pot.en, lang: 'en' }] : lang === 'zh' ? [{ text: pot.zh, lang: 'zh' }] : [{ text: pot.zh, lang: 'zh' }, { text: pot.en, lang: 'en' }], 3000);
    this.bus.emit('paint:grab', { color: pot.id, tool: b.tool });
  }

  /** 混出新颜色：画布上笔刷中心的颜色稳定为某个“非原色”若干帧 */
  _checkDiscovery(hand, [x, y]) {
    const s = this.canvas.sample(x, y);
    const st = this.streak.get(hand.id) || { id: null, n: 0 };
    if (!s || s.amount < 0.5) { st.n = 0; this.streak.set(hand.id, st); return; }
    const nm = nameColor(s.rgb);
    if (nm.base || nm.distance > 28) { st.id = null; st.n = 0; this.streak.set(hand.id, st); return; }
    if (st.id === nm.id) st.n++; else { st.id = nm.id; st.n = 1; }
    this.streak.set(hand.id, st);
    if (st.n >= 8 && !this.discovered.some(d => d.id === nm.id)) {
      this.discovered.push({ id: nm.id, zh: nm.zh, en: nm.en, rgb: nm.rgb, t: performance.now() });
      this.effects.sparkle(x, y, 18); this.sfx.fanfare(false);
      const lang = this.settings.lang;
      const parts = lang === 'en' ? [{ text: `Wow! ${nm.en}!`, lang: 'en' }] : lang === 'zh' ? [{ text: `哇！${nm.zh}！`, lang: 'zh' }]
        : [{ text: `哇！${nm.zh}！`, lang: 'zh' }, { text: nm.en, lang: 'en' }];
      this.speech.say(parts, 4000);
      this.app.toast(`你调出了 ${nm.zh} ${nm.en}！`, 2200);
      this.log.record('color_discovered', { id: nm.id });
      this.bus.emit('paint:discover', { id: nm.id });
    }
  }

  /** 手的装饰：手心显示当前工具（颜料球 / 橡皮擦），食指指尖显示笔尖光圈（画笔姿势时发光） */
  handDecor(hand) {
    const b = this.brushes.get(this._key(hand));
    if (!b) return {};
    const tip = hand.source === 'hand' ? hand.pts[8] : hand.palm;
    return {
      paint: b.tool === 'paint' ? { rgb: b.rgb, amount: 1 } : null,
      eraser: b.tool === 'eraser',
      grab: b.grab > 0 ? Math.min(1, b.grab) : 0,
      tip: { x: tip[0], y: tip[1], r: b.r || hand.size * 0.2, tool: b.tool, rgb: b.rgb, active: b.active, pose: PaintMode.isBrushPose(hand), mouse: hand.source !== 'hand' },
    };
  }

  /** 静态背景（渐变、画纸边框、颜料罐、颜色卡）只在变化时重画一次，每帧只贴一张图 */
  _background() {
    const key = this.discovered.length;
    if (this._bg && this._bgKey === key) return this._bg;
    const { W, H } = this;
    const bg = this._bg || document.createElement('canvas');
    bg.width = W; bg.height = H;
    const ctx = bg.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d9ecf7'); g.addColorStop(1, '#f6e7d8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const r = this.rect;
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#fff'; roundRect(ctx, r.x - 8, r.y - 8, r.w + 16, r.h + 16, 18); ctx.fill(); ctx.restore();
    for (const p of this.pots) this._drawPot(ctx, p);
    this._drawEraserTile(ctx, this.eraser);
    this._drawColorCard(ctx);
    this._drawHintStrip(ctx);
    this._bg = bg; this._bgKey = key;
    return bg;
  }

  render(ctx) {
    ctx.drawImage(this._background(), 0, 0);
    const r = this.rect;
    ctx.save(); roundRect(ctx, r.x, r.y, r.w, r.h, 12); ctx.clip();
    this.canvas.render(ctx);
    if (this.lineArt) ctx.drawImage(this.lineArt, r.x, r.y);
    ctx.restore();
    // 当前选中的颜料罐 / 橡皮擦：用手的颜色描边
    for (const h of this._lastHands || []) {
      const k = this._key(h), b = this.brushes.get(k);
      if (!b || !b.sel) continue;
      const p = b.sel, col = this._styleColor(k);
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = Math.max(3, p.w * 0.05); ctx.setLineDash([p.w * 0.12, p.w * 0.07]);
      roundRect(ctx, p.x - 4, p.y + (p.isEraser ? 0 : p.h * 0.12) - 4, p.w + 8, p.h * (p.isEraser ? 1 : 0.88) + 8, p.w * 0.2); ctx.stroke(); ctx.restore();
    }
    // 抓取进度环（动态部分）
    for (const b of this.brushes.values()) {
      if (!(b.grab > 0) || !b.pot) continue;
      const p = b.pot, cx = p.x + p.w / 2, py = p.y + p.h * (p.isEraser ? 0.38 : 0.44), pr = p.w * 0.29;
      ctx.save(); ctx.strokeStyle = '#ffbe0b'; ctx.lineWidth = p.w * 0.07; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, py, pr * 1.25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, b.grab)); ctx.stroke(); ctx.restore();
    }
    this.ui.render(ctx);
    this.effects.render(ctx);
  }

  _styleColor(k) {
    const h = (this._lastHands || []).find(h => this._key(h) === k);
    return h?.style?.stroke || (k.startsWith('h:蓝') ? '#3a86ff' : '#ff9f1c');
  }

  /** 橡皮擦块：粉色橡皮 + 蓝色纸套，下方写“橡皮擦 Eraser” */
  _drawEraserTile(ctx, p) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = p.w * 0.1; ctx.shadowOffsetY = p.w * 0.04;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(ctx, p.x, p.y, p.w, p.h, p.w * 0.18); ctx.fill();
    ctx.shadowColor = 'transparent';
    drawEraserIcon(ctx, p.x + p.w / 2, p.y + p.h * 0.38, p.w * 0.62);
    const fs = p.w * 0.18;
    ctx.fillStyle = '#2b2d42'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${fs}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    ctx.fillText('橡皮擦', p.x + p.w / 2, p.y + p.h * 0.72);
    ctx.font = `600 ${fs * 0.65}px "Arial Rounded MT Bold","Nunito",sans-serif`; ctx.fillStyle = '#667';
    ctx.fillText('Eraser', p.x + p.w / 2, p.y + p.h * 0.72 + fs * 0.9);
    ctx.restore();
  }

  /** 顶部右侧的手势提示条 */
  _drawHintStrip(ctx) {
    const { W, H } = this, x = W * 0.655, y = H * 0.022, w = W * 0.333, h = H * 0.075;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
    const items = [['✊', '选颜色'], ['☝️', '画画'], ['✋', '不画']];
    const fs = Math.min(h * 0.4, w / 13);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#2b2d42';
    items.forEach(([ic, t], i) => {
      const cx = x + w * (i + 0.5) / 3;
      ctx.font = `${fs * 1.15}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(ic, cx - fs * 1.35, y + h / 2);
      ctx.font = `800 ${fs}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
      ctx.fillText(t, cx + fs * 0.75, y + h / 2 + fs * 0.04);
    });
    ctx.restore();
  }

  _drawPot(ctx, p) {
    const [R, G, B] = p.rgb;
    ctx.save();
    const cx = p.x + p.w / 2;
    // 罐身
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = p.w * 0.1; ctx.shadowOffsetY = p.w * 0.04;
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(ctx, p.x, p.y + p.h * 0.12, p.w, p.h * 0.88, p.w * 0.18); ctx.fill();
    ctx.shadowColor = 'transparent';
    // 颜料（湿亮的一团）
    const py = p.y + p.h * 0.44, pr = p.w * 0.29;
    const gr = ctx.createRadialGradient(cx - pr * 0.35, py - pr * 0.4, pr * 0.1, cx, py, pr);
    gr.addColorStop(0, `rgb(${Math.min(255, R + 80)},${Math.min(255, G + 80)},${Math.min(255, B + 80)})`);
    gr.addColorStop(0.5, `rgb(${R},${G},${B})`); gr.addColorStop(1, `rgb(${R * 0.65 | 0},${G * 0.65 | 0},${B * 0.65 | 0})`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(cx, py, pr, pr * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    if (p.id === 'white') { ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(cx - pr * 0.35, py - pr * 0.4, pr * 0.22, pr * 0.12, -0.5, 0, Math.PI * 2); ctx.fill();
    // 标签
    const fs = p.w * 0.2;
    ctx.fillStyle = '#2b2d42'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${fs}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    const ly = Math.min(py + pr * 0.85 + fs * 0.75, p.y + p.h - fs * 1.35);
    ctx.fillText(p.zh.replace('色', ''), cx, ly);
    ctx.font = `600 ${fs * 0.6}px "Arial Rounded MT Bold","Nunito",sans-serif`; ctx.fillStyle = '#667';
    ctx.fillText(p.en, cx, ly + fs * 0.88);
    ctx.restore();
  }

  _drawColorCard(ctx) {
    const c = this.colorCard;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; roundRect(ctx, c.x, c.y, c.w, c.h, c.w * 0.12); ctx.fill();
    ctx.fillStyle = '#2b2d42'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const fs = c.w * 0.14;
    ctx.font = `800 ${fs}px "PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
    ctx.fillText('我发现的颜色', c.x + c.w / 2, c.y + fs * 0.6);
    const sw = c.w * 0.34, cols = 2, gap = (c.w - sw * cols) / 3;
    const y0 = c.y + fs * 2.2;
    if (!this.discovered.length) {
      ctx.fillStyle = '#99a'; ctx.font = `600 ${fs * 0.75}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText('把两种颜色', c.x + c.w / 2, y0 + fs * 0.4); ctx.fillText('涂在一起试试', c.x + c.w / 2, y0 + fs * 1.4);
      // 示意：红 + 黄 = ?
      const yy = y0 + fs * 3.4, rr = c.w * 0.1;
      [[230, 30, 35], null, [254, 220, 0]].forEach((col, i) => {
        const xx = c.x + c.w * (0.25 + i * 0.25);
        if (col) { ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(xx, yy, rr, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.fillStyle = '#556'; ctx.font = `800 ${fs}px sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText('+', xx, yy); ctx.textBaseline = 'top'; }
      });
    }
    this.discovered.forEach((d, i) => {
      const col = i % cols, row = (i / cols) | 0;
      const x = c.x + gap + col * (sw + gap), y = y0 + row * (sw + fs * 1.3);
      if (y + sw > c.y + c.h) return;
      ctx.save(); ctx.translate(x + sw / 2, y + sw / 2);
      ctx.fillStyle = `rgb(${d.rgb})`; ctx.beginPath(); ctx.arc(0, 0, sw * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2b2d42'; ctx.font = `700 ${fs * 0.62}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillText(d.zh, x + sw / 2, y + sw * 0.92);
    });
    ctx.restore();
  }
}

function inside(x, y, b, pad = 0) { return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad; }
