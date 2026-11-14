// 识别线程（Web Worker）：MediaPipe 手部 + 人脸框识别放在这里跑，主线程的渲染永远不会被识别卡住。
// 只接收内存中的视频帧（ImageBitmap），识别完立即释放：不录像、不截图、不上传。
// 经典 Worker + vision_bundle.js（IIFE）：importScripts 在经典 Worker 里可用，MediaPipe 的 wasm 加载器也能正常加载。
/* eslint-disable no-restricted-globals */
let vision = null, fileset = null, hand = null, face = null;
let handBackend = 'none', faceBackend = 'none', handErr = 0, faceErr = 0, cfg = null, lastTs = 0;
// GPU 慢于 CPU 时自动换（例如 Chrome 跑在没有硬件加速的虚拟显卡 / SwiftShader 上）：
// GPU 先跑 15 帧，平均 > 45 ms 就试 CPU 15 帧，留下更快的那个。
const bench = { phase: 'gpu', n: 0, sum: 0, gpuAvg: 0, switching: false };

function handOpts(delegate) {
  return { baseOptions: { modelAssetPath: cfg.handModel, delegate }, runningMode: 'VIDEO', numHands: cfg.maxHands,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
}
function faceOpts(delegate) { return { baseOptions: { modelAssetPath: cfg.faceModel, delegate }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 }; }

async function create(Task, opts, wantGpu) {
  if (wantGpu) {
    try { return [await Task.createFromOptions(fileset, opts('GPU')), 'GPU']; }
    catch (e) { console.warn('[识别线程] GPU 不可用，改用 CPU', e && e.message); }
  }
  return [await Task.createFromOptions(fileset, opts('CPU')), 'CPU'];
}

async function initFaces() {
  if (face || !vision) return;
  [face, faceBackend] = await create(vision.FaceDetector, faceOpts, cfg.gpu);
}

async function benchStep(ms) {
  if (bench.phase === 'done' || bench.switching) return;
  if (bench.phase === 'gpu' && handBackend !== 'GPU') { bench.phase = 'done'; return; }
  if (++bench.n <= 3) return; // 前几帧有预热开销，不算
  bench.sum += ms;
  if (bench.n < 18 && !(bench.phase === 'gpu' && bench.n >= 8 && bench.sum / (bench.n - 3) > 150)) return; // 明显很慢就提前换
  const avg = bench.sum / (bench.n - 3); bench.n = 0; bench.sum = 0;
  if (bench.phase === 'gpu') {
    if (avg <= 45) { bench.phase = 'done'; return; }
    bench.gpuAvg = avg; bench.phase = 'cpu'; bench.switching = true;
    const old = hand; try { [hand, handBackend] = await create(vision.HandLandmarker, handOpts, false); old.close(); } catch (e) { hand = old; bench.phase = 'done'; }
    bench.switching = false;
    console.warn(`[识别线程] GPU 平均 ${avg.toFixed(0)} ms，试试 CPU`);
  } else if (bench.phase === 'cpu') {
    bench.phase = 'done';
    console.warn(`[识别线程] CPU 平均 ${avg.toFixed(0)} ms（GPU ${bench.gpuAvg.toFixed(0)} ms）`);
    if (avg > bench.gpuAvg) { bench.switching = true; const old = hand; try { [hand, handBackend] = await create(vision.HandLandmarker, handOpts, true); old.close(); } catch (e) { hand = old; } bench.switching = false; }
    else self.postMessage({ type: 'note', text: `GPU 太慢（${bench.gpuAvg.toFixed(0)} ms），已改用 CPU（${avg.toFixed(0)} ms）` });
  }
}

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      cfg = m;
      // MediaPipe（包括 CPU 模式）在 Worker 里需要 OffscreenCanvas 的 WebGL2；没有就让主线程接手（旧 Safari 等）
      let gl = null; try { gl = typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(4, 4).getContext('webgl2'); } catch {}
      if (!gl) throw new Error('Worker 里没有 OffscreenCanvas WebGL2');
      importScripts(`${m.base}/vision_bundle.js`); // IIFE 版本，定义全局 Vision
      vision = self.Vision;
      fileset = await vision.FilesetResolver.forVisionTasks(`${m.base}/wasm`);
      [hand, handBackend] = await create(vision.HandLandmarker, handOpts, m.gpu);
      if (m.faces) await initFaces().catch(e => console.warn('[识别线程] 人脸检测加载失败', e));
      self.postMessage({ type: 'ready', handBackend, faceBackend });
    } else if (m.type === 'faces') {
      cfg.faces = m.on;
      if (m.on) await initFaces().catch(e => console.warn(e));
      self.postMessage({ type: 'status', handBackend, faceBackend });
    } else if (m.type === 'maxHands') {
      cfg.maxHands = m.n; if (hand) await hand.setOptions({ numHands: m.n });
    } else if (m.type === 'frame') {
      const bmp = m.bitmap; let ts = m.ts; if (ts <= lastTs) ts = lastTs + 1; lastTs = ts;
      const out = { type: 'result', id: m.id, hands: null, faces: null, handMs: 0, faceMs: 0, w: bmp.width, h: bmp.height };
      try {
        if (m.doFace && face && cfg.faces) {
          const t0 = performance.now();
          try {
            const r = face.detectForVideo(bmp, ts); faceErr = 0;
            out.faces = (r.detections || []).map(d => { const b = d.boundingBox; return [b.originX, b.originY, b.width, b.height, d.categories && d.categories[0] ? d.categories[0].score : 1]; });
          } catch (e) {
            console.warn(e); if (++faceErr >= 3 && faceBackend === 'GPU') { try { face.close(); } catch {} face = null; faceErr = 0; [face, faceBackend] = await create(vision.FaceDetector, faceOpts, false); }
          }
          out.faceMs = performance.now() - t0;
        }
        if (hand) {
          const t0 = performance.now();
          try {
            const r = hand.detectForVideo(bmp, ts); handErr = 0;
            const hd = r.handedness || r.handednesses || [];
            out.hands = (r.landmarks || []).map((lm, i) => ({ lm: lm.map(p => [p.x, p.y, p.z]), handedness: hd[i] && hd[i][0] ? hd[i][0].categoryName : null, score: hd[i] && hd[i][0] ? hd[i][0].score : 1 }));
          } catch (e) {
            console.warn(e); if (++handErr >= 3 && handBackend === 'GPU') { try { hand.close(); } catch {} hand = null; handErr = 0; [hand, handBackend] = await create(vision.HandLandmarker, handOpts, false); }
          }
          out.handMs = performance.now() - t0;
          if (out.hands) await benchStep(out.handMs);
        }
      } finally { bmp.close && bmp.close(); }
      out.handBackend = handBackend; out.faceBackend = faceBackend;
      self.postMessage(out);
    }
  } catch (e) {
    self.postMessage({ type: 'error', stage: m.type, message: String(e && (e.message || e)) });
  }
};
