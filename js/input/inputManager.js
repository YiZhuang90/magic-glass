// 输入层：把摄像头里的手（MediaPipe 21 点）或鼠标/触屏统一成“虚拟手”。
// 每只手输出：pts（21 个点，渲染像素，已镜像、已映射、已平滑）、prevPts（上一帧，用于擦拭/涂抹连线）、
// palm（掌心）、size（手长）、gesture（'open' | 'fist' | 'point'（只伸食指）| 'other'）、source（'hand' | 'mouse' | 'touch'）。
import { OneEuro2D } from './oneEuro.js';
import { PoseFilter, templateHand, PALM_IDS } from './gestures.js';
import { safeRect, camToScreen, screenToCam } from './safeZone.js';
import { PersonTracker, assignHands, trueHandedness, PLAYER_COLORS } from './persons.js';

// 区分玩家时，手的颜色跟着玩家走（1 号黄、2 号蓝、3 号粉、4 号绿）
const PLAYER_STYLES = PLAYER_COLORS.map((stroke, i) => ({ stroke, fill: ['#fff3c4', '#d4f1ff', '#ffe0ef', '#dcffd6'][i], name: `玩家${i + 1}` }));
const HAND_STYLES = [
  { fill: '#fff3c4', stroke: '#ff9f1c', name: '黄手' },
  { fill: '#d4f1ff', stroke: '#3a86ff', name: '蓝手' },
  { fill: '#ffe0ef', stroke: '#ff4d8d', name: '粉手' },
  { fill: '#dcffd6', stroke: '#2bb24c', name: '绿手' },
];
const LOST_MS = 300;
// 鼠标 / 触屏 / 触控笔同样处理。摄像头看到真手、且鼠标已静止这么久时，隐藏鼠标的虚拟手（停止鼠标涂抹 / 悬停），直到鼠标真的再次移动
const MOUSE_IDLE_HIDE_MS = 800;
const MOUSE_JITTER_PX = 2; // CSS 像素；不超过这个距离的移动当作抖动，不会唤回鼠标手

export class InputManager {
  constructor({ tracker, calibration, element, getSettings }) {
    Object.assign(this, { tracker, calibration, el: element, getSettings });
    this.W = 1; this.H = 1; this.Q = 1;
    this.tracks = []; this.nextId = 1;
    this.pointers = new Map();
    this.clicks = [];
    this.hands = [];
    this.persons = new PersonTracker();
    this._faceSeq = -1;
    this._bindPointer();
  }

  /** cssW/cssH：画布 CSS 尺寸；Q：渲染像素 / CSS 像素 */
  resize(cssW, cssH, Q) { this.Q = Q; this.W = cssW * Q; this.H = cssH * Q; }
  get minD() { return Math.min(this.W, this.H); }

