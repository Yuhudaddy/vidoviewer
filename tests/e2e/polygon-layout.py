"""Preview readout must remain legible and not collide with controls at small sizes."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for w,h in [(320,568),(390,590),(390,844),(844,390)]:
  page=b.new_page(viewport={'width':w,'height':h},device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(150)
  f=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
  page.click('#area');page.click('#polygon')
  for x,y in [(0,40),(60,40),(60,20)]:page.mouse.click(f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40) # 橫向時操作列會蓋住畫布下緣，三個點都取上半部
  assert page.locator('#result').is_visible() and '未知' in page.locator('#resultLine2').inner_text();page.wait_for_timeout(200)
  assert page.locator('#unitHint').is_hidden()
  rects={s:page.locator('#'+s).bounding_box() for s in ['resultValue','resultUnit','resultLine1','resultLine2','saveMark','clear','result']}
  def overlap(a,b):return a['x']<b['x']+b['width'] and b['x']<a['x']+a['width'] and a['y']<b['y']+b['height'] and b['y']<a['y']+a['height']
  for a in ['resultValue','resultUnit','resultLine1','resultLine2']:
   r=rects[a];assert r['x']>=0 and r['x']+r['width']<=w,(w,h,a,rects)
   for other in ['saveMark','clear']:assert not overlap(r,rects[other]),(w,h,a,other,rects)
  for a,other in [('resultValue','resultLine1'),('resultUnit','resultLine1'),('resultLine1','resultLine2')]:assert not overlap(rects[a],rects[other]),(w,h,a,other,rects)
  page.click('#speedToggle');menu=page.locator('#speedMenu').bounding_box();assert not overlap(rects['result'],menu),(w,h,rects,menu)
  if (w,h)==(390,590):page.click('#speedToggle');page.screenshot(path='/private/tmp/vv-polygon-live-final.png')
  assert not errors,errors;page.close();print('PASS live readout layout',w,h,url)
 b.close()
