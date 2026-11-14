# v3 画画端到端测试：握拳只选色、只伸食指才画、张开/握拳不画、颜色保持、橡皮擦。python3 tests/e2e_v3.py
import json, os
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
W, H = 1280, 800
R = {}

# 在页面里装一个“假摄像头手”：spec = [{g, X, Y}]，X/Y 是掌心要出现的位置（内部画布像素）
SETUP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_hands.js')).read()

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': W, 'height': H}, accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append('console: ' + m.text))
    pg.goto(URL); pg.wait_for_timeout(400)
    pg.click('#btnMouse'); pg.wait_for_timeout(600)
    pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(600)
    pg.mouse.move(640, 799)
    pg.evaluate(SETUP); pg.evaluate('__mg.tracker.facesOn=false')  # v3 测试：不区分玩家（按手区分）
    tiles = pg.evaluate('__mg.mode.tiles.map(p=>({id:p.id, x:p.x+p.w/2, y:p.y+p.h*0.5}))')
    T = {t['id']: t for t in tiles}
    rect = pg.evaluate('__mg.mode.rect')
    def setp(spec): pg.evaluate('s => { window.__spec = s }', spec)
    def amt(): return round(pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)'), 1)
    def brush(): return pg.evaluate('(()=>{const h=__mg.input.hands.find(h=>h.source=="hand"); const b=h&&__mg.mode.brushOf(h); return b && {tool:b.tool, rgb:b.rgb, hand:h.style.name}})()')
    def gesture(): return pg.evaluate('(__mg.input.hands.find(h=>h.source=="hand")||{}).gesture')
    def sweep(g, x0, x1, y, n=24, ms=40, shot=None):
        for i in range(n):
            setp([{'g': g, 'X': x0 + (x1 - x0) * i / (n - 1), 'Y': y}]); pg.wait_for_timeout(ms)
            if shot and i == n * 2 // 3: pg.screenshot(path=f'{SH}/{shot}')
    def hold(g, X, Y, ms, shot=None, shot_at=None):
        setp([{'g': g, 'X': X, 'Y': Y}]); t = 0
        while t < ms:
            pg.wait_for_timeout(100); t += 100
            if shot and shot_at and t == shot_at: pg.screenshot(path=f'{SH}/{shot}')
    cy = rect['y'] + rect['h'] * 0.35; xl, xr = rect['x'] + rect['w'] * 0.15, rect['x'] + rect['w'] * 0.75
    # 0. 没选颜色时：伸食指也不画
    sweep('point', xl, xr, cy, n=10)
    R['0_no_color_point_paints'] = amt()
    pg.screenshot(path=f'{SH}/v3_01_paint_start.png')
    # 1. 握拳在红色上 1 秒以上 = 选中红色（不画）
    hold('fist', T['red']['x'], T['red']['y'], 1500, shot='v3_02_fist_grab_red.png', shot_at=600)
    R['1_after_grab'] = brush(); R['1_gesture'] = gesture()
    # 2. 张开手划过画纸：不画
    hold('open', xl, cy, 300); sweep('open', xl, xr, cy)
    R['2_open_palm_paint_amount'] = amt()
    pg.screenshot(path=f'{SH}/v3_03_open_palm_no_paint.png')
    # 3. 握拳划过画纸：不画
    sweep('fist', xr, xl, cy + 60)
    R['3_fist_paint_amount'] = amt()
    # 4. 只伸食指：画
    hold('point', xl, cy + 40, 300)
    sweep('point', xl, xr, cy + 40, shot='v3_04_index_painting.png')
    sweep('point', xr, xl, cy + 90)
    R['4_point_paint_amount'] = amt(); R['4_brush'] = brush(); R['4_gesture'] = gesture()
    # 5. 识别丢失 3 秒后回来（张开手）：仍是红色
    setp([]); pg.wait_for_timeout(3000)
    hold('open', xl, cy, 400)
    R['5_after_lost_brush'] = brush()
    # 6. 选黄色，在红色上画 → 混出橙色
    hold('fist', T['yellow']['x'], T['yellow']['y'], 1500)
    R['6_brush'] = brush()
    hold('point', xl, cy + 40, 300)
    for k in range(3):
        sweep('point', xl, xr, cy + 55 + k * 12, n=20); sweep('point', xr, xl, cy + 60 + k * 12, n=20)
    R['6_discovered'] = pg.evaluate('__mg.mode.discovered.map(d=>d.id)')
    # 蓝色画一块，用于擦除
    hold('fist', T['blue']['x'], T['blue']['y'], 1500)
    hold('point', xl, cy + 200, 300)
    for k in range(3): sweep('point', xl, xr, cy + 190 + k * 25, n=18)
    pg.screenshot(path=f'{SH}/v3_05_mixed.png')
    # 7. 握拳选橡皮擦
    hold('fist', T['eraser']['x'], T['eraser']['y'], 1500, shot='v3_06_fist_grab_eraser.png', shot_at=700)
    R['7_brush'] = brush(); R['7_discovered_after_eraser'] = pg.evaluate('__mg.mode.discovered.map(d=>d.id)')
    a0 = amt()
    hold('open', xl, cy + 210, 300)
    pg.screenshot(path=f'{SH}/v3_07_eraser_hover_open.png')
    R['7_open_with_eraser_removed'] = round(a0 - amt(), 1)
    hold('point', xl, cy + 210, 300)
    sweep('point', xl, xr, cy + 210, n=24, shot='v3_08_erasing.png')
    a1 = amt(); R['7_erased_fraction'] = round((a0 - a1) / a0, 3)
    R['7_erased_center_sample'] = pg.evaluate(f'__mg.mode.canvas.sample({(xl + xr) / 2}, {cy + 210})')
    # 8. 再抓颜色 → 回到画笔
    hold('fist', T['blue']['x'], T['blue']['y'], 1500)
    R['8_brush'] = brush()
    # 9. 鼠标：在罐上按住选色、按住拖动画画仍然可用
    setp([]); pg.wait_for_timeout(500)
    k = pg.evaluate('document.querySelector("#stage").width/innerWidth')
    pg.mouse.move(T['white']['x'] / k, T['white']['y'] / k); pg.mouse.down(); pg.wait_for_timeout(800); pg.mouse.up()
    m0 = amt()
    pg.mouse.move(xl / k, (cy + 320) / k); pg.mouse.down(); pg.mouse.move(xr / k, (cy + 320) / k, steps=25); pg.mouse.up()
    R['9_mouse'] = {'tool': pg.evaluate('(__mg.mode.brushOf(__mg.input.hands.find(h=>h.source!="hand"))||{}).tool'), 'painted': round(amt() - m0, 1)}
    R['errors'] = errs
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1))
