// 玩法层 · 投水球。
// 在篮子上握拳 = 拿起一个水球（在虚拟手里晃）；朝屏幕挥手、张开手 = 扔出去。
// 出手方向和速度来自出手前几帧（平滑后的）掌心轨迹，带一点向上的弧线；瞄准辅助很宽松，5 岁孩子也常常能打中。
// 自由模式：小怪兽没有标签，打中就算；打中 N 次后切到“目标模式”：3–4 只怪兽身上有数字 / 字母 / 汉字，语音说打哪一个。
// 鼠标 / 触屏：在篮子上按下 = 拿水球，拖动后松开 = 按指针速度扔出。
// 安全区：所有元素（篮子、怪兽、标签、按钮）都放在离屏幕边一段距离的范围里；篮子的感应区一直延伸到屏幕下沿，
// 孩子手放得很低（被安全区夹在屏幕底边）也能拿到水球，不需要把手伸出摄像头识别范围。
import { releaseVelocity, throwPlan, aimAssist, labelPool, pickLabel, pickTarget, promptParts } from './throwLogic.js';
import { sceneLayout, drawSky, drawMid, drawBushes, drawMonster, drawBalloon, drawBasket, monsterBox, tearPoints, drawTear, MONSTER_COLORS, BALLOON_COLORS, LABEL_FONT } from '../render/throwArt.js';
import { preloadMonsters, MONSTER_KINDS, readyKinds } from '../render/monsterSprites.js';
import { roundRect, star, EMOJI_FONT } from '../render/cardArt.js';

const GRAB_SEC = 0.12;          // 真手握拳在篮子上停这么久就拿起（防止路过时误拿）
const LOST_DROP_SEC = 0.5;      // 拿着水球的真手丢失这么久 → 水球放回篮子
const CANCEL_SPEED = 0.3;       // 在篮子里张开手、手几乎没动：当作放回去，不扔（单位：画面短边 / 秒）
const REPEAT_SEC = 8;           // 多久没打中就再说一遍题目
const CRY_SEC = 1.5;            // 被打中后哭多久，然后缩回去
const RAINBOW = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#52d273', '#3a86ff', '#8338ec'];
const PRAISE = { zh: ['打中啦！', '真棒！', '好厉害！', '太准了！'], en: ['Great shot!', 'Yay!', 'Awesome!', 'Nice throw!'] };

export class ThrowMode {
  constructor(ctx) {
    Object.assign(this, ctx); // { effects, sfx, speech, bus, log, settings, ui, app }
    this.name = 'throw';
    this.W = 1; this.H = 1; this.t = 0;
    this.monsters = []; this.balloons = []; this.parts = []; this.decals = []; this.flyStars = [];
    this.held = new Map(); this.samples = new Map(); this.grabT = new Map(); this.cool = new Map();
    this.hits = 0; this.freeHits = 0; this.throws = 0; this.phase = 'free';
    this.target = null; this.lastTargetText = null; this.promptAt = 0; this.promptDue = -1; this.lead = false;
    this.walk = true; this.rng = Math.random; this.starPulse = 0; this._content = null;
    this.tears = [];
    preloadMonsters(); // 小怪兽贴图（没加载好时自动用程序绘制的旧怪兽）
  }

  enter() {
    this.t = 0; this.hits = 0; this.freeHits = 0; this.throws = 0;
    this.balloons = []; this.parts = []; this.decals = []; this.flyStars = []; this.tears = []; this.held.clear();
    this._content = this.settings.throwContent || 'num';
    this.phase = this.settings.throwSkipFree ? 'target' : 'free';
    this._layout(); this._buttons();
    this.monsters = [];
    const n = this.phase === 'free' ? 3 : this._targetCount();
    for (let i = 0; i < n; i++) this.monsters.push(this._newMonster(i, 0.2 + i * 0.35));
    if (this.phase === 'target') { this.promptDue = 1.6; this.lead = false; }
    const lang = this.settings.lang;
    const zh = { text: '在篮子里握拳拿水球，挥手扔向小怪兽！', lang: 'zh' }, en = { text: 'Grab a water balloon and throw it at the monsters!', lang: 'en' };
    this.speech.say(lang === 'en' ? [en] : lang === 'zh' ? [zh] : [zh, en], 6000);
    this.app.toast('✊ 在篮子里握拳拿水球 · 👋 挥手、张开手扔出去', 4500);
    this.bus.emit('throw:start', { phase: this.phase });
  }
  exit() { this.held.clear(); this.balloons = []; }

