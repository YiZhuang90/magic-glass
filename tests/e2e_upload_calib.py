from playwright.sync_api import sync_playwright
import json
r={}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True)
    pg=b.new_page(viewport={'width':1280,'height':720}); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m:m.type=='error' and errs.append(m.text))
    pg.goto('http://localhost:8765/index.html'); pg.click('#btnMouse'); pg.wait_for_timeout(800)
    pg.evaluate('__mg.goMode("wipe")'); pg.mouse.move(640, 795); pg.wait_for_timeout(800)  # v2 起始为首页，直接进擦玻璃
    pg.keyboard.press('p'); pg.wait_for_timeout(200)
    pg.set_input_files('#upload','/workspace/magic-glass-shots/00_start.png'); pg.wait_for_timeout(800)
    r['content_len']=pg.evaluate('__mg.mode.content.list().length'); r['upload_saved']=pg.evaluate("!!localStorage.getItem('magicGlass.upload.v1')")
    pg.click('#displaySeg button[data-display=projector]'); pg.wait_for_timeout(200)
    pg.click('#btnCalibDrag'); pg.wait_for_timeout(400)
    pg.screenshot(path='/workspace/magic-glass-shots/08_calib_drag.png')
    box=pg.locator('#calibDragCanvas').bounding_box()
    pg.mouse.move(box['x']+box['width']*0.06, box['y']+box['height']*0.06); pg.mouse.down(); pg.mouse.move(box['x']+box['width']*0.2, box['y']+box['height']*0.25, steps=5); pg.mouse.up()
    pg.click('#calibSave'); pg.wait_for_timeout(300)
    r['calibrated']=pg.evaluate('__mg.calibration.isCalibrated'); r['map_corner']=pg.evaluate('__mg.calibration.map(0.2,0.25)')
    # jump to upload card
    for i in range(10): pg.keyboard.press('n'); pg.wait_for_timeout(150)
    pg.wait_for_timeout(1200); r['card']=pg.evaluate('__mg.mode.card.id')
    pg.evaluate("__mg.mode.cover.alpha=0.0"); pg.wait_for_timeout(100)
    pg.screenshot(path='/workspace/magic-glass-shots/09_upload_card.png')
    r['errors']=errs; b.close()
print(json.dumps(r,ensure_ascii=False))
