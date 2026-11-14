// 家长设置：保存在 localStorage（只存参数，不存任何影像）。
const KEY = 'magicGlass.settings.v2';

export const DEFAULTS = {
  cover: 'fog',          // 'fog' | 'mud'
  brushSize: 1.0,        // 笔刷倍数 0.5 – 2
  threshold: 0.70,       // 过关擦开比例
  refog: false,          // 缓慢重新起雾
  refogSpeed: 0.02,      // 每秒回填比例
  lang: 'both',          // 'zh' | 'en' | 'both'
  cameraId: '',
  showPreview: false,
  volume: 0.8,
  useUpload: true,       // 家长上传的图片加入题目
  maxHands: 4,           // 最多识别几只手（两个人 × 两只手）
  players: true,         // 区分玩家：用人脸位置框把手分给不同的人，每人左右手各记各的颜色（不保存任何图像）
  displayMode: 'screen', // 'screen'：屏幕 + 摄像头在屏幕上方；'projector'：投影 + 四角标定
  safeMargin: 0.15,      // 屏幕模式安全区：摄像头画面四周各留多少不用（0–0.3），中间映射到全屏
  safeBottomExtra: 0.10, // 安全区下边再多留多少（孩子的手放低时常常出画面）
  handScale: 1,          // 虚拟手大小
  renderMax: 1440,       // 高级：内部画布最长边（像素），CSS 拉伸到全屏
  perfOverlay: false,
};

const REV = 4; // 设置版本：v4 起最多 4 只手、安全区替代旧的“有效区域大小 / 上下位置”
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
    if (!(s.rev >= REV)) { s.maxHands = Math.max(s.maxHands || 0, DEFAULTS.maxHands); s.rev = REV; }
    delete s.screenRegion; delete s.screenOffsetY;
    return s;
  } catch { return { ...DEFAULTS, rev: REV }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}
