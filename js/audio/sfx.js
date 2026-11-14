// 音频层 · 全部用 Web Audio 实时合成，无需音频素材。
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

  pop() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(660, t, 0.15, { type: 'square', gain: 0.05 }); this._tone(990, t + 0.05, 0.2, { type: 'sine', gain: 0.1 }); }
}
