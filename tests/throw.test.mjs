// 投水球纯逻辑单测：node tests/throw.test.mjs
import assert from 'node:assert/strict';
import { fitVelocity, releaseVelocity, throwPlan, aimAssist, labelPool, pickLabel, pickTarget, promptParts, HANZI } from '../js/game/throwLogic.js';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const near = (a, b, tol, m) => ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`);

// --- 速度估计 ---
// 匀速直线：60 fps，每帧 (+5, -12) px → (300, -720) px/s
const lin = Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 5, y: 500 - i * 12, t: i * 1000 / 60 }));
let v = fitVelocity(lin, lin.at(-1).t, 120);
near(v[0], 300, 1e-6, 'linear vx'); near(v[1], -720, 1e-6, 'linear vy');
ok(fitVelocity(lin.slice(0, 1), 0, 120) === null, 'one sample → null');
ok(fitVelocity([], 0, 120) === null, 'no samples → null');
// 噪声（±2 px 抖动）下仍然接近真实速度
let seed = 1; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const noisy = lin.map(p => ({ ...p, x: p.x + (rnd() - 0.5) * 4, y: p.y + (rnd() - 0.5) * 4 }));
v = fitVelocity(noisy, noisy.at(-1).t, 120);
near(v[0], 300, 80, 'noisy vx'); near(v[1], -720, 80, 'noisy vy');
// 挥手后减速、停住再张开：峰值窗口比“最后 120 ms”快得多
const swing = [];
for (let i = 0; i < 30; i++) { const t = i * 1000 / 60; const k = i < 18 ? i : 18 + (i - 18) * 0.1; swing.push({ x: 640, y: 700 - k * 20, t }); }
const tEnd = swing.at(-1).t;
const late = fitVelocity(swing, tEnd, 120), rel = releaseVelocity(swing, tEnd);
ok(Math.hypot(...rel) > 3 * Math.hypot(...late), `release uses peak window (${rel} vs ${late})`);
near(rel[1], -1200, 150, 'peak vy ≈ -1200 px/s');
ok(Math.abs(rel[0]) < 1e-6, 'peak vx ≈ 0');
// 静止的手：速度为 0
const still = Array.from({ length: 20 }, (_, i) => ({ x: 300, y: 300, t: i * 16 }));
near(Math.hypot(...releaseVelocity(still, 19 * 16)), 0, 1e-9, 'still hand → 0');

// --- 出手计划 ---
const U = 900;
let p = throwPlan([720, 760], [0, -1200], U);
near(p.dir[0], 0, 1e-9, 'no sideways component');
near(p.dir[1], -1, 1e-9, 'upward dir'); ok(p.landing[1] < 760, 'lands above origin');
ok(p.dur >= 0.45 && p.dur <= 0.8, 'duration clamped'); ok(p.arc > 0, 'upward arc > 0');
const slow = throwPlan([720, 760], [3, 2], U);
near(slow.dir[1], -1, 1e-9, 'very slow → gentle upward lob'); near(slow.dist, 0.32 * U, 1e-6, 'min range');
const fast = throwPlan([720, 760], [0, -99999], U); near(fast.dist, 1.25 * U, 1e-6, 'max range');
const diag = throwPlan([0, 0], [600, -600], U); near(Math.hypot(...diag.dir), 1, 1e-9, 'dir normalised');

// --- 瞄准辅助 ---
const origin = [720, 760], up = [0, -1];
const mons = [{ id: 'L', x: 300, y: 450 }, { id: 'C', x: 760, y: 430 }, { id: 'R', x: 1150, y: 260 }];
let land = [720, 760 - 0.4 * U];
ok(aimAssist(origin, up, land, mons, U)?.id === 'C', 'straight up → centre monster');
// 方向偏 20°（锥形 32° 以内）仍然锁定
const a20 = -Math.PI / 2 + 20 * Math.PI / 180, d20 = [Math.cos(a20), Math.sin(a20)];
land = [origin[0] + d20[0] * 300, origin[1] + d20[1] * 300];
ok(aimAssist(origin, d20, land, [mons[1]], U)?.id === 'C', '20° off still snaps');
// 方向朝下：谁都打不到
const down = [0, 1]; land = [720, 1000];
ok(aimAssist(origin, down, land, mons, U) === null, 'throwing down → miss');
// 落点附近（半径内）即使不在锥形里也锁定
ok(aimAssist([100, 800], [1, 0], [300, 520], [mons[0]], U)?.id === 'L', 'radius around landing snaps');
// 锥形里有两只：挑离落点最近的
const pair = [{ id: 'A', x: 720, y: 600 }, { id: 'B', x: 740, y: 300 }];
ok(aimAssist(origin, up, [720, 320], pair, U)?.id === 'B', 'far throw → far monster');
ok(aimAssist(origin, up, [720, 580], pair, U)?.id === 'A', 'short throw → near monster');
ok(aimAssist(origin, up, [720, 300], [], U) === null, 'no monsters → null');
// 超出最远距离的不锁定
ok(aimAssist(origin, up, [720, 500], [{ id: 'far', x: 720, y: 760 - 1.8 * U }], U) === null, 'beyond maxDist not snapped');

// --- 题库与目标 ---
ok(labelPool('num').length === 10 && labelPool('num')[0].text === '1' && labelPool('num')[9].text === '10', 'numbers 1–10');
ok(labelPool('letter').length === 26 && labelPool('letter').every(l => /^[A-Z]$/.test(l.text)), 'uppercase letters');
ok(labelPool('hanzi').length === HANZI.length && ['大', '小', '人', '口', '山', '水', '火', '木', '日', '月', '上', '下', '天', '中', '手'].every(c => HANZI.includes(c)), 'hanzi list');
ok(labelPool('mix').length === 10 + 26 + HANZI.length, 'mix');
ok(new Set(labelPool('mix').map(l => l.text)).size === labelPool('mix').length, 'mix labels unique');
for (let i = 0; i < 200; i++) { const l = pickLabel(labelPool('num'), ['1', '2', '3', '4', '5', '6', '7', '8', '9'], Math.random); ok(l.text === '10', 'pickLabel excludes'); }
// 目标一定是屏幕上有的标签，且不连续两次相同
const ms = ['3', '7', '9', '5'].map((t, i) => ({ id: i, label: { type: 'num', text: t } }));
let last = null;
for (let i = 0; i < 300; i++) {
  const m = pickTarget(ms, last, Math.random);
  ok(ms.includes(m), 'target is a visible monster');
  ok(m.label.text !== last, 'no repeat in a row');
  last = m.label.text;
}
ok(pickTarget([{ label: { type: 'num', text: '3' } }], '3', Math.random)?.label.text === '3', 'only one left → still a target');
ok(pickTarget([{ label: null }], null, Math.random) === null, 'no labelled monsters → null');

// --- 语音 ---
let pp = promptParts({ type: 'num', text: '3' }, 'zh', true);
ok(pp.length === 1 && pp[0].text === '现在试试打 3 号！' && pp[0].lang === 'zh', 'lead zh line');
pp = promptParts({ type: 'num', text: '3' }, 'en'); ok(pp[0].text === 'Hit number 3!', 'en number');
pp = promptParts({ type: 'letter', text: 'B' }, 'both'); ok(pp[0].text === '打字母 B！' && pp[1].text === 'Hit the letter B!', 'both letter');
pp = promptParts({ type: 'hanzi', text: '大' }, 'zh'); ok(pp[0].text === '打“大”字！', 'zh hanzi');
pp = promptParts({ type: 'hanzi', text: '大' }, 'en'); ok(pp.length === 2 && pp[1].lang === 'zh' && pp[1].text === '大', 'en hanzi reads char in zh');

console.log(`throw tests passed (${n} checks)`);
