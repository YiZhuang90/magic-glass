// 渲染层 · 隐藏内容卡片：大字母 + 英文 + 中文 + emoji 图画，或家长上传的图片。
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif';
const ROUND_FONT = '"Arial Rounded MT Bold","Nunito","Baloo 2","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const ZH_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

/** 返回 { base: 不含 emoji 的卡片, emoji: emoji 小画布, emojiBox: {x,y,s}, full: 完整卡片 } */
export function renderCard(card, w, h, image = null) {
  const base = canvas(w, h), ctx = base.getContext('2d');
  const [c1, c2] = card.colors || ['#ffd86f', '#fc6262'];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  decorate(ctx, w, h, card.id);

  let emoji = null, emojiBox = null, layout = null;
  const portrait = h > w * 1.1;

  if (image) {
    // 纸张 + 相框，图片按比例完整显示
    const pad = Math.min(w, h) * 0.08;
    const boxW = w - pad * 2, boxH = h - pad * 2 - h * 0.12;
    const k = Math.min(boxW / image.width, boxH / image.height);
    const iw = image.width * k, ih = image.height * k, ix = (w - iw) / 2, iy = pad + (boxH - ih) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#fff'; roundRect(ctx, ix - 18, iy - 18, iw + 36, ih + 36, 24); ctx.fill();
    ctx.restore();
    ctx.drawImage(image, ix, iy, iw, ih);
    ctx.strokeStyle = '#f5b942'; ctx.lineWidth = 10; roundRect(ctx, ix - 18, iy - 18, iw + 36, ih + 36, 24); ctx.stroke();
    label(ctx, card.zh || '你的画', w / 2, h - pad * 0.9 - h * 0.02, h * 0.08, ZH_FONT, '#5b3a8c');
  } else {
    const minD = Math.min(w, h);
    let lx, ly, ls, ex, ey, es, ty;
    if (portrait) {
      ls = minD * 0.55; lx = w / 2; ly = h * 0.30;
      es = minD * 0.42; ex = w / 2; ey = h * 0.60;
      ty = h * 0.86;
    } else {
      ls = h * 0.58; lx = w * 0.30; ly = h * 0.42;
      es = h * 0.44; ex = w * 0.70; ey = h * 0.42;
      ty = h * 0.84;
    }
    layout = { lx, ly, ls, ex, ey, es, ty, fs: minD * 0.1 };
    // 大字母：白色填充 + 深色描边 + 投影
    ctx.save();
    ctx.font = `900 ${ls}px ${ROUND_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = ls * 0.06; ctx.shadowOffsetY = ls * 0.03;
    ctx.lineJoin = 'round'; ctx.lineWidth = ls * 0.07; ctx.strokeStyle = shade(c2, -0.35);
    ctx.strokeText(card.letter, lx, ly);
    ctx.shadowColor = 'transparent';
    const lg = ctx.createLinearGradient(0, ly - ls / 2, 0, ly + ls / 2);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(1, '#fff2c4');
    ctx.fillStyle = lg; ctx.fillText(card.letter, lx, ly);
    ctx.font = `900 ${ls * 0.42}px ${ROUND_FONT}`;
    ctx.restore();

    // emoji 底下的白色光圈
    ctx.save();
    const halo = ctx.createRadialGradient(ex, ey, es * 0.1, ex, ey, es * 0.75);
    halo.addColorStop(0, 'rgba(255,255,255,0.75)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(ex, ey, es * 0.75, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    emoji = canvas(Math.ceil(es * 1.3), Math.ceil(es * 1.3));
    const ec = emoji.getContext('2d');
    ec.font = `${es}px ${EMOJI_FONT}`; ec.textAlign = 'center'; ec.textBaseline = 'middle';
    ec.fillText(card.emoji, emoji.width / 2, emoji.height / 2 + es * 0.05);
    emojiBox = { x: ex, y: ey, s: emoji.width };

    // 单词条：英文 + 中文
    const fs = minD * 0.1;
    ctx.save();
    ctx.font = `800 ${fs}px ${ROUND_FONT}`;
    const enW = ctx.measureText(card.word).width;
    ctx.font = `800 ${fs}px ${ZH_FONT}`;
    const zhW = ctx.measureText(card.zh).width;
    const gap = fs * 0.8, total = enW + gap + zhW, bw = total + fs * 1.4, bh = fs * 1.5;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 6;
    roundRect(ctx, w / 2 - bw / 2, ty - bh / 2, bw, bh, bh / 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = w / 2 - total / 2;
    ctx.font = `800 ${fs}px ${ROUND_FONT}`; ctx.fillStyle = shade(c2, -0.45);
    // 首字母高亮
    ctx.fillStyle = '#e8453c'; ctx.fillText(card.word[0], x, ty);
    const fw = ctx.measureText(card.word[0]).width;
    ctx.fillStyle = shade(c2, -0.5); ctx.fillText(card.word.slice(1), x + fw, ty);
    x += enW + gap;
    ctx.font = `800 ${fs}px ${ZH_FONT}`; ctx.fillStyle = '#3d3d6b'; ctx.fillText(card.zh, x, ty);
    ctx.restore();
  }

  const full = canvas(w, h), fc = full.getContext('2d');
  fc.drawImage(base, 0, 0);
  if (emoji) fc.drawImage(emoji, emojiBox.x - emojiBox.s / 2, emojiBox.y - emojiBox.s / 2);
  return { base, emoji, emojiBox, full, layout };
}

function decorate(ctx, w, h, seedStr) {
  let s = 0; for (const ch of String(seedStr)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000) / 1000; };
  ctx.save();
  for (let i = 0; i < 18; i++) {
    const r = Math.min(w, h) * (0.03 + rnd() * 0.12);
    ctx.globalAlpha = 0.10 + rnd() * 0.15;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = ['#fff', '#fff6a5', '#ffd1f0'][i % 3];
    star(ctx, rnd() * w, rnd() * h, Math.min(w, h) * (0.006 + rnd() * 0.012));
  }
  ctx.restore();
}

export { ROUND_FONT, ZH_FONT, EMOJI_FONT };

export function star(ctx, x, y, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

function label(ctx, text, x, y, size, font, color) {
  ctx.save(); ctx.font = `800 ${size}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
