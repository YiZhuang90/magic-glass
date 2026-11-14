# v2 端到端测试（鼠标模式 + 模拟手部关键点）：python3 tests/e2e_v2.py
import json, os, time
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'
os.makedirs(SH, exist_ok=True)
R = {}
W, H = 1280, 800

def drag(pg, pts, steps=18):
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for p in pts[1:]: pg.mouse.move(*p, steps=steps)
    pg.mouse.up()

def zig(x0, x1, y0, y1, rows):
    out = []
    for r in range(rows):
        y = y0 + (y1 - y0) * r / max(1, rows - 1)
        out += [(x0, y), (x1, y)] if r % 2 == 0 else [(x1, y), (x0, y)]
    return out

# 用模板生成“真实手”的 21 个关键点（归一化、未镜像），注入识别结果，检验虚拟手渲染与手势识别
FAKE_HANDS = '''(spec) => {
  const OPEN=[[0,.55],[-.28,.42],[-.5,.22],[-.64,.02],[-.76,-.16],[-.3,-.35],[-.36,-.72],[-.39,-.95],[-.41,-1.15],[-.02,-.42],[-.02,-.84],[-.02,-1.1],[-.02,-1.32],[.24,-.36],[.28,-.74],[.3,-.97],[.32,-1.15],[.45,-.25],[.54,-.52],[.6,-.7],[.64,-.86]];
  const FIST=[[0,.55],[-.28,.42],[-.46,.16],[-.4,-.06],[-.2,-.12],[-.3,-.35],[-.34,-.55],[-.3,-.32],[-.28,-.2],[-.02,-.42],[-.03,-.62],[-.02,-.37],[-.02,-.24],[.24,-.36],[.25,-.55],[.24,-.32],[.22,-.2],[.45,-.25],[.48,-.4],[.44,-.24],[.4,-.14]];
  const POINT=OPEN.map((p,i)=>([5,6,7,8].includes(i)||i<5)?p:FIST[i]);
  const T={open:OPEN,fist:FIST,point:POINT};
  const tr=__mg.tracker; tr.landmarker={setOptions(){}}; tr.stream={}; tr.backend='模拟';
  tr.update=()=>{ tr.videoW=640; tr.videoH=480; tr.hands = spec.map(s=>({landmarks:T[s.g].map(([x,y])=>({x:s.x+x*s.size/1.333*-1*-1, y:s.y+y*s.size, z:0}))})); return true; };
}'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': W, 'height': H}, accept_downloads=True)
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append('console: ' + m.text))
    pg.goto(URL); pg.wait_for_timeout(400)
    pg.click('#btnMouse'); pg.wait_for_timeout(800)
    # 1. 首页：鼠标悬停在“擦玻璃”上
    pg.mouse.move(330, 420); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{SH}/v2_01_home.png')
    pg.wait_for_timeout(900)
    R['hover_select'] = pg.evaluate('__mg.mode.name')
    pg.wait_for_timeout(1200)
    # 2. 擦玻璃：鼠标按下 = 握拳的虚拟手
    pts = zig(150, 800, 200, 650, 6)
    pg.mouse.move(*pts[0]); pg.mouse.down()
    for q in pts[1:]: pg.mouse.move(*q, steps=16)
    pg.screenshot(path=f'{SH}/v2_02_wipe_mouse_hand.png')
    pg.mouse.up()
    R['wipe_ratio_after_drag'] = round(pg.evaluate('__mg.mode.cover.clearedRatio(true)'), 3)
    # 3. 模拟两只真实的手（一只张开，一只握拳），检验虚拟手跟随与手势
    pg.evaluate(FAKE_HANDS, [{'g': 'open', 'x': 0.38, 'y': 0.5, 'size': 0.14}, {'g': 'fist', 'x': 0.66, 'y': 0.55, 'size': 0.13}])
    pg.mouse.move(640, 795); pg.wait_for_timeout(700)
    R['fake_hands'] = pg.evaluate('__mg.input.hands.filter(h=>h.source=="hand").map(h=>({g:h.gesture, color:h.style.stroke}))')
    pg.screenshot(path=f'{SH}/v2_03_wipe_two_hands.png')
    # 移动张开的手擦玻璃
    for i in range(12):
        pg.evaluate(FAKE_HANDS, [{'g': 'open', 'x': 0.25 + i * 0.04, 'y': 0.45 + (i % 2) * 0.1, 'size': 0.14}, {'g': 'point', 'x': 0.7, 'y': 0.4 + i * 0.02, 'size': 0.13}])
        pg.wait_for_timeout(60)
    R['fake_hands_point'] = pg.evaluate('__mg.input.hands.filter(h=>h.source=="hand").map(h=>h.gesture)')
    pg.screenshot(path=f'{SH}/v2_04_wipe_hands_wiping.png')
    pg.evaluate('__mg.tracker.update=()=>false; __mg.tracker.hands=[]')
    pg.wait_for_timeout(400)
    # 4. 擦到过关，出现“去给它涂颜色”
    drag(pg, zig(170, 1220, 40, 760, 14), steps=14); drag(pg, zig(40, 1240, 150, 770, 12), steps=14)
    t0 = time.time()
    while time.time() - t0 < 5 and pg.evaluate('__mg.mode.state') != 'reveal': pg.wait_for_timeout(50)
    R['wipe_state'] = pg.evaluate('__mg.mode.state')
    pg.wait_for_timeout(900)
    pg.screenshot(path=f'{SH}/v2_05_wipe_reveal_color_button.png')
    btn = pg.evaluate('(()=>{const b=__mg.ui.get("color"); return b && b.visible ? {x:(b.x+b.w/2)/devicePixelRatio, y:(b.y+b.h/2)} : null})()')
    q = pg.evaluate('document.querySelector("#stage").width / innerWidth')
    if btn:
        pg.mouse.click(btn['x'] * pg.evaluate('devicePixelRatio') / q, btn['y'] / q); pg.wait_for_timeout(1500)
    R['after_color_button'] = pg.evaluate('__mg.mode.name + (__mg.mode.lineArt ? "+线稿" : "")')
    pg.screenshot(path=f'{SH}/v2_06_paint_lineart.png')
    # 5. 混色画画（空白画纸）
    pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(500)
    pots = pg.evaluate('__mg.mode.pots.map(p=>({id:p.id, x:(p.x+p.w/2)/(document.querySelector("#stage").width/innerWidth), y:(p.y+p.h*0.45)/(document.querySelector("#stage").width/innerWidth)}))')
    P = {p['id']: p for p in pots}
    def grab(cid):
        pg.mouse.move(P[cid]['x'], P[cid]['y']); pg.mouse.down(); pg.wait_for_timeout(350)
        if cid == 'red': pg.screenshot(path=f'{SH}/v2_07_paint_grabbing.png')
        pg.wait_for_timeout(400); pg.mouse.up()
    grab('red'); R['loaded_red'] = pg.evaluate('[...__mg.mode.brushes.values()][0].amount')
    drag(pg, [(300, 300), (560, 300), (300, 360), (560, 360), (300, 420), (560, 420)])
    grab('yellow')
    drag(pg, [(420, 280), (760, 280), (420, 340), (760, 340), (420, 400), (760, 400)])
    grab('blue')
    drag(pg, [(650, 500), (1000, 500), (650, 560), (1000, 560)])
    grab('yellow')
    drag(pg, [(800, 470), (800, 620), (880, 470), (880, 620), (960, 470), (960, 620)])
    grab('red')
    drag(pg, [(400, 600), (700, 600), (400, 650), (700, 650)])
    grab('blue')
    drag(pg, [(450, 580), (450, 680), (550, 580), (550, 680), (650, 580), (650, 680)])
    pg.mouse.move(640, 700); pg.mouse.down(); pg.mouse.move(700, 720, steps=3)
    pg.screenshot(path=f'{SH}/v2_08_paint_mixing.png')
    pg.mouse.up()
    R['discovered'] = pg.evaluate('__mg.mode.discovered.map(d=>d.zh+" "+d.en)')
    R['brush_after'] = pg.evaluate('(()=>{const b=[...__mg.mode.brushes.values()][0]; return {amount:+b.amount.toFixed(2), rgb:b.rgb}})()')
    # 采样：红黄重叠区、黄蓝重叠区、红蓝重叠区
    def sample(x, y): return pg.evaluate(f'(()=>{{const k=document.querySelector("#stage").width/innerWidth; const s=__mg.mode.canvas.sample({x}*k,{y}*k); return s && s.rgb}})()')
    R['sample_red_yellow'] = sample(500, 340); R['sample_yellow_blue'] = sample(840, 530); R['sample_red_blue'] = sample(500, 630)
    # 撤销 / 保存 / 清空（点击按钮）
    def click_btn(i):
        b2 = pg.evaluate(f'(()=>{{const b=__mg.ui.get("{i}"); const k=document.querySelector("#stage").width/innerWidth; return {{x:(b.x+b.w/2)/k, y:(b.y+b.h/2)/k}}}})()')
        pg.mouse.click(b2['x'], b2['y'])
    n0 = pg.evaluate('__mg.mode.canvas.undo.length'); click_btn('undo'); pg.wait_for_timeout(200)
    R['undo'] = [n0, pg.evaluate('__mg.mode.canvas.undo.length')]
    with pg.expect_download() as dl: click_btn('save')
    d = dl.value; path = f'{SH}/v2_saved_painting.png'; d.save_as(path); R['saved_file'] = [d.suggested_filename, os.path.getsize(path)]
    click_btn('clear'); pg.wait_for_timeout(200)
    R['cleared_amount'] = pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)')
    # 6. 模拟真实手：握拳抓蓝色，张开手涂抹
    pg.mouse.move(640, 795)
    kx = pg.evaluate('innerWidth')
    bx, by = P['blue']['x'] / W, P['blue']['y'] / H
    cbx, cby = pg.evaluate(f'__mg.input.screenToCam({bx}, {by})')  # v4：安全区映射
    for i in range(16):
        pg.evaluate(FAKE_HANDS, [{'g': 'fist', 'x': cbx, 'y': cby + 0.02, 'size': 0.13}]); pg.wait_for_timeout(80)
    pg.screenshot(path=f'{SH}/v2_09_paint_real_hand_grab.png')
    R['real_hand_dbg'] = pg.evaluate('(()=>{const k=document.querySelector("#stage").width/innerWidth; const h=__mg.input.hands.find(h=>h.source=="hand"); const p=__mg.mode.pots.find(p=>p.id=="blue"); return {palm:h&&h.palm.map(v=>v/k), g:h&&h.gesture, pot:[p.x/k,p.y/k,p.w/k,p.h/k], mode:__mg.mode.name}})()')
    R['real_hand_loaded'] = pg.evaluate('[...__mg.mode.brushes.entries()].filter(([k])=>k.startsWith("h")).map(([k,b])=>+b.amount.toFixed(2))')
    sx, sy = cbx, cby + 0.02
    for i in range(30):  # v3：只伸食指才画（张开手不画），连续移到画纸上并来回涂
        t = i / 29
        pg.evaluate(FAKE_HANDS, [{'g': 'point', 'x': sx + (0.45 - sx) * min(1, t * 2) + (0.12 * ((i % 8) / 7) if t > 0.5 else 0), 'y': sy + (0.45 - sy) * min(1, t * 2) + (0.06 if (i // 8) % 2 else 0), 'size': 0.13}]); pg.wait_for_timeout(50)
    pg.screenshot(path=f'{SH}/v2_10_paint_real_hand_paint.png')
    R['real_hand_point_painted'] = round(pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)'), 1)
    R['errors'] = errs
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1))
