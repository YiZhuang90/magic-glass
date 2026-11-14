// 输入层 · 摄像头 + MediaPipe HandLandmarker。
// 只在内存中逐帧识别：不录像、不截图、不上传。
const MP_VERSION = '1.2.3';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
// 人脸“位置框”检测（只输出框，不做识别）：孩子离屏幕约 1–2 m，用短距离 BlazeFace（最轻）
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.stream = null;
    this.backend = 'none';
    this.hands = [];          // [{ landmarks: [{x,y,z}] (已镜像), handedness: 'Left'|'Right'（模型原始标签）, score }]
    this.faces = [];          // [{ x, y, w, h, score }] 镜像后的归一化人脸框（只有框，不含图像）
    this.faceSeq = 0;         // 每次人脸结果更新 +1
    this.faceDetector = null; this.faceBackend = 'none'; this.facesOn = false;
    this.faceInterval = 100;  // 人脸检测约 10 fps
    this.lastFaceAt = 0; this.faceFps = 0; this._faceCount = 0;
    this.handMs = 0; this.faceMs = 0; // 每次识别耗时（平滑）
    this._handErr = 0; this._faceErr = 0;
    this.lastVideoTime = -1;
    this.lastResultAt = 0;
    this.detectFps = 0;
    this._fpsCount = 0; this._fpsT = performance.now();
    this.maxHands = 2;
    this.running = false;
    this.detectInterval = 1000 / 30 - 2; // 识别最多约 30 fps
    this.lastDetectAt = 0;
  }

  async listCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'videoinput');
    } catch { return []; }
  }

  async startCamera(deviceId) {
    this.stopCamera();
    // 640×480 足够识别手部，解码和送入模型的开销远小于 720p/1080p
    const video = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = 'user'; // 平板 / 手机：前置摄像头
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器不支持摄像头（需要 https 网址）');
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    const el = this.video;
    // iOS Safari：必须静音 + 行内播放，否则不会自动播放 / 会弹出全屏播放器
    el.muted = true; el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', ''); el.setAttribute('muted', '');
    el.srcObject = this.stream;
    await el.play();
    if (!el.videoWidth) await new Promise(r => { el.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 2000); });
    const track = this.stream.getVideoTracks()[0];
    return track ? track.getSettings().deviceId || '' : '';
  }

  stopCamera() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.hands = []; this.faces = []; this.faceSeq++;
  }

  async initModel(onStatus = () => {}) {
    if (this.landmarker) return this.backend;
    onStatus('正在加载手部识别模型…');
    const vision = this._vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = this._fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const opts = this._handOpts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO', numHands: this.maxHands,
      minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU'));
      this.backend = 'GPU';
    } catch (e) {
      console.warn('GPU 初始化失败，改用 CPU', e);
      onStatus('GPU 不可用，改用 CPU…');
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.backend = 'CPU';
    }
    if (this.facesOn) await this._initFaces().catch(e => console.warn('人脸检测加载失败，退回按手区分', e));
    return this.backend;
  }

  /**
   * GPU 能创建但每帧识别都报错时（部分 iPad / 旧显卡的 WebGL 问题），换成 CPU 重新创建，不让游戏卡死。
   */
  async _fallbackHandCpu() {
    if (this.backend !== 'GPU' || this._handSwitching) return;
    this._handSwitching = true; console.warn('手部识别 GPU 运行出错，改用 CPU');
    const old = this.landmarker; this.landmarker = null;
    try { this.landmarker = await this._vision.HandLandmarker.createFromOptions(this._fileset, this._handOpts('CPU')); this.backend = 'CPU'; try { old?.close?.(); } catch {} }
    catch (e) { console.warn(e); this.landmarker = old; }
    this._handErr = 0; this._handSwitching = false;
  }
  async _fallbackFaceCpu() {
    if (this.faceBackend !== 'GPU' || this._faceSwitching) return;
    this._faceSwitching = true; console.warn('人脸检测 GPU 运行出错，改用 CPU');
    const old = this.faceDetector; this.faceDetector = null;
    try { this.faceDetector = await this._vision.FaceDetector.createFromOptions(this._fileset, this._faceOpts('CPU')); this.faceBackend = 'CPU'; try { old?.close?.(); } catch {} }
    catch (e) { console.warn(e); this.faceDetector = null; this.faceBackend = 'none'; }
    this._faceErr = 0; this._faceSwitching = false;
  }

  /** 打开 / 关闭“区分玩家”用的人脸框检测（关闭时不运行模型） */
  async setFaces(on) {
    this.facesOn = on;
    if (!on) { this.faces = []; this.faceSeq++; return; }
    if (this._vision && !this.faceDetector) await this._initFaces().catch(e => console.warn('人脸检测加载失败', e));
  }

  async _initFaces() {
    if (this.faceDetector || this._faceLoading) return;
    this._faceLoading = true;
    const opts = this._faceOpts = (delegate) => ({ baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 });
    try {
      try { this.faceDetector = await this._vision.FaceDetector.createFromOptions(this._fileset, opts('GPU')); this.faceBackend = 'GPU'; }
      catch (e) { console.warn('人脸检测 GPU 不可用，改用 CPU', e); this.faceDetector = await this._vision.FaceDetector.createFromOptions(this._fileset, opts('CPU')); this.faceBackend = 'CPU'; }
    } finally { this._faceLoading = false; }
  }

  _detectFaces(v) {
    const t0 = performance.now();
    let res;
    try { res = this.faceDetector.detectForVideo(v, t0); this._faceErr = 0; }
    catch (e) { console.warn(e); if (++this._faceErr >= 3) this._fallbackFaceCpu(); return; }
    const vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    this.faces = (res.detections || []).map(d => {
      const b = d.boundingBox; // 像素，未镜像
      return { x: 1 - (b.originX + b.width) / vw, y: b.originY / vh, w: b.width / vw, h: b.height / vh, score: d.categories?.[0]?.score ?? 1 };
    });
    this.faceSeq++; this._faceCount++;
    this.faceMs += ((performance.now() - t0) - this.faceMs) * 0.2;
  }

  async setMaxHands(n) {
    this.maxHands = n;
    if (this.landmarker) try { await this.landmarker.setOptions({ numHands: n }); } catch {}
  }

  /** 每个渲染帧调用；只在有新视频帧、且距上次识别 ≥ detectInterval 时识别（识别与渲染分开节流）。 */
  update(now = performance.now()) {
    const v = this.video;
    if (!this.landmarker || !this.stream || v.readyState < 2) return false;
    // 人脸检测约 10 fps，尽量放在不做手部识别的渲染帧里，分散开销
    const faceDue = this.faceDetector && this.facesOn && now - this.lastFaceAt >= this.faceInterval;
    const handDue = v.currentTime !== this.lastVideoTime && now - this.lastDetectAt >= this.detectInterval;
    if (faceDue && (!handDue || now - this.lastFaceAt > this.faceInterval * 2.5)) { this.lastFaceAt = now; this._detectFaces(v); }
    if (!handDue) return false;
    this.lastDetectAt = now;
    this.lastVideoTime = v.currentTime;
    let res; const t0 = performance.now();
    try { res = this.landmarker.detectForVideo(v, t0); this._handErr = 0; }
    catch (e) { console.warn(e); if (++this._handErr >= 3) this._fallbackHandCpu(); return false; }
    this.handMs += ((performance.now() - t0) - this.handMs) * 0.2;
    const hd = res.handedness || res.handednesses || [];
    const hands = [];
    const lms = res.landmarks || [];
    for (let i = 0; i < lms.length; i++) {
      hands.push({
        landmarks: lms[i].map(p => ({ x: 1 - p.x, y: p.y, z: p.z })), // 镜像
        raw: lms[i],
        handedness: hd[i]?.[0]?.categoryName || null,
        score: hd[i]?.[0]?.score ?? 1,
      });
    }
    this.hands = hands;
    this.videoW = v.videoWidth || 640; this.videoH = v.videoHeight || 480;
    this.lastResultAt = performance.now();
    this._fpsCount++;
    const tnow = performance.now();
    if (tnow - this._fpsT > 1000) {
      const dt = tnow - this._fpsT;
      this.detectFps = this._fpsCount * 1000 / dt; this.faceFps = this._faceCount * 1000 / dt;
      this._fpsCount = 0; this._faceCount = 0; this._fpsT = tnow;
    }
    return true;
  }
}

/** 关键点索引 */
export const PALM_IDS = [0, 5, 9, 13, 17];
export const TIP_IDS = [4, 8, 12, 16, 20];