  resize(W, H) {
    const changed = Math.abs(W - this.W) > 2 || Math.abs(H - this.H) > 2;
    this.W = W; this.H = H; this.effects.resize(W, H);
    if (changed || !this.L) { this._layout(); this._buttons(); for (const m of this.monsters) this._placeOnRow(m, m.row); }
  }

  applySettings(s) {
    const prev = this.settings || {};
    this.settings = s;
    if (!this.L) return;
    const content = s.throwContent || 'num';
    if (content !== this._content) {
      this._content = content;
      if (this.phase === 'target') { for (const m of this.monsters) m.label = null; for (const m of this.monsters) m.label = this._newLabel(); this.target = null; this.promptDue = this.t + 0.6; }
    }
    if (s.throwSkipFree && !prev.throwSkipFree && this.phase === 'free') this._toTarget();
  }

  _targetCount() { return this.W / this.H < 1.2 ? 3 : 4; }

  _layout() {
    const L = this.L = sceneLayout(this.W, this.H);
    this.u = L.u;
    this.basket = L.basket;
    this.layers = null; // 下一帧重画场景缓存
  }

  _buttons() {
    const { W, H } = this, I = this.L.inset, bh = H * 0.075;
    this.ui.set([
      { id: 'home', label: '🏠 首页', x: I.x0, y: I.y0, w: W * 0.1, h: bh, dwell: 1.5, onActivate: () => this.app.goMode('home') },
      { id: 'repeat', label: '🔊 再听', x: I.x0 + W * 0.115, y: I.y0, w: W * 0.1, h: bh, dwell: 1.2, visible: this.phase === 'target', onActivate: () => this._sayPrompt() },
    ]);
  }

  // ---------- 怪兽 ----------
  _newMonster(i, delay) {
    const m = { id: i, col: MONSTER_COLORS[i % MONSTER_COLORS.length], variant: i, state: 'hidden', timer: delay, rise: 0, x: 0, cy: 0, r: 1, row: null,
      vx: 0, wet: 0, mood: 'happy', moodT: 0, label: null, life: 0, t: this.rng() * 10, squash: 0, tilt: 0, dodge: null, blink: false, kind: i % MONSTER_KINDS.length, sob: 0, hitT: 0, tearT: 0 };
    return m;
  }

  /** 选一排、一个不和别的怪兽挤在一起的位置。 */
  _spawn(m) {
    const L = this.L, others = this.monsters.filter(o => o !== m && o.state !== 'hidden');
    // 两排轮流放：近排（灌木后，个子大、字大）至少和远排一样多，远排最多 2 只
    const nearCount = others.filter(o => o.row === L.rows[1]).length, farCount = others.length - nearCount;
    let row = farCount >= 2 || nearCount < farCount ? L.rows[1] : nearCount > farCount ? L.rows[0] : (this.rng() < 0.6 ? L.rows[1] : L.rows[0]);
    let best = null, bestD = -1;
    for (let k = 0; k < 24; k++) {
      const x = row.x0 + this.rng() * (row.x1 - row.x0);
      const d = Math.min(Infinity, ...others.filter(o => o.row === row).map(o => Math.abs(o.x - x) / (row.r + o.r)));
      if (d > bestD) { bestD = d; best = x; }
      if (d > 1.6 && k > 4) break;
      if (k === 11 && bestD < 1.3) row = row === L.rows[0] ? L.rows[1] : L.rows[0]; // 这一排太挤：换另一排
    }
    m.row = row; m.x = best; m.r = row.r;
    m.col = MONSTER_COLORS[Math.floor(this.rng() * MONSTER_COLORS.length)]; m.variant = Math.floor(this.rng() * 6);
    // 贴图种类：尽量和画面上的其它怪兽不一样
    // 8 种里随机挑，优先挑已经加载好贴图、且画面上没有的那种
    const used = new Set(others.map(o => o.kind)), all = MONSTER_KINDS.map((_, k) => k), ready = readyKinds();
    const readyFree = ready.filter(k => !used.has(k)), free = all.filter(k => !used.has(k));
    const pool = readyFree.length ? readyFree : ready.length ? ready : free.length ? free : all;
    m.kind = pool[Math.floor(this.rng() * pool.length)]; m.sob = 0;
    m.vx = (this.rng() < 0.5 ? -1 : 1) * this.W * (0.02 + this.rng() * 0.025);
    m.state = 'rise'; m.rise = 0; m.wet = 0; m.mood = 'surprise'; m.moodT = 0.5; m.dodge = null;
    m.life = this.phase === 'free' ? 6 + this.rng() * 4 : 12 + this.rng() * 8;
    m.label = this.phase === 'target' ? this._newLabel(m) : null;
    this._placeOnRow(m, row);
    this.sfx.boing?.();
  }

