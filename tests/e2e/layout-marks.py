"""Layout, animated contrast and reduced-motion checks on synthetic geometry."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible')
 page.click('#measure');page.wait_for_timeout(150)
 page.click('#area');page.click('#areaClosed')
 # Inspect real animated positions while holding a timeline still; icon must darken as soon as bubble overlaps.
 page.evaluate("document.querySelector('#dockIndicator').getAnimations()[0].pause()")
 seen=[]
 for t in [0,70,130,190,260,330,430,530]:
  page.evaluate('(t)=>document.querySelector("#dockIndicator").getAnimations()[0].currentTime=t',t);page.wait_for_timeout(45)
  state=page.evaluate('''() => {const r=document.querySelector('#dockIndicator').getBoundingClientRect(),i=document.querySelector('#area svg').getBoundingClientRect();const hit=i.left<r.right&&r.left<i.right&&i.top<r.bottom&&r.top<i.bottom;return {hit,dark:document.querySelector('#area').classList.contains('is-bubble-over'),color:getComputedStyle(document.querySelector('#area svg')).color}}''')
  assert state['dark']==state['hit'],(t,state);assert state['color']==('rgb(33, 40, 48)' if state['hit'] else 'rgb(255, 255, 255)'),(t,state);seen.append(state['hit'])
 assert any(seen) and not all(seen),seen
 # Interrupt an animation while it is still moving.
 page.evaluate("document.querySelector('#measure').click()");page.wait_for_timeout(40);page.evaluate("document.querySelector('#area').click();document.querySelector('#areaClosed').click()");page.wait_for_timeout(600)
 assert page.locator('#area').get_attribute('aria-pressed')=='true'
 assert page.evaluate("getComputedStyle(document.querySelector('#snap svg')).filter")!='none';assert page.evaluate("getComputedStyle(document.querySelector('#snap span')).filter")!='none';assert 'gradient' in page.evaluate("getComputedStyle(document.querySelector('#snap span')).backgroundImage")
 page.click('#snap');assert page.locator('#snap').get_attribute('aria-pressed')=='false' and page.evaluate("getComputedStyle(document.querySelector('#snap svg')).filter")=='none';page.click('#snap')
 for w,h in [(320,568),(390,590),(390,844),(844,390)]:
  page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(120)
  if page.locator('#area').get_attribute('aria-pressed')=='true':page.click('#area')
  if page.locator('#measure').get_attribute('aria-pressed')!='true':page.click('#measure')
  page.click('#area');page.wait_for_timeout(30)
  data=page.evaluate('''() => Object.fromEntries(['areaClosed','polygon','area','dockIndicator','unitHint','speedToggle','undoMeasurement'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{l:r.left,r:r.right,t:r.top,b:r.bottom,x:(r.left+r.right)/2,y:(r.top+r.bottom)/2}]}).concat([['dock',(()=>{const r=document.querySelector('.vv-dock').getBoundingClientRect();return {t:r.top}})()]]))''')
  a,z,m=data['areaClosed'],data['polygon'],data['area'];assert abs((z['t']-a['b'])-(data['dock']['t']-z['b']))<1,(w,h,data)
  assert z['b']<=data['dock']['t'] and z['b']<=data['dockIndicator']['t']+1,(w,h,data)
  assert a['t']>=0 and a['l']>=0 and a['r']<=w,(w,h,data)
  if (w,h)==(390,590): page.screenshot(path='/private/tmp/vv-dial-latest.png')
  page.keyboard.press('Escape')
 page.set_viewport_size({'width':320,'height':568});page.click('#area');page.click('#polygon');actions=page.locator('#polygonActions').bounding_box();undo=page.locator('#undoMeasurement').bounding_box();assert actions['x']+actions['width']<=undo['x'],(actions,undo)
 page.click('#area');assert page.locator('#polygonActions').is_hidden() and page.locator('#areaMenu').is_hidden();page.click('#area');assert page.locator('#areaMenu').is_visible();page.keyboard.press('Escape');assert page.locator('#areaMenu').is_hidden()
 page.emulate_media(reduced_motion='reduce');page.click('#measure');assert page.evaluate("document.querySelector('#dockIndicator').getAnimations().length")==0
 assert not errors,errors
 print('PASS dial clearance, animated contrast, independent snap glow and reduced motion:',url);b.close()
