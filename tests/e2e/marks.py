"""Per-drawing persistent marks and state undo using synthetic DXF only."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixtures=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},device_scale_factor=1,has_touch=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files([str(fixtures/'no-unit.dxf'),str(fixtures/'arc-check.dxf')]);page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(250)
 def frame():
  return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 f=frame()
 def pt(x,y):return (f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 def point(x,y):page.mouse.click(*pt(x,y))
 def count(n):page.wait_for_function('(n)=>document.querySelector("#drawing").dataset.markCount===String(n)',arg=n)
 def save(n):page.click('#saveMark');count(n);page.wait_for_function("() => document.querySelector('#clear').getAttribute('aria-label')==='刪除此標記'")
 assert page.locator('#undoMeasurement').is_disabled()
 page.click('#measure');point(0,0);point(60,0); assert page.locator('#resultValue').inner_text()=='60';save(1)
 page.click('#measure');page.click('#measure');point(0,40);point(30,40);assert page.locator('#resultValue').inner_text()=='30';save(2)
 assert page.locator('#measurementPill').is_hidden() and page.locator('#unitHint').is_hidden();readout=page.locator('#result').bounding_box();assert '2' not in page.locator('#resultLabel').inner_text();
 for selector in ['#saveMark','#clear']:
  box=page.locator(selector).bounding_box();assert box['width']>=44 and box['height']>=44 and page.locator(selector+' svg use').count()==1
 page.click('#speedToggle');menu=page.locator('#speedMenu').bounding_box();assert menu['y']>=readout['y']+readout['height'];page.click('#speedToggle');page.screenshot(path='/private/tmp/vv-readout.png')
 page.click('#clearDock');assert page.locator('#result').is_hidden();assert page.locator('#drawing').get_attribute('data-mark-count')=='2'
 page.click('#undoMeasurement');page.locator('#result').wait_for(state='visible');assert page.locator('#resultValue').inner_text()=='30' and page.locator('#clear').get_attribute('aria-label')=='刪除此標記'; page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(2);assert page.locator('#resultValue').inner_text()=='30'
 page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(2);assert page.locator('#resultValue').inner_text()=='30'
 page.click('#measure');assert page.locator('#result').is_hidden(); f=frame();point(30,0);assert page.locator('#resultValue').inner_text()=='60';assert page.locator('#clear').get_attribute('aria-label')=='刪除此標記'
 page.click('#clear');count(1);assert page.locator('#result').is_hidden();page.wait_for_timeout(200);page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(1)
 page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList button').first.wait_for();assert '2.' in page.evaluate("() => [...document.querySelectorAll('#marksList .vv-mark-row')].map(r=>r.querySelector('.vv-mark-row__no').textContent+'. '+[...r.querySelectorAll('.vv-mark-row__name,.vv-mark-row__value')].map(e=>e.textContent).join(' ')).join('\\n')");assert page.locator('#marksList button[aria-label="刪除標記 2"]').count()==1;page.click('#marksClose')
 steps=0
 while page.locator('#undoMeasurement').is_enabled() and steps<100:
  page.click('#undoMeasurement');page.wait_for_function("() => !document.querySelector('#viewerLayer').inert");steps+=1
 assert steps>1 and page.locator('#undoMeasurement').is_disabled();page.wait_for_timeout(250);page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(0);assert page.locator('#undoMeasurement').is_disabled()
 page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='arc-check.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(0);assert page.locator('#undoMeasurement').is_disabled();page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(0)
 assert not errors,errors
 page.screenshot(path='/private/tmp/vv-marks.png');print('PASS two marks, per-drawing undo, selection, targeted deletion, reload and drawing isolation:',url);b.close()