  _placeOnRow(m, row) { if (!row) return; const r = this.L.rows.find(rr => rr.id === row.id); m.row = r; m.r = r.r; m.x = Math.max(r.x0, Math.min(r.x1, m.x)); m.cy = r.hideY + (r.upY - r.hideY) * ease(m.rise); }

  _newLabel(m) {
    const pool = labelPool(this._content || 'num');
    const ex = this.monsters.filter(o => o !== m && o.label).map(o => o.label.text);
    if (this.lastTargetText) ex.push(this.lastTargetText);
    if (this.target?.label) ex.push(this.target.label.text);
    return pickLabel(pool, ex, this.rng);
  }

  hittable(m) { return (m.state === 'up' || (m.state === 'rise' && m.rise > 0.6)) && !m.dodge; }
  get visibleMonsters() { return this.monsters.filter(m => m.state !== 'hidden'); }

  _updateMonsters(dt) {
    for (const m of this.monsters) {
      m.t += dt; m.moodT -= dt; if (m.moodT <= 0 && m.state === 'up') m.mood = 'happy';
      m.blink = (m.t % 3.7) < 0.12;
      m.wet = Math.max(0, m.wet - dt * 0.35);
      m.squash *= Math.exp(-dt * 8);
      const row = m.row;
      if (m.state === 'hidden') { m.timer -= dt; if (m.timer <= 0) this._spawn(m); continue; }
      if (m.state === 'rise') { m.rise = Math.min(1, m.rise + dt / 0.45); if (m.rise >= 1) { m.state = 'up'; m.squash = 0.8; } }
      else if (m.state === 'hit') {
        // 哭：换哭脸、抖一抖、一抽一抽地抽泣，眼泪往下掉
        m.timer -= dt; m.hitT += dt;
        m.sob = Math.max(0, Math.sin(m.hitT * 11)) * 0.07 * Math.min(1, m.hitT * 4);
        m.tearT -= dt;
        if (m.tearT <= 0) { m.tearT = 0.09; this._emitTears(m); }
        if (m.timer <= 0) { m.state = 'duck'; m.sob = 0; }
      }
      else if (m.state === 'duck') { m.rise = Math.max(0, m.rise - dt / 0.35); if (m.rise <= 0) { m.state = 'hidden'; m.timer = 0.6 + this.rng() * 0.8; m.label = null; if (this.target === m) this.target = null; } }
      else if (m.state === 'up') {
        m.life -= dt;
        // 目标模式里，当前要打的那只不会自己躲起来（保证目标一直在画面里）
        if (m.life <= 0 && m !== this.target && !this.balloons.some(b => b.mon === m || b.dodgeMon === m)) { m.state = 'duck'; continue; }
        if (this.walk && !m.dodge) {
          m.x += m.vx * dt;
          if (m.x < row.x0 || m.x > row.x1) { m.x = Math.max(row.x0, Math.min(row.x1, m.x)); m.vx = -m.vx; }
          for (const o of this.monsters) if (o !== m && o.row === row && o.state !== 'hidden' && Math.abs(o.x - m.x) < (o.r + m.r) * 1.25 && Math.sign(o.x - m.x) === Math.sign(m.vx)) { m.vx = -m.vx; break; }
        }
      }
      // 躲开（打错了）：往旁边一跳
      if (m.dodge) {
        const d = m.dodge; d.t += dt; const k = Math.min(1, d.t / 0.4);
        m.x = Math.max(row.x0, Math.min(row.x1, d.x0 + d.dx * ease(k)));
        if (k >= 1) { m.dodge = null; m.vx = Math.sign(d.dx) * Math.abs(m.vx); }
      }
      if (m.state === 'hit') {
        m.tilt = Math.sin(m.hitT * 38) * 0.09 * Math.exp(-m.hitT * 3.5) + Math.sin(m.hitT * 7) * 0.03;
        m.cy = row.hideY + (row.upY - row.hideY) * ease(m.rise); continue;
      }
      m.tilt = Math.sin(m.t * 5) * 0.06 + (m.dodge ? Math.sign(m.dodge.dx) * 0.2 : 0);
      const hop = m.dodge ? Math.sin(Math.min(1, m.dodge.t / 0.4) * Math.PI) * m.r * 0.6 : Math.abs(Math.sin(m.t * 6)) * m.r * 0.05;
      m.cy = row.hideY + (row.upY - row.hideY) * ease(m.rise) - hop;
    }
  }

