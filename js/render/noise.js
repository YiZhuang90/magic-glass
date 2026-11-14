// 值噪声 + fbm，用于生成雾气和泥巴纹理（只在换题时生成一次）。
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; };
}

export function valueNoiseGrid(gw, gh, rng) {
  const g = new Float32Array((gw + 1) * (gh + 1));
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = ((xi % gw) + gw) % gw, Y = ((yi % gh) + gh) % gh;
    const i00 = g[Y * (gw + 1) + X], i10 = g[Y * (gw + 1) + X + 1], i01 = g[(Y + 1) * (gw + 1) + X], i11 = g[(Y + 1) * (gw + 1) + X + 1];
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    return (i00 * (1 - sx) + i10 * sx) * (1 - sy) + (i01 * (1 - sx) + i11 * sx) * sy;
  };
}

/** 生成 w×h 的 fbm 灰度场（0–1）。 */
export function fbmField(w, h, { scale = 0.02, octaves = 5, seed = 7 } = {}) {
  const rng = makeRng(seed);
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(valueNoiseGrid(64, 64, rng));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 0.5, f = scale, v = 0, n = 0;
    for (let o = 0; o < octaves; o++) { v += a * layers[o](x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    out[y * w + x] = v / n;
  }
  return out;
}
