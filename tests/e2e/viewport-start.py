"""Synthetic free-start closure, independent snap, touch hold, zoom and compact viewport."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for snap in [True,False]:
  page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
  def frame():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
  f=frame()
  def pt(x,y):return (f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
  def click(x,y):page.mouse.click(*pt(x,y))
  page.click('#area');page.click('#polygon');page.click('#polygonClose')
  if not snap:page.click('#snap')
  click(20,15);assert '1 點' in page.locator('#polygonStatus').inner_text()
  x,y=pt(20,15);page.mouse.move(x+21,y);page.wait_for_timeout(100);assert page.locator('#drawing').get_attribute('data-lock-type')=='polygon-start';page.mouse.move(x+24,y);page.wait_for_timeout(100);assert page.locator('#drawing').get_attribute('data-lock-type')!='polygon-start';page.mouse.click(x+15,y);assert '至少' in page.locator('#noticeText').inner_text() and '1 點' in page.locator('#polygonStatus').inner_text()
  click(45,15);click(45,30);assert '3 點' in page.locator('#polygonStatus').inner_text() and page.locator('#result').is_hidden()
  x,y=pt(20,15);page.click('#zoomIn');page.wait_for_timeout(150);x,y=195+1.35*(x-195),295+1.35*(y-295)
  c=page.context.new_cdp_session(page)
  c.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x+15,'y':y,'id':0}]});page.wait_for_timeout(300)
  state=(page.locator('#drawing').get_attribute('data-lock-type'),page.locator('#lockTag').inner_text(),page.locator('#loupeBox').is_visible(),f,(x,y));assert state[:3]==('polygon-start','起點',True),state
  c.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});assert page.locator('#result').is_visible() and '3 點' in page.locator('#polygonStatus').inner_text() and page.locator('#notice').is_hidden()
  page.click('#polygonBack');assert page.locator('#result').is_hidden();page.click('#polygonBack');assert '2 點' in page.locator('#polygonStatus').inner_text();page.click('#polygonClear');assert '至少' in page.locator('#polygonStatus').inner_text()
  page.click('#fit');page.wait_for_timeout(100);f=frame()
  for x,y in [(20,15),(45,30),(20,30),(45,15)]:click(x,y)
  x,y=pt(20,15);page.mouse.click(x+15,y);assert page.locator('#result').is_hidden() and '交叉' in page.locator('#noticeText').inner_text()
  page.click('#polygonClear')
  for x,y in [(20,15),(45,15),(45,30)]:click(x,y)
  x,y=pt(20,15);page.mouse.click(x+15,y);assert page.locator('#result').is_visible();page.click('#saveMark');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'")
  vertices=page.evaluate('''() => new Promise((resolve,reject)=>{const q=indexedDB.open('vidoviewer-library',1);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,r=db.transaction('drawings').objectStore('drawings').getAll();r.onsuccess=()=>{const points=r.result[0].marks[0].measurement.points;db.close();resolve(points)};r.onerror=()=>reject(r.error)}})''');assert len(vertices)==3 and vertices[0]!=vertices[-1],vertices
  page.reload();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#drawing').get_attribute('data-mark-count')=='1';page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList .app-mark-open').first.click();assert page.locator('#result').is_visible()
  assert not errors,errors;page.close()
 # Test source point priority against an adjacent CAD endpoint: first point is deliberately free.
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True);page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(150)
 f=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
 x=f[0]+5*(f[2]-f[0])/60;y=f[3]-34*(f[3]-f[1])/40
 page.click('#area');page.click('#polygon');page.click('#polygonClose');page.click('#snap');page.mouse.click(x+10,y+3);page.click('#snap');page.mouse.move(x,y);page.wait_for_timeout(100);assert page.locator('#drawing').get_attribute('data-lock-type')=='polygon-start';page.close()
 print('PASS free start priority, snap on/off, touch hold, zoom, crossing, back, clear and saved mark:',url);b.close()
