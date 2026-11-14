// 运行：node tests/players.test.mjs —— 玩家跟踪（人脸位置框）、手 → 人分配、左右手、安全区映射
import assert from 'node:assert/strict';
import { PersonTracker, assignHands, trueHandedness, iou } from '../js/input/persons.js';
import { safeRect, camToScreen, screenToCam, SAFE_DEFAULTS } from '../js/input/safeZone.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const face = (cx, cy, h = 0.16, a = 4 / 3) => ({ x: cx - h / a / 2, y: cy - h / 2, w: h / a, h }); // 正方形脸框（像素上）

// ---------- 左右手标签（输入未镜像 → 标签反过来） ----------
ok(trueHandedness('Left') === 'right' && trueHandedness('Right') === 'left', '未镜像输入：标签反转');
ok(trueHandedness('Left', true) === 'left', '镜像输入：不反转');
ok(trueHandedness(undefined) === null, '无标签');
ok(Math.abs(iou(face(0.3, 0.3), face(0.3, 0.3)) - 1) < 1e-9 && iou(face(0.2, 0.3), face(0.8, 0.3)) === 0, 'IoU');

// ---------- 人脸跟踪：编号稳定、宽限期、编号槽位复用 ----------
{
  const t = new PersonTracker({ graceMs: 2000 });
  let ps = t.update([face(0.3, 0.3), face(0.7, 0.32)], 0);
  ok(ps.length === 2 && ps[0].slot === 1 && ps[1].slot === 2, '两个人：1 号、2 号');
  const [idA, idB] = [ps[0].id, ps[1].id];
  // 两人慢慢移动 30 帧（每帧 0.01），编号不变
  for (let i = 1; i <= 30; i++) ps = t.update([face(0.3 + i * 0.005, 0.3), face(0.7 - i * 0.004, 0.32 + i * 0.002)], i * 100);
  ok(ps.find(p => p.slot === 1).id === idA && ps.find(p => p.slot === 2).id === idB, '移动中编号稳定');
  // 输入顺序颠倒也不会换号
  const a = ps.find(p => p.id === idA).box, b = ps.find(p => p.id === idB).box;
  ps = t.update([{ ...b }, { ...a }], 3100);
  ok(ps.find(p => p.slot === 1).id === idA, '检测顺序颠倒不换号');
  // A 的脸丢 1.5 秒（宽限期内）再回来：还是原来的编号
  for (let k = 1; k <= 15; k++) t.update([{ ...b }], 3100 + k * 100);
  ok(t.persons.length === 2, '宽限期内保留');
  ps = t.update([{ ...a }, { ...b }], 4700);
  ok(ps.find(p => p.box.x < 0.5).id === idA, '回来后编号不变');
  // A 丢 2.5 秒（超过宽限期）→ 删除；新的人拿到空出来的 1 号槽、但是新编号
  for (let k = 1; k <= 25; k++) t.update([{ ...b }], 4700 + k * 100);
  ok(t.persons.length === 1 && t.persons[0].id === idB, '超过宽限期删除');
  ps = t.update([face(0.25, 0.3), { ...b }], 7300);
  const nw = ps.find(p => p.id !== idB);
  ok(nw.slot === 1 && nw.id !== idA, '新的人：复用 1 号槽，新编号');
  // 跳得太远（超过 1.5 个脸高）不算同一个人
  const t2 = new PersonTracker(); t2.update([face(0.2, 0.3)], 0); const id0 = t2.persons[0].id;
  t2.update([face(0.6, 0.3)], 100);
  ok(t2.persons.length === 2 && t2.persons.some(p => p.id === id0), '远距离跳变 = 另一个人');
  // 最多 4 人
  const t3 = new PersonTracker({ maxPersons: 4 });
  t3.update([0.1, 0.3, 0.5, 0.7, 0.9].map(x => face(x, 0.3, 0.1)), 0);
  ok(t3.persons.length === 4, '最多 4 人');
}

