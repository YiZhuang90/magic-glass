# 无头浏览器端到端测试：python3 tests/e2e.py  （需先在 8765 端口起静态服务器）
import json, math, os, sys, time
from playwright.sync_api import sync_playwright

URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SHOTS = os.environ.get('MG_SHOTS', '/workspace/magic-glass-shots')
os.makedirs(SHOTS, exist_ok=True)
W, H = 1280, 720
CHROME = '/usr/bin/google-chrome'
results = {}

def zigzag(page, x0, x1, y0, y1, rows, steps=25):
    page.mouse.move(x0, y0); page.mouse.down()
    for r in range(rows):
        y = y0 + (y1 - y0) * r / max(1, rows - 1)
        xs = (x0, x1) if r % 2 == 0 else (x1, x0)
        page.mouse.move(xs[0], y, steps=4)
        page.mouse.move(xs[1], y, steps=steps)
        page.wait_for_timeout(16)
    page.mouse.up()

with sync_playwright() as p:
    # ---------- 1. 鼠标模式 ----------
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    errors = []
    pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text))
    pg.goto(URL); pg.wait_for_timeout(600)
    pg.screenshot(path=f'{SHOTS}/00_start.png')
    pg.click('#btnMouse'); pg.wait_for_timeout(1500)
    pg.evaluate('__mg.goMode("wipe")'); pg.mouse.move(640, 795); pg.wait_for_timeout(800)  # v2 起始为首页，直接进擦玻璃
    st = pg.evaluate('__mg.mode.state'); results['state_after_start'] = st
    pg.screenshot(path=f'{SHOTS}/01_fog.png')
    zigzag(pg, 120, 700, 120, 600, 6)
    pg.wait_for_timeout(300)
    r_half = pg.evaluate('__mg.mode.cover.clearedRatio(true)'); results['ratio_half'] = round(r_half, 3)
    pg.screenshot(path=f'{SHOTS}/02_half_wiped.png')
    zigzag(pg, 60, 1220, 130, 680, 12)
    t0 = time.time(); state = ''
    while time.time() - t0 < 5:
        state = pg.evaluate('__mg.mode.state')
        if state == 'reveal': break
        pg.wait_for_timeout(50)
    results['state_after_full_wipe'] = state
    pg.wait_for_timeout(900)
    pg.screenshot(path=f'{SHOTS}/03_celebrate.png')
    results['cards_completed'] = pg.evaluate('__mg.log.summary().cardsCompleted')
    # 等待自动进入下一张
    t0 = time.time(); nxt = ''
    while time.time() - t0 < 12:
        nxt = pg.evaluate('__mg.mode.state + ":" + __mg.mode.card.id')
        if nxt.startswith('play') or nxt.startswith('intro'): break
        pg.wait_for_timeout(200)
    results['next_card'] = nxt
    # 泥巴：通过家长设置切换（按 P 打开）
    pg.keyboard.press('p'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{SHOTS}/06_settings.png')
    pg.click('#coverSeg button[data-cover=mud]'); pg.keyboard.press('p'); pg.wait_for_timeout(1200)
    pg.screenshot(path=f'{SHOTS}/04_mud.png')
    zigzag(pg, 100, 1180, 150, 600, 6)
    pg.wait_for_timeout(200)
    results['mud_ratio_one_pass'] = round(pg.evaluate('__mg.mode.cover.clearedRatio(true)'), 3)
    pg.screenshot(path=f'{SHOTS}/05_mud_partial.png')
    zigzag(pg, 100, 1180, 150, 600, 6); zigzag(pg, 100, 1180, 195, 645, 6)
    pg.wait_for_timeout(200)
    results['mud_ratio_three_passes'] = round(pg.evaluate('__mg.mode.cover.clearedRatio(true)'), 3)
    # 测量帧率
    fps = pg.evaluate('''new Promise(r=>{let n=0;const t=performance.now();function f(){n++; if(performance.now()-t<2000) requestAnimationFrame(f); else r(n/2)} requestAnimationFrame(f)})''')
    results['headless_fps'] = round(fps, 1)
    results['mouse_mode_errors'] = errors[:]
    b.close()

    # ---------- 2. 假摄像头 + MediaPipe 初始化 ----------
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=[
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': W, 'height': H})
    errors2 = []
    pg.on('pageerror', lambda e: errors2.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type in ('error', 'warning') and errors2.append(m.type + ': ' + m.text[:200]))
    pg.goto(URL); pg.wait_for_timeout(500)
    pg.click('#btnStart', force=True)
    t0 = time.time(); backend = 'none'
    while time.time() - t0 < 90:
        backend = pg.evaluate('__mg.tracker.backend')
        if backend != 'none': break
        pg.wait_for_timeout(500)
    results['mediapipe_backend'] = backend
    results['mediapipe_init_seconds'] = round(time.time() - t0, 1)
    pg.wait_for_timeout(3000)
    results['detect_fps_fake_cam'] = round(pg.evaluate('__mg.tracker.detectFps'), 1)
    results['camera_stream'] = pg.evaluate('!!__mg.tracker.stream')
    results['fake_cam_messages'] = errors2[:15]
    pg.keyboard.press('v'); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{SHOTS}/07_fakecam_preview.png')
    b.close()

print(json.dumps(results, ensure_ascii=False, indent=2))
