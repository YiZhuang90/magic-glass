# 把 AI 生成的 4 只小怪兽原图（白底 4 只一排，开心版 / 哭脸版）抠成透明贴图：python3 tools/cut_monsters.py OUT_DIR happyA.jpg cryA.jpg name1,name2,name3,name4 [happyB.jpg cryB.jpg names ...]
# 背景从边缘洪水填充（近白色）→ 1.5px 软边 + 对白色反预乘去白边 → 按身体底部中点对齐开心 / 哭脸 → 最长边 384px → WebP + PNG；同时测出肚皮奶油色椭圆的位置（归一化）写到 meta.json。
import numpy as np, json
from PIL import Image
from scipy import ndimage as ndi

def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float32)

def analyze(img):
    mn = img.min(2); mx = img.max(2)
    whiteish = (mn >= 228) & (mx - mn <= 22)
    lab, n = ndi.label(whiteish)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(edge))
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=1)
    flab, fn = ndi.label(fg)
    sizes = ndi.sum(fg, flab, range(1, fn + 1))
    return bg, fg, flab, sizes

def monsters(img):
    bg, fg, flab, sizes = analyze(img)
    order = np.argsort(sizes)[::-1]
    bodies = [i + 1 for i in order[:4]]
    objs = ndi.find_objects(flab)
    bodies.sort(key=lambda l: objs[l - 1][1].start)
    groups = {b: [b] for b in bodies}
    cx = {b: (objs[b-1][1].start + objs[b-1][1].stop) / 2 for b in bodies}
    for l in range(1, len(sizes) + 1):
        if l in bodies or sizes[l - 1] < 30: continue
        sl = objs[l - 1]; c = (sl[1].start + sl[1].stop) / 2
        b = min(bodies, key=lambda b: abs(cx[b] - c))
        groups[b].append(l)
    return bg, flab, objs, bodies, groups

def cut(path):
    img = load(path)
    bg, flab, objs, bodies, groups = monsters(img)
    out = []
    lum = img.min(2)
    for b in bodies:
        mask = np.isin(flab, groups[b])
        # soft alpha band
        dist_out = ndi.distance_transform_edt(~mask)
        dist_in = ndi.distance_transform_edt(mask)
        a = np.where(mask, 1.0, 0.0)
        band = (dist_out <= 1.5) & ~mask | (mask & (dist_in <= 1.5))
        est = np.clip((252 - lum) / (252 - 120), 0, 1)
        a = np.where(band, np.maximum(est, np.where(mask, 0.35, 0)), a)
        a = np.where(mask & (dist_in > 1.5), 1.0, a)
        rgb = img.copy()
        aa = np.maximum(a, 1e-3)[..., None]
        un = np.clip((img - 255 * (1 - aa)) / aa, 0, 255)
        rgb = np.where(band[..., None], un, img)
        ys, xs = np.nonzero(a > 0.02)
        body = objs[b - 1]
        out.append(dict(rgba=np.dstack([rgb, a * 255]).astype(np.uint8), y0=ys.min(), y1=ys.max() + 1, x0=xs.min(), x1=xs.max() + 1,
                        bb=(body[0].stop, (body[1].start + body[1].stop) / 2, body[1].stop - body[1].start, body[0].stop - body[0].start),
                        bodymask=(flab == b), img=img))
    return out

def belly(m):
    """肚皮：从身体下部中间取种子颜色，区域生长出颜色相近的连通块（奶油色椭圆）"""
    img, bm = m['img'], ndi.binary_fill_holes(m['bodymask'])
    ys, xs = np.nonzero(bm); y0, y1 = ys.min(), ys.max(); cx = int(round(xs.mean()))
    sy = int(y0 + 0.7 * (y1 - y0))
    seed = np.median(img[sy - 4:sy + 5, cx - 4:cx + 5].reshape(-1, 3), axis=0)
    near = bm & (np.abs(img - seed).max(2) < 18)
    near = ndi.binary_opening(near, iterations=2)
    lab, n = ndi.label(near)
    k = lab[sy, cx] or (np.argmax(ndi.sum(near, lab, range(1, n + 1))) + 1)
    ys, xs = np.nonzero(lab == k)
    return dict(cx=xs.mean(), cy=ys.mean(), w=xs.max() - xs.min() + 1, h=ys.max() - ys.min() + 1, area=len(xs))

import sys, os
TARGET = 384
def process(hp, cp, names, outdir):
    H = cut(hp); C = cut(cp); meta = []
    for i, (h, c) in enumerate(zip(H, C)):
        ext = []
        for m in (h, c):
            by, bx = m['bb'][0], m['bb'][1]
            ext.append((m['x0'] - bx, m['x1'] - bx, m['y0'] - by, m['y1'] - by))
        pad = 6
        L = min(e[0] for e in ext) - pad; R = max(e[1] for e in ext) + pad
        T = min(e[2] for e in ext) - pad; B = max(e[3] for e in ext) + pad
        L, R = min(L, -R), max(R, -L)   # 左右对称：锚点就是水平中心
        W_, H_ = int(np.ceil(R - L)), int(np.ceil(B - T))
        scale = TARGET / max(W_, H_)
        bl = belly(h); hb = h['bb']
        info = dict(name=names[i])
        for tag, m in (('happy', h), ('cry', c)):
            by, bx = m['bb'][0], m['bb'][1]
            x0 = int(round(bx + L)); y0 = int(round(by + T))
            canvas = np.zeros((H_, W_, 4), np.uint8); src = m['rgba']
            sx0, sy0 = max(0, x0), max(0, y0); sx1, sy1 = min(src.shape[1], x0 + W_), min(src.shape[0], y0 + H_)
            canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = src[sy0:sy1, sx0:sx1]
            arr = canvas.astype(np.float32); al = arr[..., 3:] / 255
            pm = np.dstack([arr[..., :3] * al, arr[..., 3:]])    # 预乘后再缩放，避免暗边
            ow, oh = round(W_ * scale), round(H_ * scale)
            pm_r = np.dstack([np.asarray(Image.fromarray(pm[..., k].astype(np.float32), 'F').resize((ow, oh), Image.LANCZOS)) for k in range(4)])
            a2 = np.clip(pm_r[..., 3], 0, 255); rgb2 = np.where(a2[..., None] > 0.5, pm_r[..., :3] / np.maximum(a2[..., None] / 255, 1e-3), 0)
            res = Image.fromarray(np.dstack([np.clip(rgb2, 0, 255), a2]).astype(np.uint8), 'RGBA')
            res.save(os.path.join(outdir, f'{names[i]}_{tag}.png'), optimize=True)
            res.save(os.path.join(outdir, f'{names[i]}_{tag}.webp'), quality=86, method=6)
            if tag == 'happy':
                info.update(w=ow, h=oh, anchorY=round((-T) / H_, 4), body=dict(w=round(hb[2] / W_, 4), h=round(hb[3] / H_, 4)),
                            belly=dict(x=round((bl['cx'] - (hb[1] + L)) / W_, 4), y=round((bl['cy'] - (hb[0] + T)) / H_, 4), w=round(bl['w'] / W_, 4), h=round(bl['h'] / H_, 4)))
        meta.append(info)
    return meta

if __name__ == '__main__':
    outdir, rest = sys.argv[1], sys.argv[2:]
    os.makedirs(outdir, exist_ok=True); meta = []
    for k in range(0, len(rest), 3):
        meta += process(rest[k], rest[k + 1], rest[k + 2].split(','), outdir)
    json.dump(meta, open(os.path.join(outdir, 'meta.json'), 'w'), indent=1)
    print(json.dumps(meta, separators=(',', ':')))
