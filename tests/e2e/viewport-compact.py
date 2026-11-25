"""Compact viewport, 44px targets, safe-area simulation and changing viewport height."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},is_mobile=True,has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible')
 def box(s):return page.locator(s).bounding_box()
 def disjoint(a,b):return a['x']+a['width']<=b['x']+0.5 or b['x']+b['width']<=a['x']+0.5 or a['y']+a['height']<=b['y']+0.5 or b['y']+b['height']<=a['y']+0.5
 for w,h in [(320,568),(390,590),(390,844),(844,390),(390,590)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(200)
  metrics=page.evaluate('''() => ({inner:[innerWidth,innerHeight],visual:[visualViewport.width,visualViewport.height],app:document.querySelector('.vv-app').getBoundingClientRect().height,dvh:CSS.supports('height','100dvh')})''');assert metrics['inner']==[w,h] and metrics['visual']==[w,h] and abs(metrics['app']-h)<1 and metrics['dvh'],metrics
  for s in ['#open','#filename','#speedToggle','#measure','#area','#clearDock','#snap','#undoMeasurement']:
   r=box(s);assert r and r['width']>=44 and r['height']>=44 and r['x']>=0 and r['x']+r['width']<=w and r['y']>=0 and r['y']+r['height']<=h,(w,h,s,r)
  assert box('.vv-titlebar')['y']==4 and abs(h-(box('.vv-dock')['y']+box('.vv-dock')['height'])-12)<1
  page.click('#area');a,z,d=box('#areaClosed'),box('#polygon'),box('.vv-dock');assert disjoint(a,z) and disjoint(z,d),(w,h,a,z,d);page.keyboard.press('Escape')
 page.evaluate("() => {const s=document.querySelector('.app-viewer').style;s.setProperty('--vv-top','44px');s.setProperty('--vv-dock-bottom','34px')}")
 assert box('.vv-titlebar')['y']>=44 and 590-(box('.vv-dock')['y']+box('.vv-dock')['height'])>=34
 display=page.evaluate("() => fetch('./manifest.webmanifest').then(r=>r.json()).then(m=>m.display)")
 assert display=='standalone' and abs(box('.vv-app')['height']-590)<1
 assert not errors,errors;print('PASS compact targets, changing visual height, simulated safe area and standalone manifest:',url);b.close()
