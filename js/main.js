// 入口：组装输入层、玩法层（首页 / 擦玻璃 / 混色画画 / 投水球）、渲染层、音频层，并处理首屏与家长设置。
import { bus } from './core/eventBus.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { EventLog, DeviceBridge } from './core/eduHooks.js';
import { HandTracker } from './input/handTracker.js';
import { InputManager } from './input/inputManager.js';
import { CalibrationStore } from './input/calibrationStore.js';
import { CalibrationUI } from './input/calibrationUI.js';
import { ContentProvider, loadUploadedImage, storeUploadedFile, clearUploadedImage } from './content/cards.js';
import { Effects } from './render/effects.js';
import { drawHand, drawPlayerMark } from './render/handRenderer.js';
import { safeRect } from './input/safeZone.js';
import { Sfx } from './audio/sfx.js';
import { Speech } from './audio/speech.js';
import { HoverUI } from './ui/hoverUI.js';
import { HomeMode } from './game/homeMode.js';
import { WipeMode } from './game/wipeMode.js';
import { PaintMode } from './game/paintMode.js';
import { ThrowMode } from './game/throwMode.js';

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), ctx = stage.getContext('2d', { alpha: false });
const video = $('#video');

// ---------- v7 画质 / 流畅度 ----------
// 阴影模糊（shadowBlur）是 Canvas 2D 里最贵的效果之一：流畅档在主画布上把它关掉（偏移阴影仍保留，卡通感不变）。
const _blurDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'shadowBlur');
let shadowsOn = true;
try {
  Object.defineProperty(ctx, 'shadowBlur', { configurable: true, get() { return _blurDesc.get.call(this); }, set(v) { _blurDesc.set.call(this, shadowsOn ? v : 0); } });
} catch {}
// 各档的内部画布最长边：画布像素和屏幕大小 / devicePixelRatio 无关，CSS 拉伸到全屏（3072×1920 的屏幕也只画这么多像素）
const TIERS = [1440, 1280, 1024, 860, 720];
const PROFILES = {
  smooth: { start: 1024, min: 720, shadows: false, parts: 160 },  // 流畅（默认）：孩子不在乎清晰度，帧率优先
  auto:   { start: 1280, min: 860, shadows: true, parts: 300 },   // 自动：先清晰一点，卡了自动降
  hq:     { start: 0, min: 0, shadows: true, parts: 600 },        // 高画质：用“高级 → 内部渲染分辨率”，不自动降
};
const quality = { profile: 'smooth', cap: 1024, drops: 0, pending: 0, lowWin: 0, win: [], winT: 0 };
function profileOf() { return PROFILES[settings.perfMode] || PROFILES.smooth; }
function applyQuality(reset) {
  const P = profileOf();
  quality.profile = PROFILES[settings.perfMode] ? settings.perfMode : 'smooth';
  if (reset || !quality.cap) { quality.cap = P.start || settings.renderMax; quality.drops = 0; quality.pending = 0; }
  shadowsOn = P.shadows && quality.cap >= 1024;
  effects.maxParts = P.parts;
}
/** 自动降档：连续约 2 秒平均帧率 < 45 就降一档。首页 / 投水球立即生效；擦玻璃 / 画画要等下一次换模式（避免清掉画到一半的画）。 */
function adaptQuality(now, frameMs) {
  const P = profileOf();
  if (!P.start || quality.cap <= P.min) return;
  quality.win.push(frameMs);
  if (now - quality.winT < 1000) return;
  const a = quality.win.slice().sort((x, y) => x - y), med = a[a.length >> 1] || 0;
  quality.win = []; quality.winT = now;
  if (document.hidden || !med) return;
  quality.lowWin = med > 22 ? quality.lowWin + 1 : 0;
  if (quality.lowWin < 2) return;
  quality.lowWin = 0;
  const next = TIERS.find(t => t < quality.cap && t >= P.min);
  if (!next) return;
  quality.cap = next; quality.drops++; shadowsOn = P.shadows && next >= 1024;
  console.info('[魔法玻璃] 帧率偏低，内部分辨率降到', next);
  if (!mode || mode === instances.home || mode === instances.throw) resize(); else quality.pending = 1;
}

