# 真模型性能 / 识别测试：用假摄像头（MJPEG 文件）跑 MediaPipe 手 + 人脸。python3 tests/perf_camera.py <url> <mjpeg> [players on/off]
import json, sys
from playwright.sync_api import sync_playwright
url, cam = sys.argv[1], sys.argv[2]
players = (sys.argv[3] if len(sys.argv) > 3 else 'on') == 'on'
REC = '''window.__ft=[];(function f(t){if(window.__ftLast)window.__ft.push(t-window.__ftLast);window.__ftLast=t;requestAnimationFrame(f)})(performance.now());'''
def stats(a):
    a = sorted(a[5:]); n = len(a); avg = sum(a) / n
    return {'frames': n, 'avg_ms': round(avg, 2), 'p95_ms': round(a[int(n * 0.95) - 1], 2), 'max_ms': round(a[-1], 2), 'fps': round(1000 / avg, 1)}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=[
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={cam}',
        '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'])
    ctx = b.new_context(viewport={'width': 1536, 'height': 960}, device_scale_factor=2, permissions=['camera'])
    pg = ctx.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.type + ': ' + m.text[:160]))
    pg.add_init_script(f"localStorage.setItem('magicGlass.settings.v2', JSON.stringify({{players:{str(players).lower()}, rev:4}}))")
    pg.goto(url); pg.wait_for_timeout(500); pg.click('#btnStart', force=True)
    pg.wait_for_function('__mg.tracker.landmarker && (!__mg.settings.players || __mg.tracker.faceDetector)', timeout=120000)
    pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(4000)
    pg.wait_for_timeout(int(sys.argv[4]) if len(sys.argv) > 4 else 0); pg.evaluate(REC); pg.wait_for_timeout(5000)
    ft = stats(pg.evaluate('window.__ft.splice(0)'))
    info = pg.evaluate('''({hand:__mg.tracker.backend, face:__mg.tracker.faceBackend, handMs:+__mg.tracker.handMs.toFixed(1), faceMs:+__mg.tracker.faceMs.toFixed(1),
        handFps:+__mg.tracker.detectFps.toFixed(1), faceFps:+__mg.tracker.faceFps.toFixed(1), work:+(window.__perf?.workMs||0).toFixed(2),
        faces:__mg.tracker.faces.map(f=>[+f.x.toFixed(2),+f.y.toFixed(2),+f.w.toFixed(2),+f.h.toFixed(2)]),
        persons:__mg.input.persons.persons.map(p=>({id:p.id,slot:p.slot})),
        hands:__mg.input.hands.filter(h=>h.source=="hand").map(h=>({slot:h.person&&h.person.slot, handed:h.handed, raw:null, g:h.gesture}))})''')
    pg.keyboard.press('v'); pg.keyboard.press('f'); pg.wait_for_timeout(600)
    pg.screenshot(path=f'/workspace/magic-glass-shots/v4_06_real_models_fakecam_players_{"on" if players else "off"}.png')
    print(json.dumps({'players': players, 'frame': ft, **info, 'warnings': [l for l in logs if 'warn' in l or 'error' in l][:6]}, ensure_ascii=False))
    b.close()