  _bindPointer() {
    const el = this.el;
    const pos = (e) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) * this.Q, (e.clientY - r.top) * this.Q]; };
    el.addEventListener('pointerdown', (e) => {
      const [x, y] = pos(e);
      const p0 = this.pointers.get(e.pointerId);
      // 被隐藏的鼠标：原地按下不算“移动”，忽略（避免隐藏状态下误点按钮或涂抹）
      if (p0 && p0.hidden && !this._wake(p0, e)) return;
      const p = p0 || this._newPointer(e, x, y);
      p.x = x; p.y = y; p.down = true; p.consumed = false;
      this.pointers.set(e.pointerId, p);
      try { el.setPointerCapture(e.pointerId); } catch {}
      this.clicks.push({ x, y, pointer: p });
    });
    el.addEventListener('pointermove', (e) => {
      if (!e.isTrusted) return; // 脚本合成的事件不算鼠标移动
      const [x, y] = pos(e);
      let p = this.pointers.get(e.pointerId);
      if (!p) { p = this._newPointer(e, x, y); this.pointers.set(e.pointerId, p); return; }
      if (p.hidden) { if (!this._wake(p, e)) return; }
      else if (Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > MOUSE_JITTER_PX) { p.lastMoveAt = performance.now(); p.cx = e.clientX; p.cy = e.clientY; }
      p.x = x; p.y = y;
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      if (e.pointerType === 'mouse') { p.down = false; p.consumed = false; } else this.pointers.delete(e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.pointers.delete(e.pointerId); });
  }

  _newPointer(e, x, y) {
    return { id: 'm' + e.pointerId, type: e.pointerType || 'mouse', x, y, cx: e.clientX, cy: e.clientY, lastMoveAt: performance.now(), hidden: false,
      down: false, consumed: false, f: 0, pts: null, prev: null, style: HAND_STYLES[0] };
  }

  /** 隐藏中的鼠标：只有真实事件、且离隐藏时的位置超过抖动阈值，才重新显示。返回是否已唤回。 */
  _wake(p, e) {
    if (!e.isTrusted || Math.hypot(e.clientX - p.cx, e.clientY - p.cy) <= MOUSE_JITTER_PX) return false;
    p.hidden = false; p.lastMoveAt = performance.now(); p.cx = e.clientX; p.cy = e.clientY;
    p.pts = null; p.prev = null; p.f = 0; // 从新位置重新开始，不和隐藏前的位置连线
    return true;
  }

  /** 鼠标的虚拟手当前是否显示（测试用） */
  get mouseHidden() { return [...this.pointers.values()].some(p => p.hidden); }

  /** 每帧调用。返回 { hands, clicks }。 */
  update(now, dt) {
    const fresh = this.tracker && this.tracker.update(now);
    this._updatePersons(now);
    if (fresh) this._ingest(now);
    const k = 1 - Math.exp(-dt * 30); // 渲染帧之间向最新识别结果插值，画面更顺
    const hands = [];
    this.tracks = this.tracks.filter(t => now - t.seen < LOST_MS);
    for (const t of this.tracks) {
      if (!t.disp) t.disp = t.target.map(p => [...p]);
      t.prev = t.disp.map(p => [...p]);
      for (let i = 0; i < 21; i++) { t.disp[i][0] += (t.target[i][0] - t.disp[i][0]) * k; t.disp[i][1] += (t.target[i][1] - t.disp[i][1]) * k; }
      hands.push(this._out(t, 'hand', now - t.seen < 150));
    }
    // 鼠标 / 触屏的虚拟手：按下时握拳
    const S = this.minD * 0.12;
    const realHand = hands.some(h => h.active);
    for (const p of this.pointers.values()) {
      // 看到真手、鼠标又静止了一会儿 → 隐藏鼠标手，停止鼠标的涂抹 / 悬停，直到鼠标真的再次移动
      if (realHand && !p.hidden && now - p.lastMoveAt > MOUSE_IDLE_HIDE_MS) { p.hidden = true; } // 按键状态保留：隐藏期间不出现在 hands 里，所以不会涂抹 / 悬停
      if (p.hidden) continue;
      p.f += ((p.down ? 1 : 0) - p.f) * Math.min(1, dt * 14);
      p.prev = p.pts ? p.pts.map(q => [...q]) : null;
      p.pts = templateHand(p.x, p.y - S * 0.1, S, p.f, p.pts);
      if (!p.prev) p.prev = p.pts.map(q => [...q]);
      hands.push({
        id: p.id, source: p.type === 'touch' ? 'touch' : 'mouse', pts: p.pts, prevPts: p.prev, palm: [p.x, p.y], prevPalm: palmOf(p.prev),
        size: S, gesture: p.down ? 'fist' : 'open', down: p.down, consumed: p.consumed, pointer: p, style: p.style, active: true,
      });
    }
    this.hands = hands;
    const clicks = this.clicks; this.clicks = [];
    return { hands, clicks };
  }

  _out(t, source, active) {
    const person = t.personId != null ? this.persons.get(t.personId) : null;
    return { id: 'h' + t.id, source, pts: t.disp, prevPts: t.prev, palm: palmOf(t.disp), prevPalm: palmOf(t.prev), size: t.size, gesture: t.gesture, active,
      style: person ? PLAYER_STYLES[(person.slot - 1) % 4] : t.style, down: false,
      handed: t.handed || null, person: person ? { id: person.id, slot: person.slot } : null, slotName: t.style?.name };
  }

  get playersOn() { const s = this.getSettings(); return s.players !== false; }

  /** 人脸框 → 玩家跟踪（只用位置框，不保存图像）。关闭“区分玩家”或没有人脸时清空。 */
  _updatePersons(now) {
    const tr = this.tracker; if (!tr) return;
    if (!this.playersOn) { if (this.persons.persons.length) this.persons.clear(); return; }
    if (tr.faceSeq === this._faceSeq) { this.persons.expire(now); return; } // 没有新的人脸结果：只处理宽限期
    this._faceSeq = tr.faceSeq;
    this.persons.update(tr.faces || [], now, this._aspect());
  }
  _aspect() { return (this.tracker?.videoW || 640) / (this.tracker?.videoH || 480); }

  /** 当前玩家（屏幕坐标里的脸中心、编号），供画玩家标记 */
  playerMarks() {
    if (!this.playersOn) return [];
    const r = safeRect(this.getSettings());
    return this.persons.persons.map(p => {
      const [u, v] = camToScreen(p.box.x + p.box.w / 2, p.box.y + p.box.h / 2, r);
      return { id: p.id, slot: p.slot, x: u * this.W, y: v * this.H, color: PLAYER_COLORS[(p.slot - 1) % 4], fresh: performance.now() - p.lastSeen < 300 };
    });
  }

  /** 安全区：屏幕归一化坐标 → 摄像头坐标（测试用） */
  screenToCam(u, v) { return screenToCam(u, v, safeRect(this.getSettings())); }

  _ingest(now) {
    const vw = this.tracker.videoW || 640, vh = this.tracker.videoH || 480;
    const used = new Set();
    for (const hand of this.tracker.hands) {
      const lm = hand.landmarks; // 已镜像，0–1
      const px = lm.map(p => [p.x * vw, p.y * vh, (p.z || 0) * vw]); // 像素空间，比例不失真（z 与 x 同尺度）
      const pc = avgPts(PALM_IDS.map(i => px[i]));
      const [sx, sy] = this._mapPoint(pc[0] / vw, pc[1] / vh);
      // 手长：手腕到中指根
      const camSize = Math.hypot(px[9][0] - px[0][0], px[9][1] - px[0][1]);
      const s = this.getSettings();
      const region = s.displayMode === 'screen' ? safeRect(s).w : 0.9;
      const mapScale = this.W / (vw * region);
      const size = clamp(camSize * mapScale, this.minD * 0.09, this.minD * 0.17) * (s.handScale || 1);
      const sc = size / Math.max(1, camSize);
      // 匹配已有轨迹
      let best = null, bd = this.minD * 0.35;
      for (const t of this.tracks) { if (used.has(t)) continue; const d = Math.hypot(t.cx - sx, t.cy - sy); if (d < bd) { bd = d; best = t; } }
      if (!best) {
        best = { id: this.nextId++, cx: sx, cy: sy, filt: new OneEuro2D({ minCutoff: 1.0, beta: 0.015 }), off: null, gesture: 'open', pose: new PoseFilter('open'), seen: now, hEma: 0, handed: null, personId: null };
        // 颜色按“空位”分配：第一只手总是黄色、第二只总是蓝色，不会因为重新识别而变色
        const usedStyles = new Set(this.tracks.map(t => t.style));
        best.style = HAND_STYLES.find(st => !usedStyles.has(st)) || HAND_STYLES[0];
        this.tracks.push(best);
      }
      used.add(best);
      const [fx, fy] = best.filt.filter(sx, sy, now);
      best.cx = fx; best.cy = fy; best.size = size; best.seen = now;
      // 手形：相对掌心的偏移，统一缩放（不随映射区域变形），再做轻微平滑
      const off = px.map(p => [(p[0] - pc[0]) * sc, (p[1] - pc[1]) * sc]);
      if (!best.off) best.off = off;
      else for (let i = 0; i < 21; i++) { best.off[i][0] += (off[i][0] - best.off[i][0]) * 0.6; best.off[i][1] += (off[i][1] - best.off[i][1]) * 0.6; }
      best.target = best.off.map(o => [fx + o[0], fy + o[1]]);
      // 手势：相对距离 + 回差 + 多帧防抖（见 gestures.js）
      best.gesture = best.pose.update(px);
      // 左右手：模型标签（已按镜像纠正）按置信度做指数平均，避免偶尔跳变
      const hn = trueHandedness(hand.handedness);
      if (hn) { best.hEma += ((hn === 'right' ? 1 : -1) * (hand.score ?? 1) - best.hEma) * 0.35; best.handed = best.hEma > 0.15 ? 'right' : best.hEma < -0.15 ? 'left' : best.handed; }
      best.wristCam = [lm[0].x, lm[0].y];
    }
    // 把手分给玩家（人脸框）；没有人脸时 personId = null，退回按手区分
    const live = this.tracks.filter(t => used.has(t));
    if (this.playersOn && this.persons.persons.length) {
      const res = assignHands(live.map(t => ({ id: t.id, wrist: t.wristCam, handed: t.handed, prev: t.personId })), this.persons.persons, vw / vh);
      for (const t of live) { const a = res.get(t.id); t.personId = a.personId; if (a.personId != null) t.handed = a.handed; }
    } else for (const t of live) t.personId = null;
  }

  /** 镜像后的摄像头归一化坐标 → 渲染像素 */
  _mapPoint(nx, ny) {
    const s = this.getSettings();
    let u, v;
    if (s.displayMode === 'screen') [u, v] = camToScreen(nx, ny, safeRect(s)); // 安全区（已夹紧到 0–1）
    else [u, v] = this.calibration.map(nx, ny);
    return [clamp(u, 0, 1) * this.W, clamp(v, 0, 1) * this.H];
  }

  /** 原始（镜像后、未映射）食指指尖，供投影标定使用 */
  rawIndexTip() { const h = this.tracker?.hands?.[0]; if (!h) return null; const p = h.landmarks[8]; return [p.x, p.y]; }
}

export function palmOf(pts) { let x = 0, y = 0; for (const i of PALM_IDS) { x += pts[i][0]; y += pts[i][1]; } return [x / 5, y / 5]; }
const avgPts = (a) => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
