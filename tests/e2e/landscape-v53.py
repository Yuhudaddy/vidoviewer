"""Synthetic landscape: four actual endpoints, gestures, snap, close, undo and persistence."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':844,'height':390},has_touch=True,device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
 def scan():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
 def scan_blue():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<130&&d[k+1]>170&&d[k+2]>190){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
 page.click('#area');page.click('#polygon');page.click('#polygonClose');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='false';f=scan()
 def pt(x,y):return (f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 corners=[pt(0,0),pt(60,0),pt(60,40),pt(0,40)]
 for x,y in corners:assert page.evaluate('''([x,y])=>document.elementFromPoint(x,y)?.id==='drawing' ''',[x,y]),(f,x,y)
 page.screenshot(path='evidence/v53-landscape-endpoints.png')
 # Use actual touch gestures for endpoint selection and closure.
 c=page.context.new_cdp_session(page)
 def touch(kind,points):c.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i} for i,(x,y) in enumerate(points)]})
 # Verify the snap preview at the actual visible endpoint, then place all four via touch.
 x,y=corners[0];touch('touchStart',[(x+3,y-3)]);page.wait_for_timeout(280);assert page.locator('#drawing').get_attribute('data-lock-type')=='endpoint' and page.locator('#loupeBox').is_visible();touch('touchEnd',[])
 for x,y in corners[1:]:
  assert page.evaluate('''([x,y])=>document.elementFromPoint(x,y)?.id==='drawing' ''',[x,y]),(x,y)
  page.touchscreen.tap(x,y)
 assert '4 點' in page.locator('#polygonStatus').inner_text() and page.locator('#result').is_hidden()
 x,y=corners[0];touch('touchStart',[(x+8,y-2)]);page.wait_for_timeout(260);assert page.locator('#drawing').get_attribute('data-lock-type')=='polygon-start';touch('touchEnd',[])
 assert page.locator('#result').is_visible() and page.locator('#resultValue').inner_text()=='2,400.00' and page.locator('#resultLine1').inner_text()=='周長 200 圖面單位';assert page.locator('#polygonActions').is_visible();page.screenshot(path='evidence/v53-landscape-complete.png')
 # Panning and pinch zoom remain available and do not add vertices.
 before=scan_blue();assert before[2]>before[0],before
 touch('touchStart',[(600,185)]);touch('touchMove',[(635,185)]);touch('touchEnd',[]);moved=scan_blue();assert moved[0]>before[0]+20 and '4 點' in page.locator('#polygonStatus').inner_text(),(before,moved)
 touch('touchStart',[(570,195),(625,195)]);touch('touchMove',[(560,195),(635,195)]);touch('touchEnd',[]);zoomed=scan_blue();assert zoomed[2]-zoomed[0]>moved[2]-moved[0]+10 and '4 點' in page.locator('#polygonStatus').inner_text() and page.locator('#resultValue').inner_text()=='2,400.00',(moved,zoomed)
 page.click('#polygonBack');assert page.locator('#result').is_hidden() and '4 點' in page.locator('#polygonStatus').inner_text();page.click('#undoMeasurement');page.locator('#result').wait_for(state='visible');assert page.locator('#resultValue').inner_text()=='2,400.00'
 page.click('#saveMark');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'");page.reload();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#drawing').get_attribute('data-mark-count')=='1'
 page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList .app-mark-open').first.click();assert page.locator('#resultValue').inner_text()=='2,400.00';page.click('#open');page.locator('#homeScroll').wait_for(state='visible');assert not errors,errors
 print('PASS landscape 4 endpoints, pan/pinch, snap/hold, closure, result, undo, saved reload and back:',url);b.close()