let settings = loadSettings();
const log = new EventLog();
const tracker = new HandTracker(video);
if (/[?&]worker=0\b/.test(location.search)) tracker.useWorker = false; // 调试：强制在主线程识别
const calibration = new CalibrationStore();
const input = new InputManager({ tracker, calibration, element: stage, getSettings: () => settings });
const sfx = new Sfx(); sfx.volume = settings.volume;
const speech = new Speech();
const effects = new Effects();
const ui = new HoverUI();
const content = new ContentProvider();
content.setUploaded(loadUploadedImage()); content.useUpload = settings.useUpload;

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 模式 ----------
// 模式注册表：每个模式实现 enter / exit / resize / applySettings / update / render / handDecor
const app = { goMode, toast };
const shared = () => ({ effects, sfx, speech, content, bus, log, settings: { ...settings }, ui, app });
const MODES = { home: HomeMode, wipe: WipeMode, paint: PaintMode, throw: ThrowMode };
const instances = {};
let mode = null;
let running = false;

function goMode(name, params) {
  if (mode) mode.exit();
  speech.cancel();
  effects.parts = [];
  if (!instances[name] || params) instances[name] = new MODES[name](shared());
  const prev = mode; mode = instances[name];
  if (quality.pending && running && prev) resize(); // 降档推迟到换模式时生效
  mode.applySettings({ ...settings });
  mode.resize(stage.width, stage.height);
  mode.enter(params);
  bus.emit('mode:change', { name });
  syncModeSeg();
}

// ---------- 画布尺寸：内部分辨率固定（最长边 renderMax），CSS 拉伸到全屏 ----------
let Q = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  quality.pending = 0;
  const cap = quality.profile === 'hq' ? settings.renderMax : quality.cap;
  const maxSide = Math.min(cap, Math.max(w, h) * (window.devicePixelRatio || 1));
  Q = maxSide / Math.max(w, h);
  stage.width = Math.round(w * Q); stage.height = Math.round(h * Q);
  input.resize(w, h, Q); ui.setBounds(stage.width, stage.height);
  // 先调整后台的模式，最后调整当前模式：有的模式在 resize 里会重设悬停按钮，当前模式的按钮必须留在最后
  for (const m of Object.values(instances)) if (m !== mode) m.resize(stage.width, stage.height);
  mode?.resize(stage.width, stage.height);
}
let resizeT; const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(resize, 200); };
window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);

// 平板 / 手机：玩的时候禁止双指缩放、双击缩放、页面滚动和下拉刷新（家长设置面板里仍可上下滚动）
const inScrollable = (t) => !!(t && t.closest && t.closest('#settings'));
['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => { if (!inScrollable(e.target) || e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => { if (!inScrollable(e.target)) e.preventDefault(); });

const calibUI = new CalibrationUI({ store: calibration, input, tracker, sfx, root: $('#calib'), video, toast, onDone: () => updateCalibState() });

// ---------- 主循环 ----------
let last = performance.now();
const perf = { frames: 0, t0: last, fps: 0, work: 0, workMax: 0, workSum: 0 };
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const tStart = performance.now();
  const { hands, clicks } = input.update(now, dt);
  calibUI.update(now);
  if (mode) {
    if (!calibUI.active) { ui.update(dt, hands, clicks); mode.update(dt, { hands, clicks, now }); }
    mode.render(ctx);
    if (!calibUI.active) {
      for (const m of input.playerMarks()) drawPlayerMark(ctx, m, input.minD * 0.12);
      for (const h of hands) drawHand(ctx, h, mode.handDecor ? mode.handDecor(h) : {});
    }
  }
  calibUI.render(ctx, stage.width, stage.height);
  if (!$('#previewBox').classList.contains('collapsed')) drawPreview();
  const work = performance.now() - tStart;
  adaptQuality(now, (now - perf.lastNow) || 16); perf.lastNow = now;
  perf.frames++; perf.workSum += work; perf.workMax = Math.max(perf.workMax, work);
  if (now - perf.t0 > 500) {
    perf.fps = perf.frames * 1000 / (now - perf.t0); perf.work = perf.workSum / perf.frames;
    updatePerf(); perf.frames = 0; perf.workSum = 0; perf.workMax = 0; perf.t0 = now;
  }
  requestAnimationFrame(frame);
}

