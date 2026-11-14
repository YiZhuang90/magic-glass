# 帧时间测试：python3 tests/perf.py <url> <label>
# 模拟 David 的屏幕：3072×1920 物理像素，Windows 缩放 200%（CSS 视口 1536×960，deviceScaleFactor=2）
import json, sys, time
from playwright.sync_api import sync_playwright
url, label = sys.argv[1], sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else 'wipe'
render_max = int(sys.argv[4]) if len(sys.argv) > 4 else 0
REC = '''window.__ft=[];(function f(t){if(window.__ftLast)window.__ft.push(t-window.__ftLast);window.__ftLast=t;requestAnimationFrame(f)})(performance.now());'''
def stats(a):
    a = sorted(a[5:]);
    if not a: return {}
    n = len(a); avg = sum(a)/n
    return {'frames': n, 'avg_ms': round(avg, 2), 'p95_ms': round(a[int(n*0.95)-1], 2), 'max_ms': round(a[-1], 2), 'fps': round(1000/avg, 1)}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--disable-gpu-vsync', '--disable-frame-rate-limit'])  # 解除 60Hz 封顶，测真实帧时间
    pg = b.new_page(viewport={'width': 1536, 'height': 960}, device_scale_factor=2)
    if render_max: pg.add_init_script(f"localStorage.setItem('magicGlass.settings.v2', JSON.stringify({{renderMax:{render_max}}}))")
    pg.goto(url); pg.wait_for_timeout(500)
    pg.click('#btnMouse'); pg.wait_for_timeout(1500)
    pg.evaluate(f'__mg.goMode && __mg.goMode("{mode}")'); pg.wait_for_timeout(1200)
    if mode == 'paint': pg.evaluate('__mg.mode.debugLoad("red")'); pg.wait_for_timeout(100)
    info = pg.evaluate('({w: document.querySelector("#stage").width, h: document.querySelector("#stage").height})')
    pg.evaluate(REC); pg.wait_for_timeout(1500)
    idle = stats(pg.evaluate('window.__ft.splice(0)'))
    # 持续擦拭 / 涂抹约 3 秒
    pg.mouse.move(300, 200); pg.mouse.down(); t0 = time.time(); k = 0
    pg.evaluate('window.__ft.splice(0)')
    while time.time() - t0 < 3:
        if mode == 'paint' and k % 4 == 3: pg.evaluate('__mg.mode.debugLoad("yellow")')
        y = 200 + (k % 12) * 50
        pg.mouse.move(1250 if k % 2 == 0 else 300, y, steps=20); k += 1
    pg.mouse.up()
    work = pg.evaluate('window.__perf ? +window.__perf.workMs.toFixed(2) : null')
    active = stats(pg.evaluate('window.__ft.splice(0)'))
    print(json.dumps({'label': label, 'canvas': info, 'idle': idle, 'active': active, 'js_work_ms_last500ms': work}, ensure_ascii=False))
    b.close()