  // ---------- 拿 / 扔 ----------
  _inBasket(x, y) {
    const b = this.basket, p = this.u * 0.07;
    // 感应区比篮子大一圈，并一直延伸到屏幕下沿（手被安全区夹在底边时也能拿到）
    return x >= b.x - p && x <= b.x + b.w + p && y >= b.y - p * 1.5 && y <= this.H + 1;
  }

  _update_hands(dt, hands, now) {
    const seen = new Set();
    for (const h of hands) {
      seen.add(h.id);
      const isPtr = h.source !== 'hand';
      if (!isPtr && h.active === false) continue;
      let s = this.samples.get(h.id); if (!s) { s = []; this.samples.set(h.id, s); }
      s.push({ x: h.palm[0], y: h.palm[1], t: now }); while (s.length && now - s[0].t > 400) s.shift();
      const fist = isPtr ? !!(h.down && !h.consumed) : h.gesture === 'fist';
      const held = this.held.get(h.id);
      if (held) {
        held.t += dt; held.lost = 0; held.source = h.source;
        if (!fist) this._release(h.id, [h.palm[0], h.palm[1]], now);
        continue;
      }
      const cool = (this.cool.get(h.id) || 0) > now;
      if (fist && !cool && this._inBasket(h.palm[0], h.palm[1])) {
        const g = (this.grabT.get(h.id) || 0) + dt; this.grabT.set(h.id, g);
        if (isPtr || g >= GRAB_SEC) this._grab(h);
      } else this.grabT.set(h.id, 0);
    }
    // 拿着水球的手不见了：触屏 = 手指抬起 → 扔出；真手 = 识别丢失一会儿 → 放回篮子
    for (const [id, held] of this.held) {
      if (seen.has(id)) continue;
      if (held.source === 'touch') { const s = this.samples.get(id); const last = s && s[s.length - 1]; this._release(id, last ? [last.x, last.y] : [this.basket.x, this.basket.y], now); continue; }
      held.lost = (held.lost || 0) + dt;
      if (held.lost > LOST_DROP_SEC) this.held.delete(id);
    }
    for (const id of this.samples.keys()) if (!seen.has(id) && !this.held.has(id)) this.samples.delete(id);
  }

  _grab(h) {
    const color = BALLOON_COLORS[Math.floor(this.rng() * BALLOON_COLORS.length)];
    this.held.set(h.id, { color, t: 0, source: h.source, lost: 0 });
    const s = this.samples.get(h.id); if (s && s.length) this.samples.set(h.id, [s[s.length - 1]]); // 出手速度只看拿起水球之后的轨迹（不受之前手 / 鼠标跳动的影响）
    this.grabT.set(h.id, 0);
    this.sfx.pop();
    this.bus.emit('throw:grab', { hand: h.id });
  }

  _release(id, origin, now) {
    const held = this.held.get(id); if (!held) return;
    this.held.delete(id);
    const v = releaseVelocity(this.samples.get(id) || [], now);
    const u = this.u, speed = Math.hypot(v[0], v[1]) / u;
    this.cool.set(id, now + 250);
    if (speed < CANCEL_SPEED && this._inBasket(origin[0], origin[1])) { this.bus.emit('throw:cancel', {}); return; } // 在篮子里松手：放回去
    const plan = throwPlan(origin, v, u);
    const cands = this.monsters.filter(m => this.hittable(m)).map(m => ({ m, x: m.x, y: m.cy }));
    // 手（或手指）已经在怪兽身上松开：直接砸中它（触屏孩子常把水球拖到怪兽上再松手）
    const dist = (c) => Math.hypot(c.x - origin[0], c.y - origin[1]);
    const under = cands.filter(c => dist(c) < c.m.r * 1.3).sort((a, b) => dist(a) - dist(b))[0];
    const pick = under || aimAssist(origin, plan.dir, plan.landing, cands, u);
    const b = { x0: origin[0], y0: origin[1], tx: plan.landing[0], ty: plan.landing[1], u: 0, dur: plan.dur, arc: plan.arc, color: held.color, r0: u * 0.045, mon: null, dodgeMon: null, x: origin[0], y: origin[1], r: u * 0.045 };
    if (pick) {
      const m = pick.m, d = Math.hypot(m.x - origin[0], m.cy - origin[1]);
      b.dur = Math.min(0.8, Math.max(0.45, 0.3 + d / u * 0.35)); b.arc = u * (0.1 + 0.08 * d / u);
      b.tx = m.x; b.ty = m.cy;
      const wrong = this.phase === 'target' && this.target && m !== this.target;
      if (wrong) b.dodgeMon = m; else b.mon = m;
    }
    this.balloons.push(b);
    this.throws++;
    this.sfx.swoosh?.();
    this.bus.emit('throw:release', { v, speed, aimed: pick ? pick.m.id : null });
    this.lastThrow = { v, speed, dir: plan.dir, origin, aimed: pick ? pick.m.id : null };
  }

