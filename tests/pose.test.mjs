// 运行：node tests/pose.test.mjs —— 手势判断（只伸食指 / 张开 / 握拳）用合成关键点测试
import assert from 'node:assert/strict';
import { classify, fingerRatios, PoseFilter, TEMPLATES } from '../js/input/gestures.js';

const { OPEN, FIST, POINT } = TEMPLATES;
// 把模板（手长 = 1）摆到画面里：缩放、旋转、平移
function place(tpl, { s = 100, rot = 0, x = 320, y = 240, z = null } = {}) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return tpl.map(([u, v], i) => [x + (u * c - v * sn) * s, y + (u * sn + v * c) * s, z ? z[i] || 0 : 0]);
}
// 在两个模板之间插值某几根手指（用来做“孩子弯不紧”的半弯手指）
function blend(a, b, ids, t) { return a.map((p, i) => ids.includes(i) ? [p[0] + (b[i][0] - p[0]) * t, p[1] + (b[i][1] - p[1]) * t] : p); }
const IDX = [5, 6, 7, 8], MID = [9, 10, 11, 12], RING = [13, 14, 15, 16], PINKY = [17, 18, 19, 20], THUMB = [1, 2, 3, 4];

let n = 0; const ok = (got, want, msg) => { assert.equal(got, want, msg); n++; };

// 1. 三种基本手势，各种大小 / 角度（不依赖原始 y 坐标）
for (const s of [40, 100, 260]) for (const rot of [0, 0.6, -0.9, Math.PI / 2, Math.PI]) {
  ok(classify(place(POINT, { s, rot })), 'point', `只伸食指 s=${s} rot=${rot}`);
  ok(classify(place(OPEN, { s, rot })), 'open', `张开 s=${s} rot=${rot}`);
  ok(classify(place(FIST, { s, rot })), 'fist', `握拳 s=${s} rot=${rot}`);
}
// 2. 拇指伸出或收起都算画笔
ok(classify(place(blend(POINT, FIST, THUMB, 1))), 'point', '拇指收起 + 食指');
ok(classify(place(blend(POINT, OPEN, THUMB, 1))), 'point', '拇指伸出 + 食指');
// 3. 孩子手指弯不紧：中指 / 无名指 / 小指只弯到 70% 仍算画笔
ok(classify(place(blend(OPEN, FIST, [...MID, ...RING, ...PINKY], 0.75))), 'point', '其他三指弯 75%');
// 4. 食指 + 中指（剪刀手）不是画笔；中指没弯也不是
ok(classify(place(blend(OPEN, FIST, [...RING, ...PINKY], 1))) !== 'point', true, '剪刀手不画');
ok(classify(place(blend(POINT, OPEN, MID, 1))) !== 'point', true, '中指也伸直不画');
// 5. 食指只伸了一半 → 不是画笔
ok(classify(place(blend(POINT, FIST, IDX, 0.6))) !== 'point', true, '食指半弯不画');
// 6. 张开手、握拳都不是画笔（核心需求）
ok(classify(place(OPEN), 'point') === 'point', false, '上一帧是画笔，张开手也要立刻不是画笔');
ok(classify(place(FIST), 'point'), 'fist', '上一帧是画笔，握拳 → fist');
// 7. 回差：边界上的手（食指伸到 ~1.5 倍）—— 从别的手势进入时不算，已经是画笔时保持
const loose = blend(OPEN, FIST, [...MID, ...RING, ...PINKY], 0.75); // 其他三指没握紧
const edge = place(blend(loose, FIST, IDX, 0.3));
const er = fingerRatios(edge)[0];
assert.ok(er > 1.42 && er < 1.6, `边界食指比例 ${er}`);
ok(classify(edge, 'open') !== 'point', true, '边界手：进入要求严格');
ok(classify(edge, 'point'), 'point', '边界手：保持时放宽');
// 8. 食指斜着朝向摄像头（画面里只剩一半长），用 z 深度补偿；其他手指的 z 抖动不影响
const fore = POINT.map(([u, v], i) => ([6, 7, 8].includes(i) ? [-0.3 + (u + 0.3) * 0.5, -0.35 + (v + 0.35) * 0.5] : [u, v]));
const zs = POINT.map((_, i) => ({ 6: -32, 7: -52, 8: -69, 12: 12, 16: -10, 20: 8 })[i] || 0);
ok(classify(place(fore)) !== 'point', true, '只看 2D 时食指太短');
ok(classify(place(fore, { z: zs })), 'point', '食指斜指向摄像头（z 补偿）');
// 9. 防抖：单帧误判不会切换，连续 3 帧才进入 / 离开画笔
const f = new PoseFilter('open');
const P = place(POINT), O = place(OPEN), F = place(FIST);
ok(f.update(P), 'open', '第 1 帧'); ok(f.update(P), 'open', '第 2 帧'); ok(f.update(P), 'point', '第 3 帧进入画笔');
ok(f.update(O), 'point', '一帧张开不打断'); ok(f.update(P), 'point', '回到画笔');
ok(f.update(O), 'point', ''); ok(f.update(O), 'point', ''); ok(f.update(O), 'open', '连续 3 帧张开才停笔');
ok(f.update(F), 'open', ''); ok(f.update(F), 'fist', '2 帧握拳');
console.log(`pose tests passed (${n} checks)`);
