"""v13 toolbar and overlays: synthetic drawing, touch-sized layouts and reduced motion."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for reduced in ['reduce','no-preference']:
  page=b.new_page(viewport={'width':390,'height':590},has_touch=True,reduced_motion=reduced);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
  def frame():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
  f=frame()
  def pt(x,y):page.mouse.click(f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
  page.click('#area');page.click('#polygon');page.locator('#polygonClose').focus();page.keyboard.press('Space');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='false'
  for x,y in [(0,0),(60,0),(60,40)]:pt(x,y)
  assert page.locator('#result').is_hidden();page.click('#zoomIn');page.click('#fit');page.wait_for_timeout(150);f=frame();pt(0,0);assert page.locator('#result').is_visible()
  for w,h in [(320,568),(390,590),(390,844),(844,390)]:
   page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(350)
   page.click('#speedToggle');page.wait_for_timeout(100)
   d=page.evaluate('''() => Object.fromEntries(['result','filename','speedToggle','speedMenu','polygonActions','undoMeasurement'].map(id=>{let r=document.getElementById(id).getBoundingClientRect();return [id,{l:r.left,r:r.right,t:r.top,b:r.bottom}]}))''')
   def overlaps(a,b):return a['l']<b['r'] and b['l']<a['r'] and a['t']<b['b'] and b['t']<a['b']
   assert not overlaps(d['result'],d['speedMenu']) and not overlaps(d['polygonActions'],d['undoMeasurement']),(w,h,reduced,d)
   assert all(v['l']>=-1 and v['r']<=w+1 and v['t']>=-1 and v['b']<=h+1 for v in d.values()),(w,h,reduced,d)
   page.click('#speedToggle')
  page.click('#polygonBack');assert page.locator('#result').is_hidden();page.click('#polygonClose');assert page.locator('#result').is_visible();page.click('#polygonClear');assert page.locator('#result').is_hidden() and page.locator('#polygonClose').get_attribute('aria-pressed')=='true'
  assert not errors,errors;page.close()
 print('PASS v13 keyboard, zoom, explicit closure, reduced motion and four overlay layouts:',url);b.close()