  _updateBalloons(dt) {
    const keep = [];
    for (const b of this.balloons) {
      b.u = Math.min(1, b.u + dt / b.dur);
      if (b.mon && this.hittable(b.mon)) { b.tx = b.mon.x; b.ty = b.mon.cy; } // 追着目标飞（怪兽在走）
      if (b.dodgeMon && b.u > 0.45 && !b.dodgeMon.dodge && b.dodgeMon.state === 'up') this._dodge(b.dodgeMon);
      const e = b.u;
      b.x = b.x0 + (b.tx - b.x0) * e; b.y = b.y0 + (b.ty - b.y0) * e - b.arc * 4 * e * (1 - e);
      b.r = b.r0 * (1 - 0.35 * e);
      if (b.u >= 1) this._land(b); else keep.push(b);
    }
    this.balloons = keep;
  }

  _land(b) {
    if (b.mon && this.hittable(b.mon)) return this._hit(b.mon, b);
    if (!b.dodgeMon) {
      // 没有被瞄准辅助锁定：落点附近刚好有怪兽也算打中
      const m = this.monsters.find(m => this.hittable(m) && Math.hypot(m.x - b.tx, m.cy - b.ty) < m.r * 1.1);
      if (m) {
        if (this.phase === 'target' && this.target && m !== this.target) this._dodge(m);
        else return this._hit(m, b);
      }
    }
    // 打偏：水花溅在篱笆或草地上
    const L = this.L, I = L.inset;
    let x = Math.max(I.x0, Math.min(I.x1, b.tx)), y = Math.max(L.fenceTop + L.u * 0.03, Math.min(I.y1, b.ty));
    if (b.dodgeMon) y = Math.max(y, b.dodgeMon.cy + b.dodgeMon.r * 0.5);
    this._splash(x, y, false, y < L.fenceBot ? 'fence' : 'grass');
    this.sfx.splash(false);
    this.bus.emit('throw:miss', { x, y, dodged: !!b.dodgeMon });
  }

  _dodge(m) {
    const row = m.row, room = m.r * 1.8;
    const dx = (m.x - row.x0 < room ? 1 : row.x1 - m.x < room ? -1 : (this.rng() < 0.5 ? -1 : 1)) * room;
    m.dodge = { t: 0, x0: m.x, dx }; m.mood = 'giggle'; m.moodT = 1.2;
    this.sfx.giggle?.();
    this.promptAt = this.t; this.repeatAt = this.t + 1.8; // 没打对：笑一笑躲开，过一会儿再提示一次
    this.bus.emit('throw:wrong', { label: m.label?.text, target: this.target?.label?.text });
  }

  _hit(m, b) {
    const correct = this.phase === 'free' || (this.target && m === this.target);
    const rainbow = this.phase === 'target' && correct;
    m.wet = 1; m.squash = 1; m.mood = 'cry'; m.moodT = CRY_SEC; m.hitT = 0; m.tearT = 0.15;
    m.state = 'hit'; m.timer = CRY_SEC;
    this._splash(m.x, m.cy, rainbow, null, m.r, true);
    // 被打中就哭（哭脸 + 掉眼泪 + 委屈的“哇——哇”）
    for (const [tx, ty] of tearPoints(m)) for (let k = 0; k < 2; k++) this._squirtTear(m, tx, ty);
    this.sfx.splash(true); setTimeout(() => this.sfx.cry?.(), 140);
    this.promptAt = this.t;
    if (!correct) { this.bus.emit('throw:neutral', { label: m.label?.text }); return; } // 目标模式里还没出题时打中：不计分
    this.hits++; this.starPulse = 1;
    this.flyStars.push({ x: m.x, y: m.cy, u: 0 });
    const lang = this.settings.lang, i = Math.floor(this.rng() * PRAISE.zh.length);
    if (this.phase === 'free') {
      this.freeHits++;
      const need = Math.max(1, this.settings.throwFreeHits || 5);
      this.bus.emit('throw:hit', { phase: 'free', hits: this.hits, freeHits: this.freeHits });
      if (this.freeHits >= need) { this._toTarget(); return; }
      this.speech.say(lang === 'en' ? [{ text: PRAISE.en[i], lang: 'en' }] : [{ text: PRAISE.zh[i], lang: 'zh' }], 2000);
    } else {
      this.bus.emit('throw:hit', { phase: 'target', hits: this.hits, label: m.label?.text, correct: true });
      this.sfx.fanfare(false);
      this.effects.sparkle(m.x, m.cy - m.r * 2.1, 8); // 星星在头顶上，不挡哭脸
      this.speech.say(lang === 'en' ? [{ text: PRAISE.en[i], lang: 'en' }] : lang === 'zh' ? [{ text: PRAISE.zh[i], lang: 'zh' }] : [{ text: PRAISE.zh[i], lang: 'zh' }, { text: PRAISE.en[i], lang: 'en' }], 2500);
      this.target = null; this.promptDue = this.t + 2.0;
    }
  }

