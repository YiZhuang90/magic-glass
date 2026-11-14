// One Euro 滤波器：慢速时平滑去抖，快速时低延迟跟手。
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
}
const alpha = (cutoff, dt) => { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); };

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 0.02, dCutoff = 1.0 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.x = new LowPass(); this.dx = new LowPass(); this.last = null; this.prev = null;
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.last = null; this.prev = null; }
  filter(value, tMs) {
    if (this.last === null) { this.last = tMs; this.prev = value; return this.x.filter(value, 1); }
    const dt = Math.max(1e-3, (tMs - this.last) / 1000); this.last = tMs;
    const d = (value - this.prev) / dt; this.prev = value;
    const ed = this.dx.filter(d, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(value, alpha(cutoff, dt));
  }
}

export class OneEuro2D {
  constructor(opts) { this.fx = new OneEuro(opts); this.fy = new OneEuro(opts); }
  reset() { this.fx.reset(); this.fy.reset(); }
  filter(x, y, t) { return [this.fx.filter(x, t), this.fy.filter(y, t)]; }
}