function updatePerf() {
  const box = $('#perfBox');
  const vw = video.videoWidth, vh = video.videoHeight;
  const txt = [
    `渲染  ${perf.fps.toFixed(0)} fps   每帧计算 ${perf.work.toFixed(1)} ms（最大 ${perf.workMax.toFixed(1)}）`,
    `识别  ${tracker.backend === 'none' ? '未启用（鼠标/触屏）' : `手 ${tracker.detectFps.toFixed(0)} fps · ${tracker.handMs.toFixed(1)} ms · MediaPipe ${tracker.backend}`}`,
    `人脸  ${!settings.players ? '关闭（不区分玩家）' : tracker.faceDetector ? `${tracker.faceFps.toFixed(0)} fps · ${tracker.faceMs.toFixed(1)} ms · ${tracker.faceBackend} · 玩家 ${input.persons.persons.length}` : '未加载'}`,
    `识别线程 ${tracker.backend === 'none' ? '-' : tracker.thread === 'worker' ? 'Worker（不卡渲染）' : '主线程'}   送入模型 ≤${tracker.maxInput}px${tracker.note ? '   ' + tracker.note : ''}`,
    `画质 ${({ smooth: '流畅', auto: '自动', hq: '高画质' })[quality.profile]}   内部分辨率 ${stage.width}×${stage.height}${quality.drops ? `（已自动降 ${quality.drops} 档${quality.pending ? '，换模式后生效' : ''}）` : ''}   阴影${shadowsOn ? '开' : '关'}`,
    `屏幕 CSS ${innerWidth}×${innerHeight} · dpr ${devicePixelRatio} · 物理 ${Math.round(innerWidth * devicePixelRatio)}×${Math.round(innerHeight * devicePixelRatio)}`,
    `摄像头 ${vw ? vw + '×' + vh : '未打开'}   手 ${input.hands.filter(h => h.source === 'hand').length}   模式 ${mode?.name || '-'}`,
  ].join('\n');
  if (!box.classList.contains('hidden')) box.textContent = txt;
  const d = $('#diag'); if (d) d.textContent = txt;
  window.__perf = { fps: perf.fps, workMs: perf.work, w: stage.width, h: stage.height, profile: quality.profile, cap: quality.cap, drops: quality.drops, shadows: shadowsOn, thread: tracker.thread, backend: tracker.backend, faceBackend: tracker.faceBackend, handMs: tracker.handMs, detectFps: tracker.detectFps, camera: [video.videoWidth, video.videoHeight] };
}