  /** 自由模式 → 目标模式：怪兽们躲起来，再带着标签冒出来，然后出第一题。 */
  _toTarget() {
    if (this.phase === 'target') return;
    this.phase = 'target'; this.lead = true; this.target = null;
    const lang = this.settings.lang;
    this.speech.say(lang === 'en' ? [{ text: 'Awesome!', lang: 'en' }] : [{ text: '太棒了！', lang: 'zh' }], 2000);
    while (this.monsters.length < this._targetCount()) this.monsters.push(this._newMonster(this.monsters.length, 0.6));
    for (const m of this.monsters) {
      if (m.state === 'up' || m.state === 'rise') m.state = 'duck';
      if (m.state === 'hidden') m.timer = Math.min(m.timer, 0.4 + this.rng() * 0.6);
    }
    this.promptDue = this.t + 2.0;
    this._buttons();
    this.bus.emit('throw:phase', { phase: 'target' });
  }

  _sayPrompt(lead = false) {
    if (!this.target?.label) return;
    this.speech.say(promptParts(this.target.label, this.settings.lang, lead), 4000);
    this.promptAt = this.t; this.repeatAt = -1;
  }

  _updatePrompt() {
    if (this.phase !== 'target') return;
    if (this.target && (this.target.state === 'hidden' || this.target.state === 'duck' || !this.target.label)) this.target = null;
    if (!this.target && this.promptDue >= 0 && this.t >= this.promptDue) {
      const ready = this.monsters.filter(m => m.label && (m.state === 'up' || m.state === 'rise'));
      if (ready.length >= Math.min(2, this._targetCount())) {
        this.target = pickTarget(ready, this.lastTargetText, this.rng);
        if (this.target) {
          this.lastTargetText = this.target.label.text;
          this.target.life = Infinity;
          this._sayPrompt(this.lead); this.lead = false; this.promptDue = -1;
          this.bus.emit('throw:prompt', { label: this.target.label.text, type: this.target.label.type });
        }
      }
    }
    if (this.target && !this.balloons.length) {
      if (this.repeatAt > 0 && this.t >= this.repeatAt) this._sayPrompt();
      else if (this.t - this.promptAt > REPEAT_SEC) this._sayPrompt();
    }
  }

  // ---------- 眼泪粒子 ----------
  /** 脸颊上掉下来的眼泪（大部分往下落，少数往两边飞） */
  _emitTears(m) {
    if (this.tears.length > 40) return;
    const pts = tearPoints(m), s = m.r / 50;
    for (const [i, [x, y]] of pts.entries()) {
      if (this.rng() < 0.25) { this._squirtTear(m, x, y); continue; }
      const side = i ? 1 : -1;
      this.tears.push({ x: x + side * this.rng() * 3 * s, y, vx: side * (10 + this.rng() * 25) * s, vy: (20 + this.rng() * 30) * s, s: (5.8 + this.rng() * 2.2) * s, life: 0.75, max: 0.7 });
    }
  }
  _squirtTear(m, x, y) {
    const s = m.r / 50, side = x < m.x ? -1 : 1;
    this.tears.push({ x, y: y - 6 * s, vx: side * (90 + this.rng() * 90) * s, vy: -(80 + this.rng() * 90) * s, s: (6.4 + this.rng() * 2.4) * s, life: 0.8, max: 0.75 });
  }
  _updateTears(dt) {
    const g = 900 * this.u / 900;
    for (const p of this.tears) { p.life -= dt; p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    if (this.tears.length) this.tears = this.tears.filter(p => p.life > 0);
  }
  _renderTears(ctx) {
    if (!this.tears.length) return;
    ctx.fillStyle = '#7cc8ff';
    for (const p of this.tears) { ctx.globalAlpha = Math.min(1, p.life / 0.25); drawTear(ctx, p.x, p.y, p.s); }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const p of this.tears) { ctx.globalAlpha = Math.min(1, p.life / 0.25); ctx.fillRect(p.x - p.s * 0.45, p.y - p.s * 0.5, p.s * 0.35, p.s * 0.35); }
    ctx.globalAlpha = 1;
  }

