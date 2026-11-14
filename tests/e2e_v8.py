# v8/v9 端到端：投水球的小怪兽贴图（v9：8 种，没有角 / 翅膀）+ 被打中会哭。python3 tests/e2e_v8.py
# 贴图加载好、四种怪兽都能出现、标签在肚皮上；打中 → 哭脸 + 眼泪粒子 + 哭声，然后缩回去；打错 → 笑着躲开、不哭。
import json, os, math
from playwright.sync_api import sync_playwright
URL = os.environ.get('MG_URL', 'http://localhost:8765/index.html')
SH = '/workspace/magic-glass-shots'; os.makedirs(SH, exist_ok=True)
SETUP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fake_hands.js')).read()
R = {}; fails = []
def check(name, cond, val=None):
    R[name] = val if val is not None else bool(cond)
    if not cond: fails.append(name)
SWING = '''([sx, sy, vx, vy, T]) => new Promise(res => {
  const t0 = performance.now();
  (function step() {
    const t = (performance.now() - t0) / 1000;
    window.__spec = [{ g: t < T ? 'fist' : 'open', X: sx + vx * t, Y: sy + vy * t, hand: 'right' }];
    if (t < T + 0.15) requestAnimationFrame(step); else res();
  })();
})'''
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.goto(URL); pg.wait_for_timeout(400); pg.click('#btnMouse'); pg.wait_for_timeout(600)
    pg.mouse.move(5, 790)
    pg.evaluate('__mg.settings.throwSkipFree = true; __mg.settings.throwContent = "num"; __mg.goMode("throw")')
    pg.evaluate(SETUP)
    pg.evaluate('(() => { window.__cries = 0; const s = __mg.mode.sfx; const o = s.cry; s.cry = function () { window.__cries++; return o && o.apply(this, arguments); }; window.__ev = []; for (const n of ["throw:hit","throw:wrong","throw:prompt"]) __mg.bus.on(n, p => window.__ev.push({ n, p })); })()')
    ready = pg.evaluate('import("./js/render/monsterSprites.js").then(m => m.preloadMonsters().then(() => [m.spritesReady(), m.readyKinds().length, m.MONSTER_KINDS.length]))')
    check('1_sprites_loaded_all_8_kinds', ready == [True, 8, 8], ready)
    W, H = pg.evaluate('[document.querySelector("#stage").width, document.querySelector("#stage").height]')
    bk = pg.evaluate('__mg.mode.basket'); BX, BY = bk['x'] + bk['w'] / 2, bk['y'] + bk['h'] * 0.5
    seth = lambda s: pg.evaluate('s => { window.__spec = s }', s)
    seth([{'g': 'open', 'X': W * 0.12, 'Y': H * 0.93, 'hand': 'right'}])
    pg.wait_for_timeout(3500)
    mons = lambda: pg.evaluate('__mg.mode.monsters.map(m=>({id:m.id, x:m.x, y:m.cy, r:m.r, st:m.state, kind:m.kind, mood:m.mood, hit:__mg.mode.hittable(m), label:m.label&&m.label.text}))')
    ms = [m for m in mons() if m['st'] != 'hidden']
    check('2_kinds_assigned', all(m['kind'] in range(8) for m in ms), [m['kind'] for m in ms])
    check('2_visible_kinds_distinct', len(set(m['kind'] for m in ms)) == len(ms), [m['kind'] for m in ms])
    check('2_labelled', all(m['label'] for m in ms if m['st'] == 'up'), [m['label'] for m in ms])
    I = pg.evaluate('__mg.mode.L.inset')
    out = [bb for bb in pg.evaluate('__mg.mode.debugBounds()') if bb['x'] < I['x0'] - 1 or bb['y'] < I['y0'] - 1 or bb['x'] + bb['w'] > I['x1'] + 1 or bb['y'] + bb['h'] > I['y1'] + 1]
    check('2_all_inside_safe_inset', not out, out[:3])
    pg.screenshot(path=f'{SH}/v9_01_monsters.png')
    # 打中目标 → 哭
    def grab():
        seth([{'g': 'open', 'X': BX, 'Y': BY, 'hand': 'right'}]); pg.wait_for_timeout(250)
        seth([{'g': 'fist', 'X': BX, 'Y': BY, 'hand': 'right'}]); pg.wait_for_timeout(350)
    def swing_at(m, T=0.3):
        dx, dy = m['x'] - BX, m['y'] - BY; D = math.hypot(dx, dy); v = D / (T + 0.5)
        pg.evaluate(SWING, [BX, BY, dx / D * v, dy / D * v, T])
    tgt = None
    for _ in range(40):
        tid = pg.evaluate('__mg.mode.target && __mg.mode.target.id')
        tgt = next((m for m in mons() if m['id'] == tid and m['hit']), None) if tid is not None else None
        if tgt: break
        pg.wait_for_timeout(150)
    check('3_have_target', tgt is not None)
    grab(); tgt = next(m for m in mons() if m['id'] == tgt['id'])
    swing_at(tgt)
    seth([{'g': 'open', 'X': W * 0.12, 'Y': H * 0.93, 'hand': 'right'}])  # 手挪开，别挡住哭脸
    for _ in range(30):
        if any(e['n'] == 'throw:hit' for e in pg.evaluate('window.__ev')): break
        pg.wait_for_timeout(50)
    pg.wait_for_timeout(450)  # v9：水花从身体边缘往外炸、很快散掉，0.45 秒时哭脸已经看得清
    m = next(m for m in mons() if m['id'] == tgt['id'])
    check('3_hit_correct', any(e['n'] == 'throw:hit' and e['p'].get('correct') for e in pg.evaluate('window.__ev')))
    check('3_crying_face', m['mood'] == 'cry' and m['st'] == 'hit', m)
    check('3_tears_falling', pg.evaluate('__mg.mode.tears.length') > 2, pg.evaluate('__mg.mode.tears.length'))
    pg.screenshot(path=f'{SH}/v9_02_cry.png')
    box = pg.evaluate('(id => { const m = __mg.mode.monsters.find(m => m.id === id); const k = document.querySelector("#stage").width / innerWidth; return [m.x / k, m.cy / k, m.r / k]; })', tgt['id'])
    pg.screenshot(path=f'{SH}/v9_03_cry_zoom.png', clip={'x': box[0] - box[2] * 2.2, 'y': box[1] - box[2] * 2, 'width': box[2] * 4.4, 'height': box[2] * 3.6})
    check('3_cry_sound', pg.evaluate('window.__cries') == 1, pg.evaluate('window.__cries'))
    pg.wait_for_timeout(1500)
    m = next(m for m in mons() if m['id'] == tgt['id'])
    check('3_retreats_after_cry', m['st'] in ('duck', 'hidden', 'rise'), m['st'])
    # 打错 → 躲开、笑，不哭
    pg.wait_for_timeout(2500)
    wrong = None
    for _ in range(40):
        tid = pg.evaluate('__mg.mode.target && __mg.mode.target.id')
        wrong = next((m for m in mons() if tid is not None and m['id'] != tid and m['hit'] and m['st'] == 'up'), None)
        if wrong: break
        pg.wait_for_timeout(150)
    cries0 = pg.evaluate('window.__cries')
    if wrong:
        grab(); wrong = next(m for m in mons() if m['id'] == wrong['id']); swing_at(wrong); pg.wait_for_timeout(500)
        mm = next(m for m in mons() if m['id'] == wrong['id'])
        check('4_wrong_dodges_no_cry', mm['mood'] != 'cry' and pg.evaluate('window.__cries') == cries0, [mm['mood'], mm['st']])
        check('4_wrong_event', any(e['n'] == 'throw:wrong' for e in pg.evaluate('window.__ev')))
    else: check('4_found_wrong_monster', False)
    # 随机出场：反复让一只重新冒出来，8 种都会出现，而且和同屏其它怪兽不重样
    kinds = pg.evaluate('''(() => { const M = __mg.mode, m = M.monsters[0], seen = new Set(); let dup = 0;
      for (let i = 0; i < 120; i++) { M._spawn(m); if (M.monsters.some(o => o !== m && o.state !== 'hidden' && o.kind === m.kind)) dup++; }
      for (const o of M.monsters) if (o !== m) { o.state = 'hidden'; o.timer = 99; }
      for (let i = 0; i < 120; i++) { M._spawn(m); seen.add(m.kind); }
      return [seen.size, dup]; })()''')
    check('5_random_kinds_cover_all_8_and_distinct', kinds[0] == 8 and kinds[1] == 0, kinds)
    check('no_page_errors', not errs, errs[:3])
    b.close()
print(json.dumps(R, ensure_ascii=False, indent=1, default=str))
print('v8 sprite/cry e2e ' + ('passed' if not fails else 'FAILED: ' + ', '.join(fails)))
