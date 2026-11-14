// 运行：node tests/unit.test.mjs
import assert from 'node:assert/strict';
import { solveHomography, applyHomography } from '../js/input/homography.js';
import { OneEuro } from '../js/input/oneEuro.js';

const src = [[0.2, 0.1], [0.8, 0.15], [0.85, 0.9], [0.1, 0.8]], dst = [[0.1, 0.12], [0.9, 0.12], [0.9, 0.88], [0.1, 0.88]];
const H = solveHomography(src, dst);
src.forEach((p, i) => { const [u, v] = applyHomography(H, ...p); assert.ok(Math.abs(u - dst[i][0]) < 1e-9 && Math.abs(v - dst[i][1]) < 1e-9); });
assert.equal(solveHomography([[0, 0], [0, 0], [0, 0], [0, 0]], dst), null, '退化四边形应返回 null');

const f = new OneEuro(); let out = 0;
for (let i = 0; i < 60; i++) out = f.filter(1 + (i % 2 ? 0.02 : -0.02), i * 33);
assert.ok(Math.abs(out - 1) < 0.02, 'One Euro 应抑制抖动');
console.log('unit tests passed');
