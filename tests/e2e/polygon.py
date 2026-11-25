"""Explicit closure, undo vertex, clear, invalid geometry, saved-area selection."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files(str(fixture));page.get_by_text('1 張圖面').wait_for();assert page.locator('#homeCount').inner_text()=='1 張圖面';page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
 def scan():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 f=scan()
 def pt(x,y):return (f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 def point(x,y):page.mouse.click(*pt(x,y))
 def start():
  if page.locator('#area').get_attribute('aria-pressed')=='true':page.click('#area')
  page.click('#area');page.click('#polygon')
 start();assert page.locator('#polygonClose').get_attribute('aria-pressed')=='true'
 point(0,0);point(60,0);assert page.locator('#result').is_hidden()
 point(60,40);page.click('#polygonBack');assert '2 點' in page.locator('#polygonStatus').inner_text(),(f,page.locator('#polygonStatus').inner_text(),page.locator('#noticeText').inner_text());page.click('#polygonClear');assert '至少' in page.locator('#polygonStatus').inner_text()
 for x,y in [(0,0),(60,0),(60,40),(0,40)]:point(x,y)
 x,y=pt(0,0);page.mouse.move(x+3,y-3);page.wait_for_timeout(100);assert page.locator('#drawing').get_attribute('data-lock-x')=='0';page.mouse.click(x+3,y-3)
 assert page.locator('#resultValue').inner_text()=='2,400.00';assert page.locator('#resultLine1').inner_text()=='周長 200 圖面單位'
 page.click('#saveMark');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'");page.click('#measure');page.click('#measure');point(30,20);assert page.locator('#resultValue').inner_text()=='2,400.00';assert page.locator('#clear').get_attribute('aria-label')=='刪除此標記'
 page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList button[aria-label="刪除標記 1"]').click();page.get_by_text('尚無儲存的標記').wait_for();page.click('#marksClose');assert page.locator('#drawing').get_attribute('data-mark-count')=='0'
 start();
 for x,y in [(0,0),(60,40),(0,40),(60,0)]:point(x,y)
 assert '交叉' in page.locator('#noticeText').inner_text() and page.locator('#result').is_hidden()
 page.click('#polygonClear');
 for x,y in [(0,0),(60,0),(30,0),(30,40)]:point(x,y)
 assert '重疊' in page.locator('#noticeText').inner_text()
 page.click('#polygonClear');
 for x,y in [(0,0),(60,0),(60,40),(0,40)]:point(x,y)
 assert page.locator('#resultValue').inner_text()=='2,400.00';point(0,0)
 page.click('#zoomOut');page.wait_for_timeout(150);f=scan();start()
 for x,y in [(0,0),(60,0),(60,40),(0,40),(0,0)]:point(x,y)
 assert page.locator('#resultValue').inner_text()=='2,400.00'
 page.tap('#clearDock');page.tap('#fit');page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(100);f=scan();
 if page.locator('#area').get_attribute('aria-pressed')=='true':page.tap('#area')
 page.tap('#area');page.tap('#polygon')
 # The dismissible parse warning can cover a drawing corner in landscape.
 if page.locator('#drawingWarning').is_visible():page.tap('#drawingWarningClose')
 for x,y in [(0,0),(60,0),(60,40),(0,40),(0,0)]:page.touchscreen.tap(*pt(x,y))
 assert page.locator('#resultValue').inner_text()=='2,400.00' and page.locator('#resultLine1').inner_text()=='周長 200 圖面單位'
 assert page.locator('#notice').is_hidden();page.wait_for_timeout(300)
 assert not errors,errors
 page.screenshot(path='/private/tmp/vv-polygon.png');print('PASS polygon explicit closure, controls, invalid crossing, area selection and resize:',url);b.close()
