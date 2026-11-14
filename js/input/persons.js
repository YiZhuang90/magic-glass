// 区分玩家：用人脸“位置框”跟踪每个人（不做人脸识别、不提取特征、不保存任何图像），
// 再把每只手分给离它最近、位置合理的那个人，并标出左右手。
// 坐标都是镜像后的摄像头归一化坐标；aspect = 画面宽 / 高（把 x 换算成和 y 一样的长度单位）。

export const PLAYER_COLORS = ['#ff9f1c', '#3a86ff', '#ff4d8d', '#2bb24c'];

/**
 * MediaPipe 的 handedness 假定输入画面是镜像过的（自拍）。我们送进模型的是没镜像的摄像头画面，
 * 所以标签要反过来：模型说 'Left' 实际是孩子的右手。
 */
export function trueHandedness(label, inputMirrored = false) {
  if (label !== 'Left' && label !== 'Right') return null;
  const l = label === 'Left' ? 'left' : 'right';
  return inputMirrored ? l : (l === 'left' ? 'right' : 'left');
}

export function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / Math.max(1e-9, a.w * a.h + b.w * b.h - i);
}

/** 人脸框跟踪：IoU / 中心距离匹配，人脸短暂丢失有宽限期，编号稳定 */
export class PersonTracker {
  constructor({ graceMs = 2000, maxPersons = 4 } = {}) {
    this.graceMs = graceMs; this.maxPersons = maxPersons;
    this.persons = []; this.nextId = 1;
  }
  /** faces: [{ x, y, w, h, score }]（左上角 + 宽高，归一化）。返回当前（含宽限期内）的人。 */
  update(faces, now, aspect = 4 / 3) {
    const pairs = [];
    this.persons.forEach((p, pi) => faces.forEach((f, fi) => {
      const o = iou(p.box, f), s = Math.max(p.box.h, f.h, 1e-6);
      const d = Math.hypot((cx(p.box) - cx(f)) * aspect, cy(p.box) - cy(f)) / s; // 以脸高为单位
      if (o > 0.05 || d < 1.5) pairs.push({ pi, fi, cost: (1 - o) + 0.4 * d });
    }));
    pairs.sort((a, b) => a.cost - b.cost);
    const usedP = new Set(), usedF = new Set();
    for (const { pi, fi } of pairs) {
      if (usedP.has(pi) || usedF.has(fi)) continue;
      usedP.add(pi); usedF.add(fi);
      const p = this.persons[pi], f = faces[fi], k = 0.6; // 轻微平滑
      p.box = { x: p.box.x + (f.x - p.box.x) * k, y: p.box.y + (f.y - p.box.y) * k, w: p.box.w + (f.w - p.box.w) * k, h: p.box.h + (f.h - p.box.h) * k };
      p.lastSeen = now; p.seen++;
    }
    faces.forEach((f, fi) => {
      if (usedF.has(fi)) return;
      const taken = new Set(this.persons.map(p => p.slot));
      let slot = 1; while (taken.has(slot)) slot++;
      if (slot > this.maxPersons) return;
      this.persons.push({ id: this.nextId++, slot, box: { ...f }, lastSeen: now, seen: 1 });
    });
    this.persons = this.persons.filter(p => now - p.lastSeen <= this.graceMs);
    this.persons.sort((a, b) => a.slot - b.slot);
    return this.persons;
  }
  expire(now) { this.persons = this.persons.filter(p => now - p.lastSeen <= this.graceMs); }
  get(id) { return this.persons.find(p => p.id === id) || null; }
  clear() { this.persons = []; }
}

export const ASSIGN_T = {
  above: 2.3,   // 手腕最多比脸中心高出 2.3 个脸高（举手够屏幕上沿）
  reach: 5.0,   // 手腕离脸中心最多 5 个脸高（孩子手臂 + 肩宽）
  side: 0.8,    // 右手跑到脸左边超过 0.8 个脸高（或反过来）时加罚分（可能是别人的手）
  sticky: 0.8,  // 上一帧就属于这个人的手，优先继续归他
};

/**
 * 把手分给人。hands: [{ id, wrist: [x, y], handed: 'left'|'right'|null, prev: personId|null }]
 * 返回 Map(handId → { personId, handed })；没有合理的人时 personId 为 null。
 * 每人最多两只手；同一个人两只手被识别成同一侧时，按左右位置纠正（镜像画面里左手在左边）。
 */
export function assignHands(hands, persons, aspect = 4 / 3, T = ASSIGN_T) {
  const pairs = [];
  for (const h of hands) for (const p of persons) {
    const s = Math.max(p.box.h, p.box.w * aspect, 1e-6);
    const dx = (h.wrist[0] - cx(p.box)) * aspect / s, dy = (h.wrist[1] - cy(p.box)) / s;
    if (dy < -T.above) continue;
    const dist = Math.hypot(dx, dy > 0 ? dy * 0.85 : dy);
    if (dist > T.reach) continue;
    let cost = dist;
    if (h.handed === 'right' && dx < -T.side) cost += 1.5;
    if (h.handed === 'left' && dx > T.side) cost += 1.5;
    if (h.prev != null && h.prev === p.id) cost -= T.sticky;
    pairs.push({ h, p, cost, dx });
  }
  pairs.sort((a, b) => a.cost - b.cost);
  const out = new Map(), count = new Map();
  for (const { h, p } of pairs) {
    if (out.has(h.id) || (count.get(p.id) || 0) >= 2) continue;
    out.set(h.id, { personId: p.id, handed: h.handed });
    count.set(p.id, (count.get(p.id) || 0) + 1);
  }
  for (const h of hands) if (!out.has(h.id)) out.set(h.id, { personId: null, handed: h.handed });
  // 同一个人的两只手：标签相同或缺失时，按画面左右纠正
  for (const p of persons) {
    const mine = hands.filter(h => out.get(h.id).personId === p.id);
    if (mine.length !== 2) continue;
    const [a, b] = mine, la = out.get(a.id), lb = out.get(b.id);
    if (la.handed && lb.handed && la.handed !== lb.handed) continue;
    const aLeft = a.wrist[0] < b.wrist[0];
    la.handed = aLeft ? 'left' : 'right'; lb.handed = aLeft ? 'right' : 'left';
  }
  return out;
}

const cx = (b) => b.x + b.w / 2, cy = (b) => b.y + b.h / 2;