function drawPreview() {
  const c = $('#previewCanvas'), r = c.getBoundingClientRect();
  if (c.width !== r.width) { c.width = r.width; c.height = r.height; }
  const p = c.getContext('2d'); p.clearRect(0, 0, c.width, c.height);
  // 玩家：只画人脸位置框和号码（不保存任何图像）
  for (const pr of input.persons.persons) {
    const b = pr.box, col = ['#ff9f1c', '#3a86ff', '#ff4d8d', '#2bb24c'][(pr.slot - 1) % 4];
    p.strokeStyle = col; p.lineWidth = 2; p.strokeRect(b.x * c.width, b.y * c.height, b.w * c.width, b.h * c.height);
    p.fillStyle = col; p.font = 'bold 12px sans-serif'; p.fillText(String(pr.slot), b.x * c.width + 3, b.y * c.height + 12);
  }
  p.fillStyle = '#7CFC00';
  for (const h of tracker.hands) for (const l of h.landmarks) { p.beginPath(); p.arc(l.x * c.width, l.y * c.height, 2.5, 0, Math.PI * 2); p.fill(); }
  p.strokeStyle = '#ffd60a'; p.lineWidth = 2;
  if (settings.displayMode === 'screen') {
    // 安全区：框外变暗，黄框以内映射到整个屏幕
    const r = safeRect(settings), X = r.x0 * c.width, Y = r.y0 * c.height, Wd = r.w * c.width, Hd = r.h * c.height;
    p.fillStyle = 'rgba(0,0,0,0.35)';
    p.fillRect(0, 0, c.width, Y); p.fillRect(0, Y + Hd, c.width, c.height - Y - Hd); p.fillRect(0, Y, X, Hd); p.fillRect(X + Wd, Y, c.width - X - Wd, Hd);
    p.strokeRect(X, Y, Wd, Hd);
  } else if (calibration.pairs) {
    p.beginPath(); calibration.pairs.src.forEach(([x, y], i) => i ? p.lineTo(x * c.width, y * c.height) : p.moveTo(x * c.width, y * c.height)); p.closePath(); p.stroke();
  }
}

// ---------- 启动 ----------
function enterGame() {
  $('#start').classList.add('hidden');
  if (!running) { running = true; resize(); goMode('home'); requestAnimationFrame(frame); }
}

async function startWithCamera() {
  sfx.unlock(); warmSpeech();
  const st = $('#startStatus');
  try {
    st.textContent = '正在打开摄像头…（请在浏览器弹窗里点“允许”）';
    await tracker.startCamera(settings.cameraId);
    await fillCameras();
  } catch (e) {
    console.warn(e);
    enterGame(); toast('没打开摄像头，先用鼠标或触屏玩吧（可在家长设置里重试）', 4000);
    return;
  }
  enterGame();
  toast('正在加载手部识别…', 8000);
  try {
    await tracker.setMaxHands(settings.maxHands);
    tracker.facesOn = settings.players;
    await tracker.initModel((m) => toast(m, 8000));
    toast('准备好了！举起手，屏幕上会出现你的小手 👋');
  } catch (e) {
    console.warn(e);
    toast('手部识别加载失败（需要联网），可以先用鼠标或触屏玩', 5000);
  }
}
// iPad / iPhone 的 Safari 只允许在用户点击时第一次发声：第一次点按钮时先“空读”一下，后面朗读才会响
function warmSpeech() { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.cancel(); speechSynthesis.speak(u); speechSynthesis.getVoices(); } catch {} }
// 任何一次点按都再解锁一次音频和朗读（防止 iOS 在后台切换后又把声音挂起）
let unlockedOnce = false;
document.addEventListener('pointerdown', () => { sfx.unlock(); if (!unlockedOnce) { unlockedOnce = true; warmSpeech(); } }, { passive: true, capture: true });

$('#btnStart').addEventListener('click', startWithCamera);
$('#btnMouse').addEventListener('click', () => { sfx.unlock(); warmSpeech(); enterGame(); toast('用鼠标或手指点一点、拖一拖（按下就是握拳）'); });

// ---------- 家长设置 ----------
const panel = $('#settings');
function openSettings() { syncSettingsUI(); panel.classList.remove('hidden'); fillCameras(); updateCalibState(); }
function closeSettings() { panel.classList.add('hidden'); }
$('#btnClose').addEventListener('click', closeSettings);

let gearT; const gear = $('#gear');
gear.addEventListener('pointerdown', () => { gear.classList.add('pressing'); gearT = setTimeout(() => { gear.classList.remove('pressing'); openSettings(); }, 1000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => gear.addEventListener(ev, () => { gear.classList.remove('pressing'); clearTimeout(gearT); }));
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'p' || k === 's') panel.classList.contains('hidden') ? openSettings() : closeSettings();
  else if (e.key === 'Escape') { if (calibUI.active) calibUI.stop(false); else closeSettings(); }
  else if (k === 'n') mode?.skip?.();
  else if (k === 'v') togglePreview(!settings.showPreview);
  else if (k === 'f') togglePerf(!settings.perfOverlay);
  else if (k === 'h') running && goMode('home');
});

