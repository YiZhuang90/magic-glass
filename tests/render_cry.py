# 把 sfx.cry() 离线渲染成 wav（试听 / 查看音量）：python3 tests/render_cry.py <输出.wav> [网址] [模块路径]
# 用 OfflineAudioContext 跑真正的 js/audio/sfx.js；所有变体依次拼在一起，中间隔 0.4 秒。
import sys, json, struct, wave, math
from playwright.sync_api import sync_playwright
out = sys.argv[1]; url = sys.argv[2] if len(sys.argv) > 2 else 'http://localhost:8765/index.html'
mod = sys.argv[3] if len(sys.argv) > 3 else './js/audio/sfx.js'
JS = '''async (mod) => {
  const { Sfx } = await import(mod);
  const probe = new Sfx(); const nVar = probe.cryVariants || 1;
  const SR = 44100, seg = 1.4, oc = new OfflineAudioContext(1, Math.ceil(SR * seg * nVar), SR);
  const s = new Sfx(); s.ctx = oc; s.master = oc.createGain(); s.master.gain.value = 0.8; s.master.connect(oc.destination);  // 0.8 = 默认音量
  // 离线上下文：用 suspend 在每段开头调用 cry(v)
  const calls = [];
  for (let v = 0; v < nVar; v++) calls.push(oc.suspend(v * seg + 0.001).then(() => { s.cry(v); oc.resume(); }));
  oc.resume?.();
  const buf = await oc.startRendering();
  const d = buf.getChannelData(0); let peak = 0, sum = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; }
  return { n: nVar, peak, rms: Math.sqrt(sum / d.length), data: Array.from(d) };
}'''
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True)
    pg = b.new_page(); pg.goto(url); r = pg.evaluate(JS, mod); b.close()
w = wave.open(out, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(x * 32767)))) for x in r['data'])); w.close()
db = lambda x: round(20 * math.log10(max(x, 1e-9)), 1)
print(json.dumps({'variants': r['n'], 'peak': round(r['peak'], 3), 'peak_dBFS': db(r['peak']), 'rms_dBFS': db(r['rms']), 'sec': round(len(r['data']) / 44100, 2)}))
