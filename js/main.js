// 入口：组装输入层、玩法层（首页 / 擦玻璃 / 混色画画）、渲染层、音频层，并处理首屏与家长设置。
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

const $ = (s) => document.querySelector(s);
const stage = $('#stage'), ctx = stage.getContext('2d', { alpha: false });
const video = $('#video');

let settings = loadSettings();
const log = new EventLog();
const tracker = new HandTracker(video);
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
const MODES = { home: HomeMode, wipe: WipeMode, paint: PaintMode };
const instances = {};
let mode = null;
let running = false;

function goMode(name, params) {
  if (mode) mode.exit();
  speech.cancel();
  effects.parts = [];
  if (!instances[name] || params) instances[name] = new MODES[name](shared());
  mode = instances[name];
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
  const maxSide = Math.min(settings.renderMax, Math.max(w, h) * (window.devicePixelRatio || 1));
  Q = maxSide / Math.max(w, h);
  stage.width = Math.round(w * Q); stage.height = Math.round(h * Q);
  input.resize(w, h, Q); ui.setBounds(stage.width, stage.height);
  for (const m of Object.values(instances)) m.resize(stage.width, stage.height);
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
    `内部分辨率 ${stage.width}×${stage.height}（CSS ${innerWidth}×${innerHeight}，dpr ${devicePixelRatio}）`,
    `摄像头 ${vw ? vw + '×' + vh : '未打开'}   手 ${input.hands.filter(h => h.source === 'hand').length}   模式 ${mode?.name || '-'}`,
  ].join('\n');
  if (!box.classList.contains('hidden')) box.textContent = txt;
  const d = $('#diag'); if (d) d.textContent = txt;
  window.__perf = { fps: perf.fps, workMs: perf.work, w: stage.width, h: stage.height };
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
  $('#perf').checked = settings.perfOverlay; $('#renderMax').value = String(settings.renderMax);
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
$('#lang').addEventListener('change', (e) => { settings.lang = e.target.value; commit(); });
$('#preview').addEventListener('change', (e) => togglePreview(e.target.checked));
$('#perf').addEventListener('change', (e) => togglePerf(e.target.checked));
$('#renderMax').addEventListener('change', (e) => { settings.renderMax = +e.target.value; commit(); resize(); });
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


syncSettingsUI(); togglePreview(settings.showPreview); togglePerf(settings.perfOverlay);
if (!window.isSecureContext) $('#startStatus').textContent = '提示：请用 https 网址或 localhost 打开，否则无法使用摄像头。';

// 调试 / 自动化测试入口（不含任何影像数据）
window.__mg = { get mode() { return mode; }, get audioState() { return sfx.ctx ? sfx.ctx.state : "none"; }, get audioPrimed() { return !!sfx._primed; }, get settings() { return settings; }, input, tracker, calibration, log, bus, ui, DeviceBridge, enterGame, goMode };