function commit() {
  saveSettings(settings); sfx.setVolume(settings.volume); content.useUpload = settings.useUpload;
  for (const m of Object.values(instances)) m.applySettings({ ...settings });
  syncSettingsUI();
}

function syncModeSeg() { document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode?.name)); }
function syncSettingsUI() {
  document.querySelectorAll('#coverSeg button').forEach(b => b.classList.toggle('on', b.dataset.cover === settings.cover));
  document.querySelectorAll('#displaySeg button').forEach(b => b.classList.toggle('on', b.dataset.display === settings.displayMode));
  panel.classList.toggle('screen', settings.displayMode === 'screen'); panel.classList.toggle('projector', settings.displayMode === 'projector');
  const set = (id, v, txt) => { $('#' + id).value = v; if (txt != null) $('#' + id + 'Val').textContent = txt; };
  set('brush', settings.brushSize, settings.brushSize.toFixed(1) + '×');
  set('threshold', settings.threshold, Math.round(settings.threshold * 100) + '%');
  set('volume', settings.volume, Math.round(settings.volume * 100) + '%');
  set('safeMargin', settings.safeMargin, Math.round(settings.safeMargin * 100) + '%');
  set('safeBottom', settings.safeBottomExtra, '+' + Math.round(settings.safeBottomExtra * 100) + '%');
  $('#players').checked = settings.players !== false; $('#maxHands').value = String(settings.maxHands >= 4 ? 4 : 2);
  set('handScale', settings.handScale, settings.handScale.toFixed(1) + '×');
  $('#refog').checked = settings.refog; $('#lang').value = settings.lang; $('#preview').checked = settings.showPreview;
  $('#throwContent').value = settings.throwContent || 'num'; $('#throwSkipFree').checked = !!settings.throwSkipFree;
  set('throwFreeHits', settings.throwFreeHits ?? 5, String(settings.throwFreeHits ?? 5));
  $('#perf').checked = settings.perfOverlay; $('#renderMax').value = String(settings.renderMax);
  $('#perfMode').value = PROFILES[settings.perfMode] ? settings.perfMode : 'smooth';
  syncModeSeg();
}

document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => { if (running) { goMode(b.dataset.mode); closeSettings(); } }));
document.querySelectorAll('#coverSeg button').forEach(b => b.addEventListener('click', () => { settings.cover = b.dataset.cover; commit(); }));
document.querySelectorAll('#displaySeg button').forEach(b => b.addEventListener('click', () => { settings.displayMode = b.dataset.display; commit(); }));
const num = (id, key) => $('#' + id).addEventListener('input', (e) => { settings[key] = +e.target.value; commit(); });
num('brush', 'brushSize'); num('threshold', 'threshold'); num('volume', 'volume'); num('safeMargin', 'safeMargin'); num('safeBottom', 'safeBottomExtra');
$('#players').addEventListener('change', (e) => { settings.players = e.target.checked; commit(); tracker.setFaces(settings.players); toast(settings.players ? '已开启区分玩家' : '已关闭区分玩家（按手区分颜色）'); });
$('#maxHands').addEventListener('change', (e) => { settings.maxHands = +e.target.value; commit(); tracker.setMaxHands(settings.maxHands); }); num('handScale', 'handScale');
$('#refog').addEventListener('change', (e) => { settings.refog = e.target.checked; commit(); });
$('#throwContent').addEventListener('change', (e) => { settings.throwContent = e.target.value; commit(); });
$('#throwSkipFree').addEventListener('change', (e) => { settings.throwSkipFree = e.target.checked; commit(); });
num('throwFreeHits', 'throwFreeHits');
$('#lang').addEventListener('change', (e) => { settings.lang = e.target.value; commit(); });
$('#preview').addEventListener('change', (e) => togglePreview(e.target.checked));
$('#perf').addEventListener('change', (e) => togglePerf(e.target.checked));
$('#renderMax').addEventListener('change', (e) => { settings.renderMax = +e.target.value; commit(); resize(); });
$('#perfMode').addEventListener('change', (e) => {
  settings.perfMode = e.target.value; commit(); applyQuality(true); if (running) resize();
  toast({ smooth: '已切换到“流畅”：画面略软，但最跟手', auto: '已切换到“自动”：卡的时候自动降低画质', hq: '已切换到“高画质”：如果卡，请换回“流畅”' }[settings.perfMode]);
});
function togglePreview(on) { settings.showPreview = on; $('#previewBox').classList.toggle('collapsed', !on); commit(); }
function togglePerf(on) { settings.perfOverlay = on; $('#perfBox').classList.toggle('hidden', !on); commit(); updatePerf(); }

