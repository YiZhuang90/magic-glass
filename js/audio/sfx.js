// 音频层 · 全部用 Web Audio 实时合成，无需音频素材。
// 轻轻的哭声：每个音 [开始秒, 时长, 起始音高, 结束音高, 音量]
const CRY_VARIANTS = [
  // “呜~ 呜~” + 抽鼻子
  [[0, 0.28, 640, 540, 0.12], [0.34, 0.4, 610, 455, 0.112], [0.82, 0.07, 780, 680, 0.048]],
  // 三声小抽泣，最后一声拖长
  [[0, 0.15, 680, 600, 0.095], [0.19, 0.15, 660, 580, 0.095], [0.41, 0.42, 630, 450, 0.112], [0.88, 0.06, 760, 660, 0.042]],
  // “呜——呜~”：第一声长一点，第二声更低
  [[0, 0.36, 600, 520, 0.115], [0.43, 0.38, 560, 420, 0.106], [0.86, 0.06, 720, 640, 0.042]],
];

export class Sfx {
  constructor() { this.ctx = null; this.volume = 0.8; this.wipeLevel = 0; }

  /** 必须在用户点击后调用（浏览器自动播放限制）。 */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this._buildWipe();
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') this.ctx.resume?.().catch?.(() => {});
    // iOS Safari：必须在用户点击里真正播放一次声音，音频才会解锁
    if (!this._primed) {
      try { const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource(); s.buffer = b; s.connect(this.ctx.destination); s.start(0); this._primed = true; } catch {}
    }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  _noiseBuffer(sec = 2) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.5 + last * 3; }
    return b;
  }

  _buildWipe() {
    const c = this.ctx;
    // 摩擦声：粉红噪声 → 带通
    const src = c.createBufferSource(); src.buffer = this._noiseBuffer(); src.loop = true;
    this.wipeFilter = c.createBiquadFilter(); this.wipeFilter.type = 'bandpass'; this.wipeFilter.frequency.value = 1800; this.wipeFilter.Q.value = 0.9;
    this.wipeGain = c.createGain(); this.wipeGain.gain.value = 0;
    src.connect(this.wipeFilter).connect(this.wipeGain).connect(this.master); src.start();
    // 轻柔“吱吱”声：正弦 + 颤音
    this.squeak = c.createOscillator(); this.squeak.type = 'sine'; this.squeak.frequency.value = 1100;
    const lfo = c.createOscillator(); lfo.frequency.value = 23; const lfoG = c.createGain(); lfoG.gain.value = 60;
    lfo.connect(lfoG).connect(this.squeak.frequency); lfo.start();
    this.squeakGain = c.createGain(); this.squeakGain.gain.value = 0;
    this.squeak.connect(this.squeakGain).connect(this.master); this.squeak.start();
  }

  /** 每帧调用：speed 为 0–1 的擦拭强度。 */
  setWipe(speed, type = 'fog') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = Math.max(0, Math.min(1, speed));
    this.wipeLevel += (s - this.wipeLevel) * 0.3;
    const L = this.wipeLevel;
    if (type === 'mud') {
      this.wipeFilter.type = 'lowpass'; this.wipeFilter.frequency.setTargetAtTime(500 + L * 700, t, 0.05);
      this.wipeGain.gain.setTargetAtTime(L * 0.55, t, 0.05);
      this.squeakGain.gain.setTargetAtTime(0, t, 0.05);
      if (L > 0.3 && Math.random() < 0.03) this.squelch();
    } else {
      this.wipeFilter.type = 'bandpass'; this.wipeFilter.frequency.setTargetAtTime(1400 + L * 1800, t, 0.05);
      this.wipeGain.gain.setTargetAtTime(L * 0.22, t, 0.05);
      this.squeak.frequency.setTargetAtTime(900 + L * 700, t, 0.08);
      this.squeakGain.gain.setTargetAtTime(L > 0.45 ? (L - 0.45) * 0.05 : 0, t, 0.06);
    }
  }

  _tone(freq, start, dur, { type = 'sine', gain = 0.2, attack = 0.01 } = {}) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master); o.start(start); o.stop(start + dur + 0.05);
  }

  /** 小提示音（进度 30%/50%） */
  ding(step = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const f = [784, 988, 1175][step % 3];
    this._tone(f, t, 0.5, { type: 'sine', gain: 0.18 }); this._tone(f * 2, t, 0.3, { type: 'sine', gain: 0.05 });
  }

  /** 雾气散开“呼——” */
  whoosh() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this._noiseBuffer(1.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.9);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 1.3);
  }

  /** 庆祝：上行琶音 + 铃声 */
  fanfare(big = false) {
    if (!this.ctx) return; const t = this.ctx.currentTime + 0.05;
    const notes = big ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      this._tone(f, t + i * 0.11, 0.6, { type: 'triangle', gain: 0.16 });
      this._tone(f * 2.01, t + i * 0.11, 0.4, { type: 'sine', gain: 0.05 });
    });
    const end = t + notes.length * 0.11;
    [1568, 2093, 2637].forEach((f, i) => this._tone(f, end + i * 0.07, 0.9, { type: 'sine', gain: 0.07 }));
  }

  /** 泥巴“噗叽” */
  squelch() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(180 + Math.random() * 80, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  // ---------- 投水球 ----------
  /** 扔出去“嗖” */
  swoosh() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this._noiseBuf || (this._noiseBuf = this._noiseBuffer(1));
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.4);
  }
  /** 水花“啪嚓”：噪声爆破 + 一串小水滴音 */
  /** level：整体音量倍数；打中怪兽时用小一点、尾巴短一点，让后面的哭声听得清 */
  splash(big = false, level = 1) {
    const c = this.ctx; if (!c) return; const t = c.currentTime, tail = level < 1 ? 0.3 : 0.45;
    const src = c.createBufferSource(); src.buffer = this._noiseBuf || (this._noiseBuf = this._noiseBuffer(1));
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.4);
    const g = c.createGain(); g.gain.setValueAtTime((big ? 0.5 : 0.38) * level, t); g.gain.exponentialRampToValueAtTime(0.001, t + tail);
    src.connect(f).connect(g).connect(this.master); src.start(t); src.stop(t + 0.5);
    for (let i = 0; i < (big ? 6 : 4); i++) {
      const o = c.createOscillator(), og = c.createGain(), st = t + 0.04 + i * 0.05 + Math.random() * 0.03, f0 = 900 + Math.random() * 900;
      o.type = 'sine'; o.frequency.setValueAtTime(f0, st); o.frequency.exponentialRampToValueAtTime(f0 * 1.8, st + 0.06);
      og.gain.setValueAtTime(0.06 * level, st); og.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(og).connect(this.master); o.start(st); o.stop(st + 0.1);
    }
  }
  /** 小怪兽咯咯笑：几声快速上下滑的高音 */
  giggle() {
    const c = this.ctx; if (!c) return; const t = c.currentTime + 0.05, base = 620 + Math.random() * 160;
    for (let i = 0; i < 5; i++) {
      const o = c.createOscillator(), g = c.createGain(), st = t + i * 0.09;
      o.type = 'triangle'; o.frequency.setValueAtTime(base * (1 + i * 0.06), st); o.frequency.exponentialRampToValueAtTime(base * 1.45 * (1 + i * 0.06), st + 0.035); o.frequency.exponentialRampToValueAtTime(base * 0.9, st + 0.075);
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.13, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(g).connect(this.master); o.start(st); o.stop(st + 0.1);
    }
  }
  /** 被打湿“吱！” */
  eek() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1900, t + 0.12); o.frequency.exponentialRampToValueAtTime(1300, t + 0.28);
    l.frequency.value = 28; lg.gain.value = 70; l.connect(lg).connect(o.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.master); o.start(t); l.start(t); o.stop(t + 0.35); l.stop(t + 0.35);
  }
  /**
   * 被打中哭（v10：轻轻的）：像小猫一样“呜~ 呜~”两三声，正弦 + 一点点三角波、低通滤掉刺耳的高频，
   * 慢慢起音、轻微颤音、音高往下滑，最后一声小抽鼻子。约 0.8–0.95 秒，v11：音色不变，音量调回 v10 的约 2.8 倍（峰值约 0.12、平均约 −29 dBFS，和 v9 差不多响，但没有刺耳的高频）。
   * 3 种变体随机挑（连着两次不会一样），听多了也不腻。cry(v) 可指定变体（离线渲染试听用）。
   */
  get cryVariants() { return CRY_VARIANTS.length; }
  cry(variant) {
    const c = this.ctx; if (!c) return;
    let v = variant;
    if (v == null) { v = Math.floor(Math.random() * CRY_VARIANTS.length); if (v === this._lastCry) v = (v + 1) % CRY_VARIANTS.length; }
    this._lastCry = v;
    const t0 = c.currentTime + 0.02, k = 0.97 + Math.random() * 0.06;   // 每次音高略有不同
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.4;
    const out = c.createGain(); out.gain.value = 1; out.connect(lp).connect(this.master);
    for (const [st, dur, f0, f1, peak] of CRY_VARIANTS[v]) {
      const t = t0 + st, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), g2 = c.createGain();
      const vib = c.createOscillator(), vg = c.createGain();
      o.type = 'sine'; o2.type = 'triangle';
      o.frequency.setValueAtTime(f0 * k, t); o.frequency.exponentialRampToValueAtTime(f1 * k, t + dur);
      o2.frequency.setValueAtTime(f0 * k, t); o2.frequency.exponentialRampToValueAtTime(f1 * k, t + dur);
      // 颤音：一开始没有，慢慢出来（像小声呜咽）
      vib.frequency.value = 6.5; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f0 * k * 0.022, t + dur * 0.6);
      vib.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
      g2.gain.value = 0.18;
      // 软起音（不是“啪”一下）、平平地持续一会儿、再轻轻收掉
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + Math.min(0.07, dur * 0.35));
      g.gain.setValueAtTime(peak, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); o2.connect(g2).connect(g); g.connect(out);
      const end = t + dur + 0.02;
      o.start(t); o2.start(t); vib.start(t); o.stop(end); o2.stop(end); vib.stop(end);
    }
  }
  /** 冒出来“啵嘤” */
  boing() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.12); o.frequency.exponentialRampToValueAtTime(380, t + 0.22);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
  }

  pop() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(660, t, 0.15, { type: 'square', gain: 0.05 }); this._tone(990, t + 0.05, 0.2, { type: 'sine', gain: 0.1 }); }
}
