# 看到真手时隐藏鼠标的虚拟手，鼠标真的移动后再出现（首页 / 擦玻璃 / 画画）：python3 tests/e2e_mouse_hide.py
import json, os, re
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
SETUP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_hands.js')).read()
R = {}; fails = []
def check(name, cond, val=None):
    R[name] = val if val is not None else cond
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL); pg.wait_for_timeout(400); pg.click('#btnMouse'); pg.wait_for_timeout(600)
    pg.evaluate(SETUP)
    k = pg.evaluate('document.querySelector("#stage").width/innerWidth')
    mouse_visible = lambda: pg.evaluate('__mg.input.hands.some(h=>h.source=="mouse")')
    real = lambda on, X=1100, Y=650: pg.evaluate('s => { window.__spec = s }', [{'g': 'open', 'X': X * k, 'Y': Y * k}] if on else [])
    # —— 首页 ——
    pg.mouse.move(300, 300); pg.mouse.move(320, 310, steps=4); pg.wait_for_timeout(300)
    check('home_1_mouse_visible_before', mouse_visible())
    pg.screenshot(path=f'{SH}/v3_09_mouse_hand_visible.png')
    real(True); pg.wait_for_timeout(1200)
    check('home_2_hidden_after_hand_detected', not mouse_visible())
    pg.screenshot(path=f'{SH}/v3_10_mouse_hand_hidden_real_hand.png')
    pg.evaluate('(()=>{const s=document.querySelector("#stage"); s.dispatchEvent(new PointerEvent("pointermove",{pointerId:1,pointerType:"mouse",clientX:700,clientY:500,bubbles:true}))})()')
    pg.wait_for_timeout(200); check('home_3_synthetic_event_stays_hidden', not mouse_visible())
    pg.mouse.move(321, 311); pg.wait_for_timeout(200); check('home_4_jitter_1px_stays_hidden', not mouse_visible())
    pg.mouse.move(380, 340, steps=5); pg.wait_for_timeout(150)
    check('home_5_visible_after_real_move', mouse_visible())
    pg.screenshot(path=f'{SH}/v3_11_mouse_hand_back_after_move.png')
    pg.wait_for_timeout(1200); check('home_6_rehidden_when_idle_with_hand', not mouse_visible())
    # —— 擦玻璃：隐藏的鼠标停在“首页”按钮上不会触发 ——
    real(False); pg.wait_for_timeout(400)
    pg.evaluate('__mg.goMode("wipe")'); pg.wait_for_timeout(500)
    hb = pg.evaluate(f'(()=>{{const b=__mg.ui.get("home"); return [(b.x+b.w/2)/{k},(b.y+b.h/2)/{k}]}})()')
    real(True); pg.mouse.move(hb[0], hb[1], steps=5); pg.wait_for_timeout(3500)
    check('wipe_1_hidden_mouse_does_not_hover_activate', pg.evaluate('__mg.mode.name') == 'wipe' and not mouse_visible(), pg.evaluate('__mg.mode.name'))
    c0 = pg.evaluate('__mg.mode.cover.clearedRatio(true)')
    pg.mouse.move(400, 400); pg.mouse.down(); pg.mouse.move(800, 420, steps=10); pg.wait_for_timeout(1300)  # 按住不动 → 隐藏
    c1 = pg.evaluate('__mg.mode.cover.clearedRatio(true)'); pg.wait_for_timeout(500)
    c2 = pg.evaluate('__mg.mode.cover.clearedRatio(true)'); pg.mouse.up()
    check('wipe_2_mouse_wiped_while_moving', c1 > c0, [round(c0, 3), round(c1, 3)])
    check('wipe_3_hidden_while_held_stops_wiping', not mouse_visible() and abs(c2 - c1) < 0.002, [round(c1, 4), round(c2, 4)])
    # —— 画画：鼠标按住涂抹，看到真手后停止 ——
    real(False); pg.wait_for_timeout(400)
    pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(500)
    red = pg.evaluate(f'(()=>{{const p=__mg.mode.pots.find(p=>p.id=="red"); return [(p.x+p.w/2)/{k},(p.y+p.h/2)/{k}]}})()')
    pg.mouse.move(red[0] + 5, red[1], steps=3); pg.mouse.down(); pg.wait_for_timeout(800); pg.mouse.up()
    amt = lambda: pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)')
    real(True)
    pg.mouse.move(400, 300, steps=5); pg.mouse.down(); pg.mouse.move(700, 320, steps=10)
    a1 = amt(); pg.wait_for_timeout(1300); a2 = amt(); pg.wait_for_timeout(600); a3 = amt()
    check('paint_1_mouse_painted', a1 > 0, round(a1, 1))
    check('paint_2_hidden_while_held_stops_painting', not mouse_visible() and abs(a3 - a2) < 1e-6, [round(a2, 1), round(a3, 1)])
    pg.mouse.move(705, 330, steps=3); pg.mouse.move(720, 360, steps=5); b4 = amt(); pg.mouse.move(800, 360, steps=8); b5 = amt(); pg.mouse.up()
    check('paint_3_move_restores_mouse_painting', mouse_visible() and b5 > b4, [round(b4, 1), round(b5, 1)])
    check('errors', not errs, errs)
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1))
print('FAILED: ' + ', '.join(fails) if fails else 'mouse-hide e2e passed')
raise SystemExit(1 if fails else 0)
