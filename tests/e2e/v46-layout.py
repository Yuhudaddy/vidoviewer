"""Synthetic viewport edge spacing, animation clearance and simulated safe insets."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
def rect(page,selector):return page.locator(selector).bounding_box()
def overlap(a,b):return a['x']<b['x']+b['width']-.5 and b['x']<a['x']+a['width']-.5 and a['y']<b['y']+b['height']-.5 and b['y']<a['y']+a['height']-.5
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for w,h in [(320,568),(390,590),(390,844),(844,390)]:
  for scenario,top,bottom in [('browser',4,4),('standalone-insets',47,34)]:
   page=browser.new_page(viewport={'width':w,'height':h},has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url);page.locator('#file').set_input_files(str(fixture));page.wait_for_timeout(100)
   side=47 if scenario=='standalone-insets' and w>h else 16
   page.evaluate('''([t,b,x])=>{let s=document.documentElement.style;s.setProperty('--vv-top',t+'px');s.setProperty('--vv-dock-bottom',b+'px');s.setProperty('--vv-left',x+'px');s.setProperty('--vv-right',x+'px')}''',[top,bottom,side]);home=rect(page,'.vv-home__top');tabs=rect(page,'.vv-tabs');assert abs(home['y']-top)<1 and abs(h-(tabs['y']+tabs['height'])-bottom)<1,(w,h,scenario,home,tabs)
   if (w,h)==(390,844):page.screenshot(path=f'evidence/v47-home-{scenario}.png')
   page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.evaluate('''([t,b])=>{let s=document.querySelector('#viewerLayer').style;s.setProperty('--vv-top',t+'px');s.setProperty('--vv-dock-bottom',b+'px')}''',[top,bottom]);page.wait_for_timeout(100)
   title=rect(page,'.vv-titlebar');dock=rect(page,'.vv-dock');assert abs(title['y']-top)<1 and abs(h-(dock['y']+dock['height'])-bottom)<1,(w,h,scenario,title,dock)
   if (w,h)==(390,844):page.screenshot(path=f'evidence/v47-viewer-{scenario}.png')
   for s in ['#open','#filename','#speedToggle','#measure','#area','#clearDock','#snap','#undoMeasurement']:
    r=rect(page,s);assert r['width']>=44 and r['height']>=44 and r['x']>=side-1 and r['x']+r['width']<=w-side+1,(w,h,scenario,s,r)
   page.click('#measure');page.wait_for_timeout(550);page.click('#area');page.wait_for_timeout(100)
   a,z=rect(page,'#areaClosed'),rect(page,'#polygon');g1=z['y']-a['y']-a['height'];g2=dock['y']-z['y']-z['height'];assert abs(g1-g2)<1 and abs(g1-40)<1,(w,h,scenario,g1,g2)
   if scenario=='browser' and (w,h)==(390,590):page.screenshot(path='evidence/v46-area-menu.png')
   page.click('#areaClosed');page.wait_for_timeout(550);page.click('#measure');page.click('#area');page.evaluate("() => document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.pause())")
   for t in range(0,541,10):
    page.evaluate("t=>document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.currentTime=t)",t)
    bubble=rect(page,'#dockIndicator');a,z=rect(page,'#areaClosed'),rect(page,'#polygon');assert not overlap(bubble,a) and not overlap(bubble,z),(w,h,scenario,t,bubble,a,z)
   page.evaluate("() => document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.finish())")
   page.click('#polygon');page.wait_for_timeout(40);assert page.locator('#polygonActions').is_visible() and page.locator('#polygonClose svg').count()==0
   page.evaluate("() => {document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.pause());document.querySelector('#polygonActions').getAnimations().forEach(a=>a.pause())}")
   for t in range(0,541,10):
    page.evaluate('''t=>{for(const e of [document.querySelector('#dockIndicator'),document.querySelector('#polygonActions')])for(const a of e.getAnimations())a.currentTime=Math.min(t,a.effect.getTiming().duration)}''',t)
    bubble=rect(page,'#dockIndicator');bar=rect(page,'#polygonActions');assert bar['y']+bar['height']<=bubble['y']+.75,(w,h,scenario,t,bar,bubble)
   page.evaluate("() => document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.finish())");page.evaluate("() => document.querySelector('#polygonActions').getAnimations().forEach(a=>a.finish())");bar=rect(page,'#polygonActions');undo=rect(page,'#undoMeasurement');assert not overlap(bar,undo),(w,h,scenario,bar,undo)
   assert page.locator('#polygonClose').get_attribute('aria-pressed')=='true';page.click('#polygonClose');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='false';page.click('#polygonClose');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='true'
   assert 'gradient' in page.locator('#polygonClose span').evaluate('e=>getComputedStyle(e).backgroundImage') and page.locator('#polygonClose span').evaluate('e=>getComputedStyle(e).filter')!='none'
   if scenario=='browser' and (w,h) in [(320,568),(844,390)]:page.screenshot(path=f'evidence/v46-polygon-{w}x{h}.png')
   print('PASS',w,h,scenario,'home top/bottom',home['y'],h-tabs['y']-tabs['height'],'viewer',title['y'],h-dock['y']-dock['height'],'edges',g1,g2,'action-gap',dock['y']-bar['y']-bar['height'])
   assert not errors,errors;page.close()
 print('PASS animation sampled 55 frames, edge gaps, toggles and 8 safe-area simulations:',url);browser.close()
