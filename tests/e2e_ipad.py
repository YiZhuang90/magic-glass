# iPad 兼容性测试：python3 tests/e2e_ipad.py <url> [webkit|chromium]
# - webkit：模拟 iPad（触屏、2x 像素），检查页面 / 模块加载、视口不缩放、首次点按解锁音频、MediaPipe 模型在 WebKit 里能加载并识别（用测试图片）、GPU→CPU 回退
# - chromium：用 CDP 发送真实触摸事件：按住颜料罐选色、拖动画画、看到真手时触屏手隐藏
import base64, json, os, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'webkit'
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = 'data:image/jpeg;base64,' + base64.b64encode(open(os.path.join(HERE, 'assets', 'two_people_sample.jpg'), 'rb').read()).decode()
R = {}; fails = []
def check(name, cond, val=None):
    R[name] = val if val is not None else bool(cond)
    if not cond: fails.append(name)

with sync_playwright() as p:
    if ENGINE == 'webkit':
        dev = dict(p.devices['iPad Pro 11 landscape']) if 'iPad Pro 11 landscape' in p.devices else dict(p.devices['iPad (gen 7) landscape'])
        b = p.webkit.launch(headless=True)
        ctx = b.new_context(**dev)
    else:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': 1180, 'height': 820}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; bad = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.on('response', lambda r: r.status >= 400 and bad.append(f'{r.status} {r.url}'))
    resp = pg.goto(URL, wait_until='networkidle')
    check('page_200', resp.status == 200, resp.status)
    check('modules_loaded', pg.evaluate('!!window.__mg'))
    check('viewport_meta_no_zoom', 'user-scalable=no' in pg.evaluate('document.querySelector("meta[name=viewport]").content'))
    check('video_playsinline_muted', pg.evaluate('(()=>{const v=document.querySelector("#video"); return v.hasAttribute("playsinline") && v.muted})()'))
    check('touch_action_none', pg.evaluate('getComputedStyle(document.querySelector("#stage")).touchAction') == 'none')
    pg.screenshot(path=f'{SH}/v5_{ENGINE}_01_start.png')
    # 首次点按：进入（触屏 / 鼠标模式），解锁音频
    pg.tap('#btnMouse', force=True)
    pg.wait_for_timeout(800)
    check('game_running_after_tap', pg.evaluate('document.querySelector("#start").classList.contains("hidden")'))
    # Chromium：必须是 running。无头 WebKit 在这台没有声卡的机器上无法启动音频设备，只检查“第一次点按时创建并预热了音频”
    au = pg.evaluate('[__mg.audioState, __mg.audioPrimed]')
    check('audio_unlocked_after_first_tap', au[0] == 'running' if ENGINE != 'webkit' else (au[0] != 'none' and au[1]), au)
    check('visual_viewport_scale_1', pg.evaluate('window.visualViewport ? visualViewport.scale : 1') == 1)
    check('no_page_scroll', pg.evaluate('[scrollX, scrollY]') == [0, 0])
    if ENGINE == 'webkit':
        # MediaPipe（手 + 人脸）在 WebKit 中加载，并用测试图片识别；GPU 不可用时应回退 CPU
        pg.evaluate('__mg.tracker.facesOn = true')
        res = pg.evaluate('''async (img) => { const t = __mg.tracker; const t0 = performance.now();
          try { await t.initModel(()=>{}); } catch (e) { return {error: String(e)} }
          const im = new Image(); im.src = img; await im.decode();
          const c = document.createElement('canvas'); c.width = 640; c.height = 480; c.getContext('2d').drawImage(im, 0, 0, 640, 480);
          const hands = t.landmarker.detectForVideo(c, performance.now() + 1);
          const faces = t.faceDetector ? t.faceDetector.detectForVideo(c, performance.now() + 2) : {detections: []};
          return {hand: t.backend, face: t.faceBackend, loadMs: Math.round(performance.now() - t0), hands: hands.landmarks.length,
                  handedness: (hands.handedness || []).map(h => h[0].categoryName), faces: faces.detections.length}; }''', IMG)
        check('mediapipe_loads_and_detects_in_webkit', res.get('hands', 0) >= 2 and res.get('faces', 0) == 2, res)
        # 摄像头：getUserMedia 存在（https 下）；无摄像头时优雅退回触屏模式
        check('getUserMedia_available', pg.evaluate('!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)'))
        # 鼠标 / 触屏在画画里可用（WebKit 无法发送真实触摸拖动，用鼠标代替；真实触摸拖动在 chromium 测试）
        pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(400)
        k = pg.evaluate('document.querySelector("#stage").width / innerWidth')
        red = pg.evaluate('(()=>{const p=__mg.mode.pots.find(p=>p.id=="red"); return [(p.x+p.w/2), (p.y+p.h/2)]})()')
        pg.mouse.move(red[0] / k, red[1] / k); pg.mouse.down(); pg.wait_for_timeout(800); pg.mouse.up()
        pg.mouse.move(400, 300); pg.mouse.down(); pg.mouse.move(700, 350, steps=12); pg.mouse.up()
        check('paint_works_in_webkit', pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)') > 0)
        pg.screenshot(path=f'{SH}/v5_webkit_02_paint.png')
        # 投水球在 WebKit 里能玩：鼠标在篮子上按下 → 往上拖 → 松开
        pg.evaluate('__mg.goMode("throw")'); pg.wait_for_timeout(1500)
        bk = pg.evaluate('(()=>{const b=__mg.mode.basket; return [b.x+b.w/2, b.y+b.h/2]})()')
        pg.mouse.move(bk[0] / k, bk[1] / k); pg.mouse.down(); pg.wait_for_timeout(100)
        held = pg.evaluate('__mg.mode.held.size')
        pg.mouse.move(bk[0] / k, bk[1] / k - 250, steps=6); pg.mouse.up(); pg.wait_for_timeout(150)
        check('throw_mode_webkit_grab_and_throw', held == 1 and pg.evaluate('__mg.mode.throws') == 1, [held, pg.evaluate('__mg.mode.throws')])
        pg.wait_for_timeout(900); pg.screenshot(path=f'{SH}/v6_webkit_ipad_throw.png')
    else:
        cdp = ctx.new_cdp_session(pg)
        def touch(kind, pts): cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': 1} for x, y in pts]})
        pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(400)
        k = pg.evaluate('document.querySelector("#stage").width / innerWidth')
        red = pg.evaluate('(()=>{const p=__mg.mode.pots.find(p=>p.id=="red"); return [(p.x+p.w/2), (p.y+p.h/2)]})()')
        rx, ry = red[0] / k, red[1] / k
        touch('touchStart', [(rx, ry)]); pg.wait_for_timeout(250)
        check('touch_hand_visible_while_touching', pg.evaluate('__mg.input.hands.some(h=>h.source=="touch")'))
        pg.wait_for_timeout(600); touch('touchEnd', [])
        R['touch_brush_after_hold'] = pg.evaluate('(()=>{const b=[...__mg.mode.brushes.values()].find(b=>b.source=="touch"); return b && {tool:b.tool, rgb:b.rgb}})()')
        check('touch_hold_on_pot_grabs', R['touch_brush_after_hold'] and R['touch_brush_after_hold']['rgb'] == [230, 30, 35])
        touch('touchStart', [(400, 300)])
        for i in range(1, 21): touch('touchMove', [(400 + i * 15, 300 + (i % 4) * 6)]); pg.wait_for_timeout(16)
        touch('touchEnd', []); pg.wait_for_timeout(200)
        a = pg.evaluate('__mg.mode.canvas.amt.reduce((a,b)=>a+b,0)')
        check('touch_drag_paints', a > 0, round(a, 1))
        check('no_zoom_after_touch', pg.evaluate('visualViewport.scale') == 1 and pg.evaluate('[scrollX, scrollY]') == [0, 0])
        # 投水球：手指在篮子上按下 → 拖动 → 抬起 = 扔出
        pg.evaluate('__mg.goMode("throw")'); pg.wait_for_timeout(1200)
        bk = pg.evaluate('(()=>{const b=__mg.mode.basket; return [b.x+b.w/2, b.y+b.h/2]})()'); bx, by = bk[0] / k, bk[1] / k
        touch('touchStart', [(bx, by)]); pg.wait_for_timeout(120)
        held = pg.evaluate('__mg.mode.held.size')
        for i in range(1, 9): touch('touchMove', [(bx, by - i * 30)]); pg.wait_for_timeout(16)
        touch('touchEnd', []); pg.wait_for_timeout(150)
        check('touch_throw_grab_and_release', held == 1 and pg.evaluate('__mg.mode.throws') == 1 and pg.evaluate('__mg.mode.held.size') == 0, [held, pg.evaluate('__mg.mode.throws')])
        check('touch_throw_goes_up', pg.evaluate('__mg.mode.lastThrow.v[1]') < 0, pg.evaluate('__mg.mode.lastThrow'))
        pg.wait_for_timeout(900); pg.evaluate('__mg.goMode("paint")'); pg.wait_for_timeout(300)
        # 摄像头看到真手：按住不动的触点手隐藏，移动后回来
        pg.evaluate(open(os.path.join(HERE, 'fake_hands.js')).read())
        touch('touchStart', [(500, 600)]); pg.wait_for_timeout(200)
        pg.evaluate('window.__spec=[{g:"open", cx:0.8, cy:0.5}]'); pg.wait_for_timeout(1200)
        check('touch_hidden_when_real_hand', not pg.evaluate('__mg.input.hands.some(h=>h.source=="touch")'))
        touch('touchMove', [(501, 600)]); pg.wait_for_timeout(150)
        check('touch_jitter_stays_hidden', not pg.evaluate('__mg.input.hands.some(h=>h.source=="touch")'))
        touch('touchMove', [(560, 620)]); pg.wait_for_timeout(150)
        check('touch_move_shows_again', pg.evaluate('__mg.input.hands.some(h=>h.source=="touch")'))
        touch('touchEnd', [])
        pg.screenshot(path=f'{SH}/v5_chromium_touch_paint.png')
    check('no_page_errors', not errs, errs)
    check('no_http_errors', not [x for x in bad if 'favicon' not in x], bad)
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1))
print('FAILED: ' + ', '.join(fails) if fails else f'ipad {ENGINE} e2e passed')
raise SystemExit(1 if fails else 0)
