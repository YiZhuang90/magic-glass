// 标定界面：① 手指指点四个角（停留即可）；② 家长在摄像头预览上用鼠标拖动四角。
const TARGETS = [[0.1, 0.12], [0.9, 0.12], [0.9, 0.88], [0.1, 0.88]];
const DWELL_MS = 1300, STILL = 0.025;

export class CalibrationUI {
  constructor({ store, input, tracker, sfx, root, video, onDone, toast }) {
    Object.assign(this, { store, input, tracker, sfx, root, video, onDone, toast });
    this.active = null; // 'point' | 'drag' | null
    this.text = root.querySelector('#calibText');
    this.dragBox = root.querySelector('#calibDrag');
    this.dragCanvas = root.querySelector('#calibDragCanvas');
    this.videoSlot = root.querySelector('#calibVideoSlot');
    root.querySelector('#calibCancel').addEventListener('click', () => this.stop(false));
    root.querySelector('#calibSave').addEventListener('click', () => this._saveDrag());
    root.querySelector('#calibResetQuad').addEventListener('click', () => { this.quad = [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]]; this._drawQuad(); });
    this._bindDrag();
  }

  startPoint() {
    if (!this.tracker.landmarker || !this.tracker.stream) { this.toast('需要先打开摄像头并加载手部识别，才能用手指标定'); return false; }
    this.active = 'point'; this.idx = 0; this.captured = []; this.anchor = null; this.anchorT = 0;
    this.root.classList.remove('hidden'); this.root.classList.add('point'); this.root.classList.remove('drag');
    this._setText();
    this.input.enabled = false;
    return true;
  }

  startDrag() {
    this.active = 'drag';
    this.root.classList.remove('hidden', 'point'); this.root.classList.add('drag');
    this.text.textContent = '拖动四个圆点，框出孩子挥手能到达的区域（画面已镜像，像照镜子）。框内就对应整面投影。';
    this.quad = this.store.cameraQuad();
    this._prevParent = this.video.parentElement;
    this.videoSlot.appendChild(this.video);
    this.video.classList.add('calib-video');
    this.input.enabled = false;
    requestAnimationFrame(() => this._drawQuad());
    return true;
  }

  stop(saved) {
    if (this.active === 'drag' && this._prevParent) { this._prevParent.appendChild(this.video); this.video.classList.remove('calib-video'); }
    this.active = null;
    this.root.classList.add('hidden');
    this.input.enabled = true;
    this.onDone?.(saved);
  }

  _setText() {
    const names = ['左上角', '右上角', '右下角', '左下角'];
    this.text.textContent = `请站在孩子玩的位置，伸出食指指向${names[this.idx]}的星星，保持不动一会儿（${this.idx + 1}/4）`;
  }

  /** 每帧调用（手指标定） */
  update(now) {
    if (this.active !== 'point') return;
    this.tracker.update();
    const raw = this.input.rawIndexTip();
    this.raw = raw;
    if (!raw) { this.anchor = null; this.progress = 0; return; }
    if (!this.anchor || Math.hypot(raw[0] - this.anchor[0], raw[1] - this.anchor[1]) > STILL) {
      this.anchor = raw; this.anchorT = now; this.samples = [];
    }
    this.samples.push(raw);
    this.progress = Math.min(1, (now - this.anchorT) / DWELL_MS);
    if (this.progress >= 1) {
      const n = this.samples.length;
      const p = [this.samples.reduce((a, s) => a + s[0], 0) / n, this.samples.reduce((a, s) => a + s[1], 0) / n];
      this.captured.push(p); this.sfx.ding(this.idx); this.idx++; this.anchor = null; this.progress = 0;
      if (this.idx >= 4) {
        const ok = this.store.set(this.captured, TARGETS);
        this.toast(ok ? '标定完成！' : '标定失败，请重试（四个点不要太靠近）');
        this.stop(ok);
      } else this._setText();
    }
  }

  render(ctx, W, H) {
    if (this.active !== 'point') return;
    const t = TARGETS[this.idx]; if (!t) return;
    const x = t[0] * W, y = t[1] * H, r = Math.min(W, H) * 0.05;
    const pulse = 1 + 0.12 * Math.sin(performance.now() / 180);
    ctx.save();
    ctx.fillStyle = 'rgba(20,30,60,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd60a'; ctx.shadowColor = '#fff3a0'; ctx.shadowBlur = r;
    ctx.beginPath(); ctx.arc(x, y, r * 0.55 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (this.progress || 0)); ctx.stroke();
    if (this.raw) { // 未标定映射下的手指位置，帮助对准
      const [u, v] = this.store.map(this.raw[0], this.raw[1]);
      ctx.fillStyle = '#66d9ff'; ctx.beginPath(); ctx.arc(u * W, v * H, r * 0.25, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- 拖动标定 ----------
  _bindDrag() {
    const c = this.dragCanvas;
    const norm = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    c.addEventListener('pointerdown', (e) => {
      const p = norm(e); let best = -1, bd = 0.08;
      this.quad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
      this.dragIdx = best; if (best >= 0) c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragIdx == null || this.dragIdx < 0) return;
      const p = norm(e); this.quad[this.dragIdx] = [Math.min(1, Math.max(0, p[0])), Math.min(1, Math.max(0, p[1]))]; this._drawQuad();
    });
    c.addEventListener('pointerup', () => { this.dragIdx = -1; });
  }

  _drawQuad() {
    const c = this.dragCanvas, r = c.getBoundingClientRect();
    c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); this.quad.forEach(([x, y], i) => i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ffd60a'; ctx.lineWidth = 4 * devicePixelRatio; ctx.stroke();
    const labels = ['左上', '右上', '右下', '左下'];
    this.quad.forEach(([x, y], i) => {
      ctx.fillStyle = '#ffd60a'; ctx.beginPath(); ctx.arc(x * W, y * H, 14 * devicePixelRatio, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#333'; ctx.font = `${12 * devicePixelRatio}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], x * W, y * H);
    });
  }

  _saveDrag() {
    const ok = this.store.set(this.quad.map(p => [...p]), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.toast(ok ? '可玩区域已保存' : '区域无效，请把四个点拉开一些');
    if (ok) this.stop(true);
  }
}
