// 运行：node tests/mix.test.mjs —— 验证减色混色结果
import assert from 'node:assert/strict';
import { mixRgb, nameColor, PIGMENTS } from '../js/paint/mixer.js';
const P = Object.fromEntries(PIGMENTS.map(p => [p.id, p.rgb]));
const hue = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
const cases = [
  ['红 + 黄', [P.red, P.yellow], 'orange', [15, 45]],
  ['黄 + 蓝', [P.yellow, P.blue], 'green', [90, 160]],
  ['红 + 蓝', [P.red, P.blue], 'purple', [270, 330]],
  ['红 + 黄 + 蓝', [P.red, P.yellow, P.blue], 'brown', [20, 50]],
  ['红 + 白', [P.red, P.white], 'pink', [330, 360]],
  ['蓝 + 白', [P.blue, P.white], 'lightblue', [200, 230]],
  ['黑 + 白', [P.black, P.white], 'gray', null],
];
for (const [label, cols, expect, hr] of cases) {
  const rgb = mixRgb(cols); const name = nameColor(rgb); const h = hue(rgb);
  console.log(`${label} = rgb(${rgb.join(',')}) 色相 ${h.toFixed(0)}° → ${name.zh} ${name.en}`);
  assert.equal(name.id, expect, `${label} 应为 ${expect}`);
  if (hr) assert.ok(h >= hr[0] && h <= hr[1], `${label} 色相 ${h} 不在 ${hr}`);
}
// 对比：RGB 平均（加色/错误做法）黄 + 蓝 会得到灰色，而不是绿色
const naive = [0, 1, 2].map(i => Math.round((P.yellow[i] + P.blue[i]) / 2));
console.log(`对照：RGB 直接平均 黄+蓝 = rgb(${naive.join(',')}) → ${nameColor(naive).zh}`);
assert.notEqual(nameColor(naive).id, 'green');
console.log('mix tests passed');
