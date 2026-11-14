// 内容库（ContentProvider 默认实现）。
// 每张卡：letter 大号字母、word 英文、zh 中文、emoji 图画、colors 配色、speak 朗读文本。
export const CARDS = [
  { id: 'A', letter: 'A', word: 'Apple',    zh: '苹果', emoji: '🍎', colors: ['#ff5e62', '#ff9966'] },
  { id: 'B', letter: 'B', word: 'Bear',     zh: '熊',   emoji: '🐻', colors: ['#a0522d', '#f4a460'] },
  { id: 'C', letter: 'C', word: 'Cat',      zh: '小猫', emoji: '🐱', colors: ['#f7971e', '#ffd200'] },
  { id: 'D', letter: 'D', word: 'Dog',      zh: '小狗', emoji: '🐶', colors: ['#56ab2f', '#a8e063'] },
  { id: 'E', letter: 'E', word: 'Elephant', zh: '大象', emoji: '🐘', colors: ['#4facfe', '#00f2fe'] },
  { id: 'F', letter: 'F', word: 'Fish',     zh: '小鱼', emoji: '🐟', colors: ['#2193b0', '#6dd5ed'] },
  { id: 'G', letter: 'G', word: 'Grapes',   zh: '葡萄', emoji: '🍇', colors: ['#8e2de2', '#c471f5'] },
  { id: 'H', letter: 'H', word: 'House',    zh: '房子', emoji: '🏠', colors: ['#ee0979', '#ff6a00'] },
  { id: 'L', letter: 'L', word: 'Lion',     zh: '狮子', emoji: '🦁', colors: ['#f12711', '#f5af19'] },
  { id: 'S', letter: 'S', word: 'Sun',      zh: '太阳', emoji: '🌞', colors: ['#fceabb', '#f8b500'] },
];

const UPLOAD_KEY = 'magicGlass.upload.v1';

/** 家长上传的图片：缩小后以 dataURL 只存本机 localStorage。 */
export function loadUploadedImage() {
  try { return localStorage.getItem(UPLOAD_KEY) || ''; } catch { return ''; }
}
export function clearUploadedImage() { try { localStorage.removeItem(UPLOAD_KEY); } catch {} }

export async function storeUploadedFile(file, maxSide = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    try { localStorage.setItem(UPLOAD_KEY, data); } catch { /* 太大则只在本次使用 */ }
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/** 题目提供者：顺序循环；若有上传图片，每轮最后一题是孩子自己的画。 */
export class ContentProvider {
  constructor() { this.index = -1; this.uploaded = ''; this.useUpload = true; }
  setUploaded(dataUrl) { this.uploaded = dataUrl || ''; }
  list() {
    const l = [...CARDS];
    if (this.uploaded && this.useUpload) l.push({ id: 'upload', image: this.uploaded, zh: '你的画', word: 'My picture', colors: ['#fdfbfb', '#ebedee'] });
    return l;
  }
  next() { const l = this.list(); this.index = (this.index + 1) % l.length; return l[this.index]; }
  current() { const l = this.list(); return l[Math.max(0, this.index) % l.length]; }
}