// ---------- 手 → 人 ----------
{
  const t = new PersonTracker();
  const persons = t.update([face(0.3, 0.3), face(0.7, 0.3)], 0); // 脸高 0.16
  const [A, B] = persons;
  const H = (id, x, y, handed = null, prev = null) => ({ id, wrist: [x, y], handed, prev });
  // 两人各两只手（镜像画面：右手在脸的右边）
  let r = assignHands([H(1, 0.2, 0.55, 'left'), H(2, 0.4, 0.5, 'right'), H(3, 0.6, 0.55, 'left'), H(4, 0.82, 0.5, 'right')], persons);
  ok(r.get(1).personId === A.id && r.get(2).personId === A.id && r.get(3).personId === B.id && r.get(4).personId === B.id, '两人各两只手');
  ok(r.get(1).handed === 'left' && r.get(2).handed === 'right' && r.get(4).handed === 'right', '左右手保留');
  // 举手到头顶（脸上方 1.5 个脸高）仍算自己的
  r = assignHands([H(1, 0.36, 0.3 - 0.16 * 1.5, 'right')], persons);
  ok(r.get(1).personId === A.id, '举手过头');
  // 太高（3 个脸高以上）或太远：不属于任何人
  r = assignHands([H(1, 0.3, 0.3 - 0.16 * 3, 'right'), H(2, 0.3, 0.3 + 0.16 * 7)], persons);
  ok(r.get(1).personId === null && r.get(2).personId === null, '不合理位置不分配');
  // 两人中间的手：标签是右手 → 归左边那个人（他的右手在他右边），标签是左手 → 归右边那个人
  r = assignHands([H(1, 0.5, 0.5, 'right')], persons); ok(r.get(1).personId === A.id, '中间的右手归左边的人');
  r = assignHands([H(1, 0.5, 0.5, 'left')], persons); ok(r.get(1).personId === B.id, '中间的左手归右边的人');
  // 粘性：上一帧属于 B 的手，略偏向 A 时仍归 B
  r = assignHands([H(1, 0.49, 0.5, null, B.id)], persons); ok(r.get(1).personId === B.id, '粘性');
  // 每人最多两只手：第三只手去另一个人（或不分配）
  r = assignHands([H(1, 0.25, 0.5), H(2, 0.35, 0.5), H(3, 0.3, 0.55)], persons);
  const cntA = [1, 2, 3].filter(i => r.get(i).personId === A.id).length;
  ok(cntA === 2, '每人最多两只手');
  // 同一人两只手标签相同（模型误判）→ 按左右位置纠正
  r = assignHands([H(1, 0.2, 0.5, 'right'), H(2, 0.4, 0.5, 'right')], [A]);
  ok(r.get(1).handed === 'left' && r.get(2).handed === 'right', '同侧标签纠正');
  // 没有人脸：全部 null（退回按手区分）
  r = assignHands([H(1, 0.5, 0.5, 'right')], []); ok(r.get(1).personId === null, '没有人脸');
}

// ---------- 安全区 ----------
{
  const r = safeRect({});
  ok(r.x0 === SAFE_DEFAULTS.safeMargin && Math.abs(r.x1 - (1 - SAFE_DEFAULTS.safeMargin)) < 1e-9, '默认左右边距');
  ok(Math.abs(r.y1 - (1 - SAFE_DEFAULTS.safeMargin - SAFE_DEFAULTS.safeBottomExtra)) < 1e-9, '下边多留');
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  ok(eq(camToScreen(r.x0, r.y0, r), [0, 0]) && eq(camToScreen(r.x1, r.y1, r), [1, 1]), '安全区四角 = 屏幕四角');
  ok(eq(camToScreen(0.5, (r.y0 + r.y1) / 2, r), [0.5, 0.5]), '中心');
  ok(eq(camToScreen(0.02, 0.98, r), [0, 1]) && eq(camToScreen(1, -0.2, r), [1, 0]), '安全区外夹紧到屏幕边');
  for (const [u, v] of [[0, 0], [0.3, 0.7], [1, 1], [0.05, 0.5]]) ok(eq(camToScreen(...screenToCam(u, v, r), r), [u, v]), '互逆');
  const r0 = safeRect({ safeMargin: 0, safeBottomExtra: 0 }); ok(r0.w === 1 && r0.h === 1, '边距 0 = 全画面');
  const rb = safeRect({ safeMargin: 0.35, safeBottomExtra: 0.25 }); ok(rb.h >= 0.2 - 1e-9, '极端设置保留最小高度');
  // 屏幕边上 5% 的颜料罐：手只要在安全区边缘内侧 5% 就能碰到（不用伸到摄像头画面边上）
  const [cx] = screenToCam(0.05, 0.5, r); ok(cx > 0.15 && cx < 0.2, `左边 5% 对应摄像头 x=${cx.toFixed(3)}`);
}
console.log(`players + safe-zone tests passed (${n} checks)`);
