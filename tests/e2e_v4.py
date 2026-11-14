# v4 端到端：两个人各自左右手记住不同颜色；安全区（手在摄像头画面边上也能到屏幕边）。python3 tests/e2e_v4.py
import json, os
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
SETUP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_hands.js')).read()
R = {}; fails = []
def check(name, cond, val=None):
    R[name] = val if val is not None else bool(cond)
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto(URL); pg.wait_for_timeout(400); pg.click('#btnMouse'); pg.wait_for_timeout(500)
    pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(500)
    pg.evaluate(SETUP)
    W, H = pg.evaluate('[document.querySelector("#stage").width, document.querySelector("#stage").height]')
    tiles = {t['id']: t for t in pg.evaluate('__mg.mode.tiles.map(p=>({id:p.id, X:p.x+p.w/2, Y:p.y+p.h*0.5}))')}
    s2c = lambda X, Y: pg.evaluate(f'__mg.input.screenToCam({X / W}, {Y / H})')
    setf = lambda f: pg.evaluate('f => { window.__faces = f }', f)
    seth = lambda s: pg.evaluate('s => { window.__spec = s }', s)
    hands_info = lambda: pg.evaluate('''__mg.input.hands.filter(h=>h.source=="hand").map(h=>{const b=__mg.mode.brushOf(h);
        return {slot:h.person&&h.person.slot, handed:h.handed, g:h.gesture, tool:b&&b.tool, rgb:b&&b.rgb, palm:h.palm.map(Math.round), tip:h.pts[8].map(Math.round)}})''')
    # —— 1. 两个人，各两只手 ——
    FACES = [{'cx': 0.35, 'cy': 0.28, 'h': 0.14}, {'cx': 0.65, 'cy': 0.28, 'h': 0.14}]
    IDLE = {'AL': (0.25, 0.56, 'left'), 'AR': (0.45, 0.58, 'right'), 'BL': (0.55, 0.58, 'left'), 'BR': (0.75, 0.56, 'right')}
    pos = {k: [v[0], v[1]] for k, v in IDLE.items()}; pose = {k: 'open' for k in IDLE}
    def push(): seth([{'g': pose[k], 'cx': pos[k][0], 'cy': pos[k][1], 'hand': IDLE[k][2]} for k in IDLE])
    def glide(k, to, steps=14, ms=40, g=None):
        x0, y0 = pos[k]
        for i in range(1, steps + 1):
            pos[k] = [x0 + (to[0] - x0) * i / steps, y0 + (to[1] - y0) * i / steps]
            if g: pose[k] = g
            push(); pg.wait_for_timeout(ms)
    setf(FACES); push(); pg.wait_for_timeout(800)
    info = hands_info()
    check('1_four_hands_two_players', sorted((h['slot'], h['handed']) for h in info) == [(1, 'left'), (1, 'right'), (2, 'left'), (2, 'right')], [(h['slot'], h['handed']) for h in info])
    pg.screenshot(path=f'{SH}/v4_01_two_players_badges.png')
    PLAN = [('AL', 'red'), ('AR', 'yellow'), ('BL', 'white'), ('BR', 'black')]
    for k, tid in PLAN:
        t = s2c(tiles[tid]['X'], tiles[tid]['Y'])
        glide(k, t); pose[k] = 'fist'; push(); pg.wait_for_timeout(1500)
        if k == 'AR': pg.screenshot(path=f'{SH}/v4_02_player1_right_grabs_yellow.png')
        pose[k] = 'open'; push(); pg.wait_for_timeout(150); glide(k, IDLE[k][:2])
    key = lambda h: f"{h['slot']}{h['handed'][0].upper()}"
    got = {key(h): (h['tool'], tuple(h['rgb'])) for h in hands_info()}
    EXP = {'1L': [230, 30, 35], '1R': [254, 220, 0], '2L': [255, 255, 255], '2R': [20, 20, 24]}
    check('2_each_hand_own_colour', all(got.get(k) == ('paint', tuple(v)) for k, v in EXP.items()), {k: v[1] for k, v in got.items()})
    # 每只手只伸食指画一笔，检查画在纸上的颜色
    BANDS = {'AL': (0.28, 0.42, 0.42), 'AR': (0.30, 0.44, 0.62), 'BL': (0.56, 0.70, 0.42), 'BR': (0.58, 0.72, 0.62)}
    samples = {}
    for k, (x0, x1, y) in BANDS.items():
        glide(k, (x0, y)); pose[k] = 'point'; push(); pg.wait_for_timeout(250)
        glide(k, (x1, y), steps=16)
        mid = [h for h in hands_info() if key(h) == {'AL': '1L', 'AR': '1R', 'BL': '2L', 'BR': '2R'}[k]][0]['tip']
        glide(k, ((x0 + x1) / 2, y), steps=6)
        tip = [h for h in hands_info() if key(h) == {'AL': '1L', 'AR': '1R', 'BL': '2L', 'BR': '2R'}[k]][0]['tip']
        samples[k] = pg.evaluate(f'(()=>{{const s=__mg.mode.canvas.sample({tip[0]},{tip[1]}); return s&&s.rgb}})()')
        pose[k] = 'open'; push(); pg.wait_for_timeout(150); glide(k, IDLE[k][:2])
    near = lambda a, b2: a is not None and max(abs(a[i] - b2[i]) for i in range(3)) < 40
    check('3_strokes_in_own_colours', near(samples['AL'], EXP['1L']) and near(samples['AR'], EXP['1R']) and near(samples['BL'], EXP['2L']) and near(samples['BR'], EXP['2R']), samples)
    pg.screenshot(path=f'{SH}/v4_03_two_players_painted.png')
    # —— 2. 所有手离开画面 1.2 秒，再以相反顺序回来：每个人的左右手都拿回自己的颜色 ——
    seth([]); pg.wait_for_timeout(1200)
    seth([{'g': 'open', 'cx': IDLE[k][0], 'cy': IDLE[k][1], 'hand': IDLE[k][2]} for k in reversed(list(IDLE))]); pg.wait_for_timeout(600)
    got = {key(h): tuple(h['rgb']) for h in hands_info() if h['tool']}
    check('4_colours_restored_after_hands_return', all(got.get(k) == tuple(v) for k, v in EXP.items()), got)
    # —— 3. 人脸短暂丢失（0.8 秒，宽限期内）：手上颜色不变 ——
    setf([]); pg.wait_for_timeout(800)
    got2 = {h['palm'][0] // 50: tuple(h['rgb']) for h in hands_info()}
    check('5_face_lost_briefly_colours_kept', sorted(got2.values()) == sorted(tuple(v) for v in EXP.values()), list(got2.values()))
    setf(FACES); pg.wait_for_timeout(500)
    # —— 4. 关闭“区分玩家”：不再有玩家标记 ——
    pg.evaluate('__mg.settings.players=false'); pg.wait_for_timeout(400)
    check('6_players_off_no_badges', all(h['slot'] is None for h in hands_info()))
    pg.evaluate('__mg.settings.players=true'); pg.wait_for_timeout(400)
    # 预览（只画框，不含图像）
    pg.keyboard.press('v'); pg.wait_for_timeout(400)
    pg.screenshot(path=f'{SH}/v4_04_preview_safe_zone_faces.png')
    pg.keyboard.press('v')
    # —— 5. 安全区：手在摄像头画面边上 → 屏幕边上 ——
    setf([]); seth([]); pg.wait_for_timeout(600)
    r = pg.evaluate('(()=>{const s=__mg.settings; return {m:s.safeMargin, b:s.safeBottomExtra}})()')
    def palm_at(cx, cy, g='open'):
        seth([{'g': g, 'cx': cx, 'cy': cy}]); pg.wait_for_timeout(400)
        return pg.evaluate('(__mg.input.hands.find(h=>h.source=="hand")||{}).palm')
    p_edge = palm_at(r['m'], 0.45); p_out = palm_at(0.03, 0.45); p_right = palm_at(1 - r['m'], 0.45); p_top = palm_at(0.5, r['m'] - 0.08); p_bot = palm_at(0.5, 0.97)
    check('7_safe_edge_maps_to_screen_edge', p_edge[0] <= W * 0.01 and p_out[0] < 0.5 and p_right[0] >= W * 0.99 and p_top[1] < 0.5 and p_bot[1] > H - 0.5,
          {'edge': p_edge, 'outside': p_out, 'right': p_right, 'top': p_top, 'bottom': p_bot, 'W': W, 'H': H})
    # 手在安全区边上（屏幕最左边）握拳：抓到红色
    seth([]); pg.wait_for_timeout(500)
    red_cy = s2c(0, tiles['red']['Y'])[1]
    for i in range(6): seth([{'g': 'open', 'cx': 0.30 - i * 0.04, 'cy': red_cy}]); pg.wait_for_timeout(60)
    seth([{'g': 'fist', 'cx': 0.06, 'cy': red_cy}]); pg.wait_for_timeout(1600)
    h = hands_info()[0]
    check('8_grab_edge_tile_from_camera_edge', h['tool'] == 'paint' and h['rgb'] == [230, 30, 35], h)
    # 手在左上角（摄像头画面外侧）停住：触发“首页”按钮
    for i in range(6): seth([{'g': 'open', 'cx': 0.06, 'cy': red_cy - i * (red_cy - 0.04) / 5}]); pg.wait_for_timeout(60)
    pg.wait_for_timeout(200); pg.screenshot(path=f'{SH}/v4_05_corner_reaches_home_button.png')
    pg.wait_for_timeout(2000)
    check('9_corner_hover_home_button', pg.evaluate('__mg.mode.name') == 'home', pg.evaluate('__mg.mode.name'))
    check('errors', not errs, errs)
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1))
print('FAILED: ' + ', '.join(fails) if fails else 'v4 e2e passed')
raise SystemExit(1 if fails else 0)