async function fillCameras() {
  const sel = $('#camera'); const cams = await tracker.listCameras();
  if (!cams.length) return;
  sel.innerHTML = '<option value="">默认摄像头</option>' + cams.map((c, i) => `<option value="${c.deviceId}">${c.label || '摄像头 ' + (i + 1)}</option>`).join('');
  sel.value = settings.cameraId || '';
}
$('#camera').addEventListener('change', async (e) => {
  settings.cameraId = e.target.value; commit();
  try { await tracker.startCamera(settings.cameraId); toast('已切换摄像头'); if (!tracker.landmarker) await tracker.initModel(); }
  catch (err) { console.warn(err); toast('这个摄像头打不开，请换一个'); }
});

$('#btnCalibPoint').addEventListener('click', () => { if (calibUI.startPoint()) closeSettings(); });
$('#btnCalibDrag').addEventListener('click', () => { if (calibUI.startDrag()) closeSettings(); });
$('#btnCalibReset').addEventListener('click', () => { calibration.reset(); updateCalibState(); toast('已重置为全画面映射'); });
function updateCalibState() { $('#calibState').textContent = calibration.isCalibrated ? '✅ 已标定（保存在本机浏览器）' : '未标定：使用全画面映射'; }

$('#upload').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  try { const data = await storeUploadedFile(f); content.setUploaded(data); toast('已加入！每一轮的最后一张就是这幅画'); }
  catch (err) { console.warn(err); toast('图片读取失败，请换一张'); }
  e.target.value = '';
});
$('#btnClearUpload').addEventListener('click', () => { clearUploadedImage(); content.setUploaded(''); toast('已删除上传的画'); });
$('#btnNext').addEventListener('click', () => { mode?.skip?.(); closeSettings(); });
$('#btnFullscreen').addEventListener('click', () => {
  const el = document.documentElement, fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (fs) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); return; }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) { try { const r = req.call(el); r?.catch?.(() => fsHint()); } catch { fsHint(); } } else fsHint();
});
// iPhone / 部分 iPad 不支持网页全屏：提示“添加到主屏幕”
function fsHint() { toast('这台设备不支持网页全屏：可以点 Safari 的“分享 → 添加到主屏幕”，从主屏幕打开就是全屏', 5000); }


applyQuality(true);
syncSettingsUI(); togglePreview(settings.showPreview); togglePerf(settings.perfOverlay);
if (!window.isSecureContext) $('#startStatus').textContent = '提示：请用 https 网址或 localhost 打开，否则无法使用摄像头。';

// 调试 / 自动化测试入口（不含任何影像数据）
window.__mg = { get mode() { return mode; }, get audioState() { return sfx.ctx ? sfx.ctx.state : "none"; }, get audioPrimed() { return !!sfx._primed; }, get settings() { return settings; }, input, tracker, calibration, log, bus, ui, DeviceBridge, enterGame, goMode };
