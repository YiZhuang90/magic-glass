# v6 端到端：投水球。python3 tests/e2e_v6.py
# 假摄像头（fake_hands.js）里的手：在篮子上握拳拿水球 → 朝怪兽挥手 → 张开手扔出 → 打中；
# 自由模式打中 N 次后切到目标模式；打对 / 打错；安全区边上也能拿到水球；所有元素都在安全范围里；鼠标扔；H 回首页。
import json, os, math
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
SETUP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_hands.js')).read()
R = {}; fails = []
def check(name, cond, val=None):
    R[name] = val if val is not None else bool(cond)
    if not cond: fails.append(name)

# 在页面里按真实时间驱动假手：从 (sx,sy) 匀速移向 (ex,ey)，握拳移动 T 秒后张开，再继续移动 0.15 秒
SWING = '''([sx, sy, vx, vy, T]) => new Promise(res => {
  const t0 = performance.now();
  (function step() {
    const t = (performance.now() - t0) / 1000;
    const g = t < T ? 'fist' : 'open';
    window.__spec = [{ g, X: sx + vx * t, Y: sy + vy * t, hand: 'right' }];
    if (t < T + 0.15) requestAnimationFrame(step); else res();
  })();
})'''
EVENTS = '''(() => { window.__ev = []; for (const n of ['throw:grab','throw:release','throw:hit','throw:miss','throw:wrong','throw:prompt','throw:phase','throw:neutral','throw:cancel'])
  __mg.bus.on(n, p => window.__ev.push({ n, p: JSON.parse(JSON.stringify(p || {})), t: performance.now() }));
  const s = __mg.mode.speech, o = s.say.bind(s); window.__said = [];
  s.say = (parts, ms) => { window.__said.push(parts.map(x => x.text).join(' | ')); return o(parts, ms); }; })()'''

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e) + ' @ ' + (e.stack or '')[:300]))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto(URL); pg.wait_for_timeout(400); pg.click('#btnMouse'); pg.wait_for_timeout(600)
    k = pg.evaluate('document.querySelector("#stage").width / innerWidth')
    # —— 0. 首页第三张卡片 → 投水球 ——
    card = pg.evaluate('(()=>{const b=__mg.ui.get("throw"); return b && [b.x+b.w/2, b.y+b.h/2]})()')
    check('0_home_has_throw_card', card is not None)
    pg.screenshot(path=f'{SH}/v6_01_home_three_cards.png')
    pg.mouse.move(card[0] / k, card[1] / k); pg.wait_for_timeout(300); pg.mouse.move(card[0] / k + 3, card[1] / k + 3); pg.wait_for_timeout(1300)
    check('0_hover_card_enters_throw', pg.evaluate('__mg.mode.name') == 'throw', pg.evaluate('__mg.mode.name'))
    pg.mouse.move(5, 790)  # 鼠标挪开
    # 重新进入，自由模式打中 3 次后出题（测试用 3，默认 5）
    pg.evaluate('__mg.settings.throwFreeHits = 3; __mg.settings.throwContent = "num"; __mg.settings.throwSkipFree = false; __mg.goMode("throw")')
    pg.evaluate(SETUP); pg.evaluate(EVENTS)
    W, H = pg.evaluate('[document.querySelector("#stage").width, document.querySelector("#stage").height]')
    bk = pg.evaluate('__mg.mode.basket'); BX, BY = bk['x'] + bk['w'] / 2, bk['y'] + bk['h'] * 0.5
    U = min(W, H)
    pg.wait_for_timeout(1500)
    seth = lambda s: pg.evaluate('s => { window.__spec = s }', s)
    held = lambda: pg.evaluate('__mg.mode.held.size')
    ev = lambda n: [e for e in pg.evaluate('window.__ev') if e['n'] == n]

    # —— 1. 离篮子很远的地方握拳：什么都不发生 ——
    seth([{'g': 'open', 'X': W * 0.25, 'Y': H * 0.75, 'hand': 'right'}]); pg.wait_for_timeout(300)
    seth([{'g': 'fist', 'X': W * 0.25, 'Y': H * 0.75, 'hand': 'right'}]); pg.wait_for_timeout(500)
    check('1_fist_away_from_basket_nothing', held() == 0 and not ev('throw:grab'))
    seth([{'g': 'open', 'X': W * 0.25, 'Y': H * 0.75, 'hand': 'right'}]); pg.wait_for_timeout(300)
    check('1_open_away_no_throw', not ev('throw:release'))
    pg.evaluate('window.__ev.length = 0')

    def grab():
        seth([{'g': 'open', 'X': BX, 'Y': BY, 'hand': 'right'}]); pg.wait_for_timeout(250)
        seth([{'g': 'fist', 'X': BX, 'Y': BY, 'hand': 'right'}]); pg.wait_for_timeout(350)
        return held()

    def monsters():
        return pg.evaluate('__mg.mode.monsters.map(m=>({id:m.id, x:m.x, y:m.cy, r:m.r, st:m.state, hit:__mg.mode.hittable(m), label:m.label&&m.label.text}))')

    def swing_at(m, T=0.3):
        """从篮子朝怪兽 m 挥手：匀速 v，握拳 T 秒后张开。落点 ≈ 出手点 + 0.42·v，大约落在怪兽身上。"""
        dx, dy = m['x'] - BX, m['y'] - BY; D = math.hypot(dx, dy)
        v = D / (T + 0.08 + 0.42)
        pg.evaluate(SWING, [BX, BY, dx / D * v, dy / D * v, T])

    def wait_hittable(pred=lambda m: True, ms=6000):
        for _ in range(ms // 100):
            c = [m for m in monsters() if m['hit'] and pred(m)]
            if c: return c
            pg.wait_for_timeout(100)
        return []

    # —— 2. 拿水球 → 挥手 → 张开 → 打中 ——
    check('2_grab_on_basket', grab() == 1)
    pg.wait_for_timeout(300)
    pg.screenshot(path=f'{SH}/v6_02_holding_balloon.png')
    check('2_balloon_in_hand_decor', pg.evaluate('(()=>{const h=__mg.input.hands.find(h=>h.source=="hand"); return !!(h && __mg.mode.handDecor(h).balloon)})()'))
    c = wait_hittable(); m0 = min(c, key=lambda m: abs(m['x'] - BX))
    swing_at(m0)
    rel = ev('throw:release')
    check('2_released_on_open', len(rel) == 1, rel[0]['p'] if rel else None)
    check('2_release_velocity_upward', rel and rel[0]['p']['v'][1] < -0.5 * U, rel and [round(x) for x in rel[0]['p']['v']])
    check('2_aim_assist_locked_monster', rel and rel[0]['p']['aimed'] == m0['id'], [rel and rel[0]['p']['aimed'], m0['id']])
    pg.wait_for_timeout(120); pg.screenshot(path=f'{SH}/v6_03_balloon_flying.png')
    pg.wait_for_timeout(700)
    pg.screenshot(path=f'{SH}/v6_04_hit_splash.png')
    hits = ev('throw:hit')
    check('2_hit_monster', len(hits) == 1 and pg.evaluate('__mg.mode.hits') == 1, [len(hits), pg.evaluate('__mg.mode.hits')])
    check('2_must_regrab', held() == 0)

    # —— 3. 再打 2 次 → 切到目标模式 ——
    for i in range(2):
        pg.wait_for_timeout(400)
        grab()
        c = wait_hittable(); m = min(c, key=lambda m: abs(m['x'] - BX))
        swing_at(m); pg.wait_for_timeout(900)
    check('3_three_free_hits', pg.evaluate('__mg.mode.freeHits') == 3, pg.evaluate('__mg.mode.freeHits'))
    check('3_switched_to_target', pg.evaluate('__mg.mode.phase') == 'target' and len(ev('throw:phase')) == 1)
    seth([{'g': 'open', 'X': BX, 'Y': H * 0.7, 'hand': 'right'}])
    pg.wait_for_timeout(3000)
    pr = ev('throw:prompt')
    mons = monsters(); labels = [m['label'] for m in mons if m['st'] != 'hidden']
    check('3_target_mode_monsters_labelled', len([l for l in labels if l]) >= 3 and all(l in [str(i) for i in range(1, 11)] for l in labels if l), labels)
    check('3_labels_unique', len(set(l for l in labels if l)) == len([l for l in labels if l]), labels)
    check('3_prompt_emitted', len(pr) >= 1, pr and pr[0]['p'])
    said = pg.evaluate('window.__said')
    check('3_lead_voice_line', any('现在试试打' in s for s in said), said[-3:])
    tgt = pg.evaluate('__mg.mode.target && __mg.mode.target.label.text')
    check('3_target_on_screen', tgt in labels, [tgt, labels])
    pg.screenshot(path=f'{SH}/v6_05_target_mode_prompt.png')

    # —— 4. 打错：怪兽笑着躲开，不扣分；打对：彩虹水花 + 下一题（不重复） ——
    pg.evaluate('__mg.mode.walk = false')
    h0 = pg.evaluate('__mg.mode.hits')
    tm = [m for m in monsters() if m['label'] == tgt][0]
    wrongs = [m for m in wait_hittable(lambda m: m['label'] != tgt)]
    ang = lambda m: math.atan2(m['y'] - BY, m['x'] - BX)
    wm = max(wrongs, key=lambda m: abs(ang(m) - ang(tm)))
    grab(); swing_at(wm); pg.wait_for_timeout(250)
    pg.screenshot(path=f'{SH}/v6_06_wrong_dodge.png')
    pg.wait_for_timeout(700)
    check('4_wrong_monster_dodges', len(ev('throw:wrong')) == 1, [e['p'] for e in ev('throw:wrong')])
    check('4_wrong_no_penalty', pg.evaluate('__mg.mode.hits') == h0 and pg.evaluate('__mg.mode.target && __mg.mode.target.label.text') == tgt)
    pg.wait_for_timeout(1500)
    tm = [m for m in wait_hittable(lambda m: m['label'] == tgt)][0]
    grab(); swing_at(tm); pg.wait_for_timeout(560)
    rainbow = pg.evaluate('__mg.mode.decals.some(d=>d.rainbow) || __mg.mode.parts.some(p=>p.color=="#8338ec")')
    pg.screenshot(path=f'{SH}/v6_07_correct_rainbow.png')
    pg.wait_for_timeout(300)
    th = [e for e in ev('throw:hit') if e['p'].get('phase') == 'target']
    check('4_correct_target_hit', len(th) == 1 and th[0]['p']['label'] == tgt, [e['p'] for e in th])
    check('4_correct_rainbow_splash', rainbow)
    check('4_correct_scores', pg.evaluate('__mg.mode.hits') == h0 + 1)
    pg.wait_for_timeout(3500)
    pr = ev('throw:prompt'); nxt = pr[-1]['p']['label'] if pr else None
    check('4_next_prompt_differs', len(pr) >= 2 and nxt != tgt, [e['p']['label'] for e in pr])
    labels = [m['label'] for m in monsters() if m['st'] != 'hidden']
    check('4_next_target_on_screen', nxt in labels, [nxt, labels])
    # 目标模式下 8 秒没打中会再提示一次
    n_said = len(pg.evaluate('window.__said')); pg.wait_for_timeout(8800)
    check('4_prompt_repeats_after_8s', any(('打' in s and '号' in s) for s in pg.evaluate('window.__said')[n_said:]), pg.evaluate('window.__said')[n_said:])

    # —— 5. 安全区：所有元素在屏幕内侧；安全区边距很大时篮子依然够得着 ——
    out = []
    for _ in range(12):
        for bb in pg.evaluate('__mg.mode.debugBounds()'):
            if bb['x'] < W * 0.04 or bb['y'] < H * 0.03 or bb['x'] + bb['w'] > W * 0.96 or bb['y'] + bb['h'] > H * 0.97: out.append(bb)
        pg.wait_for_timeout(250)
    check('5_all_elements_inside_safe_inset', not out, out[:3])
    pg.evaluate('__mg.settings.safeMargin = 0.3; __mg.settings.safeBottomExtra = 0.2')
    cam = pg.evaluate(f'__mg.input.screenToCam({BX / W}, {BY / H})')
    sr = pg.evaluate('(()=>{const s=__mg.settings; const m=s.safeMargin, b=s.safeBottomExtra; return [m, m, 1-m, 1-m-b]})()')
    check('5_basket_inside_safe_rect_in_camera', sr[0] < cam[0] < sr[2] and sr[1] < cam[1] < sr[3], [cam, sr])
    seth([{'g': 'open', 'cx': cam[0], 'cy': cam[1], 'hand': 'right'}]); pg.wait_for_timeout(250)
    seth([{'g': 'fist', 'cx': cam[0], 'cy': cam[1], 'hand': 'right'}]); pg.wait_for_timeout(350)
    check('5_grab_at_basket_with_big_margin', held() == 1)
    seth([{'g': 'open', 'cx': cam[0], 'cy': cam[1], 'hand': 'right'}]); pg.wait_for_timeout(400)  # 在篮子里慢慢张开 = 放回去
    check('5_open_in_basket_puts_back', held() == 0 and len(ev('throw:cancel')) >= 1)
    # 手放得很低（安全区下边以外，仍在摄像头画面里）：被夹在屏幕底边，仍然在篮子感应区里
    pg.wait_for_timeout(300)
    seth([{'g': 'open', 'cx': 0.5, 'cy': 0.95, 'hand': 'right'}]); pg.wait_for_timeout(250)
    seth([{'g': 'fist', 'cx': 0.5, 'cy': 0.95, 'hand': 'right'}]); pg.wait_for_timeout(350)
    check('5_grab_with_hand_below_safe_zone_edge', held() == 1)
    pg.screenshot(path=f'{SH}/v6_08_grab_at_safe_zone_edge.png')
    seth([{'g': 'open', 'cx': 0.5, 'cy': 0.95, 'hand': 'right'}]); pg.wait_for_timeout(300)
    pg.evaluate('__mg.settings.safeMargin = 0.15; __mg.settings.safeBottomExtra = 0.10')

    # —— 6. 看到真手时鼠标手隐藏：原地按下鼠标拿不到水球 ——
    pg.wait_for_timeout(1000)
    pg.mouse.move(BX / k, BY / k); pg.wait_for_timeout(1000)  # 鼠标动了一下又静止 → 有真手时隐藏
    seth([{'g': 'open', 'X': W * 0.2, 'Y': H * 0.7, 'hand': 'right'}]); pg.wait_for_timeout(1000)
    check('6_mouse_hidden_with_real_hand', pg.evaluate('__mg.input.mouseHidden'))
    pg.mouse.down(); pg.wait_for_timeout(200); hm = held(); pg.mouse.up()
    check('6_hidden_mouse_cannot_grab', hm == 0)

    # —— 7. 鼠标：在篮子上按下 → 拖动 → 松开 = 按指针速度扔出 ——
    seth([]); pg.wait_for_timeout(500)
    pg.evaluate('window.__ev.length = 0')
    pg.mouse.move(BX / k + 10, BY / k); pg.wait_for_timeout(150)
    pg.mouse.down(); pg.wait_for_timeout(120)
    mg = held()
    pg.mouse.move(BX / k + 10, BY / k - 200, steps=8); pg.mouse.up(); pg.wait_for_timeout(100)
    rel = ev('throw:release')
    check('7_mouse_grab', mg == 1)
    check('7_mouse_release_throws_upward', len(rel) == 1 and rel[0]['p']['v'][1] < 0, rel and rel[0]['p'])
    pg.wait_for_timeout(900)

    # —— 8. H 回首页 ——
    pg.keyboard.press('h'); pg.wait_for_timeout(300)
    check('8_H_goes_home', pg.evaluate('__mg.mode.name') == 'home')

    # —— 9. 4:3 屏幕（iPad 横屏）：元素也都在安全范围里 ——
    pg.set_viewport_size({'width': 1024, 'height': 768}); pg.wait_for_timeout(500)
    pg.evaluate('__mg.settings.throwSkipFree = true; __mg.goMode("throw")'); pg.wait_for_timeout(2500)
    W2, H2 = pg.evaluate('[document.querySelector("#stage").width, document.querySelector("#stage").height]')
    out = [bb for bb in pg.evaluate('__mg.mode.debugBounds()') if bb['x'] < W2 * 0.04 or bb['y'] < H2 * 0.03 or bb['x'] + bb['w'] > W2 * 0.96 or bb['y'] + bb['h'] > H2 * 0.97]
    check('9_ipad_4x3_inside_safe_inset', not out, out[:3])
    check('9_skip_free_starts_in_target', pg.evaluate('__mg.mode.phase') == 'target')
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{SH}/v6_09_ipad_4x3_target.png')
    # 汉字内容
    pg.evaluate('__mg.settings.throwContent = "hanzi"; __mg.mode.applySettings({...__mg.settings})'); pg.wait_for_timeout(2500)
    hz = [m['label'] for m in monsters() if m['label']]
    check('9_hanzi_labels', hz and all(len(l) == 1 and '\u4e00' <= l <= '\u9fff' for l in hz), hz)
    pg.screenshot(path=f'{SH}/v6_10_hanzi_labels.png')
    pg.evaluate('__mg.settings.throwSkipFree = false; __mg.settings.throwContent = "num"; __mg.settings.throwFreeHits = 5')
    check('no_page_errors', not errs, errs[:3])
    b.close()

print(json.dumps(R, ensure_ascii=False, indent=1))
if fails: print('FAILED:', fails); raise SystemExit(1)
print('v6 throw e2e passed')