  // ---------- 水花粒子 ----------
  _splash(x, y, rainbow, surface, r = this.u * 0.06, onMonster = false) {
    const s = this.u / 900;
    if (onMonster) {
      // 打在怪兽身上：水花从身体边缘往外炸开、很快散掉，脸一直露在外面（哭脸马上看得见）
      const n = rainbow ? 26 : 20;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI * (0.02 + 0.96 * (i + this.rng()) / n), v = (260 + this.rng() * 300) * s, c = Math.cos(a), sn = Math.sin(a);
        this.parts.push({ x: x + c * r * 0.95, y: y + sn * r * 0.85, vx: c * v * 1.2, vy: sn * v * 0.9, r: (3.5 + this.rng() * 4.5) * s,
          color: rainbow ? RAINBOW[i % RAINBOW.length] : ['#8fd8ff', '#c9efff', '#4cc9f0', '#ffffff'][i % 4], life: 0.32 + this.rng() * 0.25 });
      }
      return;
    }
    const n = rainbow ? 46 : 28;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI * (0.05 + 0.9 * this.rng()), v = (180 + this.rng() * 380) * s;
      this.parts.push({ x, y, vx: Math.cos(a) * v * (surface ? 0.8 : 1.1), vy: Math.sin(a) * v, r: (4 + this.rng() * 7) * s * (rainbow ? 1.2 : 1),
        color: rainbow ? RAINBOW[i % RAINBOW.length] : ['#8fd8ff', '#c9efff', '#4cc9f0', '#ffffff'][i % 4], life: 0.6 + this.rng() * 0.5 });
    }
    // 留下一块湿印子（篱笆 / 草地），慢慢变淡
    this.decals.push({ x, y, r: r * (surface ? 0.9 : 1.2), life: surface ? 2.5 : 1.2, max: surface ? 2.5 : 1.2, rainbow, surface });
    if (this.decals.length > 14) this.decals.shift();
  }

  _updateParts(dt) {
    const g = 1100 * this.u / 900;
    for (const p of this.parts) { p.life -= dt; p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const d of this.decals) d.life -= dt;
    this.decals = this.decals.filter(d => d.life > 0);
    const c = this._counterPos();
    for (const s of this.flyStars) s.u += dt / 0.7;
    this.flyStars = this.flyStars.filter(s => s.u < 1);
    this.starPulse = Math.max(0, this.starPulse - dt * 2);
    this._cp = c;
  }

  update(dt, { hands, now }) {
    this.t += dt;
    this._update_hands(dt, hands, now ?? performance.now());
    this._updateMonsters(dt);
    this._updateBalloons(dt);
    this._updatePrompt();
    this._updateParts(dt);
    this._updateTears(dt);
    this.effects.update(dt);
    this.hoverBasket = hands.some(h => !this.held.has(h.id) && (h.source === 'hand' || !h.consumed) && this._inBasket(h.palm[0], h.palm[1]));
    const rep = this.ui.get('repeat'); if (rep) rep.visible = this.phase === 'target' && !!this.target;
  }

  handDecor(hand) {
    const h = this.held.get(hand.id);
    return h ? { balloon: { color: h.color, t: this.t + h.t } } : {};
  }

  // ---------- 渲染 ----------
  _counterPos() { const I = this.L.inset; return [I.x1 - this.W * 0.075, I.y0 + this.H * 0.0375]; }

  render(ctx) {
    const L = this.L;
    if (!this.layers) this.layers = { sky: drawSky(L), mid: drawMid(L), bush: drawBushes(L) };
    ctx.drawImage(this.layers.sky, 0, 0);
    for (const m of this.monsters) if (m.state !== 'hidden' && m.row.id === 'far') drawMonster(ctx, m);
    ctx.drawImage(this.layers.mid, 0, 0);
    this._renderDecals(ctx);
    for (const m of this.monsters) if (m.state !== 'hidden' && m.row.id === 'near') drawMonster(ctx, m);
    ctx.drawImage(this.layers.bush, 0, 0);
    this._renderTears(ctx);
    drawBasket(ctx, this.basket, this.t, this.hoverBasket);
    if (!this.throws && !this.held.size) this._basketHint(ctx);
    for (const b of this.balloons) drawBalloon(ctx, b.x, b.y, b.r, b.color, b.u * 3);
    for (const p of this.parts) { ctx.globalAlpha = Math.min(1, p.life / 0.3); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    this._renderStars(ctx);
    this._renderBanner(ctx);
    this.ui.render(ctx);
    this.effects.render(ctx);
  }

  _renderDecals(ctx) {
    for (const d of this.decals) {
      const a = Math.min(1, d.life / d.max * 1.5);
      ctx.save(); ctx.globalAlpha = a * 0.55; ctx.translate(d.x, d.y);
      ctx.fillStyle = d.rainbow ? 'rgba(255,255,255,0.6)' : d.surface === 'fence' ? 'rgba(120,80,40,0.45)' : 'rgba(40,110,170,0.45)';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const ang = k / 10 * Math.PI * 2, rr = d.r * (0.75 + 0.35 * Math.sin(k * 2.7 + d.x)); ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr * (d.surface === 'grass' ? 0.45 : 0.8)); }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  _basketHint(ctx) {
    const b = this.basket, bob = Math.sin(this.t * 4) * this.u * 0.01, x = b.x + b.w / 2, y = b.y - this.u * 0.085 + bob, r = this.u * 0.05;
    ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `${r * 1.1}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText('✊', x, y + r * 0.05);
    ctx.restore();
  }

  _renderStars(ctx) {
    const [cx, cy] = this._counterPos(), h = this.H * 0.075, w = this.W * 0.13;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = h * 0.2;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2); ctx.fill(); ctx.shadowColor = 'transparent';
    const sr = h * 0.36 * (1 + this.starPulse * 0.35);
    ctx.fillStyle = '#ffc300'; ctx.strokeStyle = '#e08e00'; ctx.lineWidth = 2; star(ctx, cx - w * 0.22, cy, sr); ctx.stroke();
    ctx.fillStyle = '#2b2d42'; ctx.font = `900 ${h * 0.55}px ${LABEL_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(this.hits), cx + w * 0.16, cy + h * 0.03);
    for (const s of this.flyStars) {
      const e = ease(s.u), x = s.x + (cx - w * 0.22 - s.x) * e, y = s.y + (cy - s.y) * e - Math.sin(e * Math.PI) * this.u * 0.15;
      ctx.fillStyle = '#ffd60a'; star(ctx, x, y, this.u * 0.03 * (1 - e * 0.4), s.u * 6);
    }
    ctx.restore();
  }

  _renderBanner(ctx) {
    const I = this.L.inset, cx = this.W / 2, h = this.H * 0.1, y = I.y0;
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (this.phase === 'target' && this.target?.label) {
      // 题目牌：🎯 + 大号标签（不识字也能对照着找）
      const w = h * 2.6, pulse = 1 + Math.max(0, 1 - (this.t - this.promptAt) * 2) * 0.08;
      ctx.translate(cx, y + h / 2); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = h * 0.06; ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = h * 0.2;
      roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.3); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
      ctx.font = `${h * 0.55}px ${EMOJI_FONT}`; ctx.fillText('🎯', -w * 0.25, h * 0.03);
      ctx.fillStyle = '#e63946'; ctx.font = `900 ${h * 0.72}px ${LABEL_FONT}`; ctx.fillText(this.target.label.text, w * 0.15, h * 0.04);
    } else if (this.phase === 'free' && this.hits === 0) {
      ctx.font = `700 ${h * 0.36}px ${LABEL_FONT}`;
      const txt = '拿个水球，扔小怪兽！', w = ctx.measureText(txt).width + h * 0.8;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; roundRect(ctx, cx - w / 2, y + h * 0.1, w, h * 0.8, h * 0.4); ctx.fill();
      ctx.fillStyle = '#2b2d42'; ctx.fillText(txt, cx, y + h / 2 + h * 0.02);
    }
    ctx.restore();
  }

  // ---------- 测试 / 调试 ----------
  /** 所有可见元素的包围盒（用于检查都在安全范围内） */
  debugBounds() {
    const out = [];
    for (const m of this.monsters) if (m.state !== 'hidden') out.push({ id: 'm' + m.id, ...monsterBox(m) });
    out.push({ id: 'basket', ...this.basket });
    for (const b of this.ui.buttons) if (b.visible !== false) out.push({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h });
    const [cx, cy] = this._counterPos(); out.push({ id: 'stars', x: cx - this.W * 0.065, y: cy - this.H * 0.0375, w: this.W * 0.13, h: this.H * 0.075 });
    return out;
  }
}

function ease(k) { return k < 0 ? 0 : k > 1 ? 1 : 1 - Math.pow(1 - k, 3); }
