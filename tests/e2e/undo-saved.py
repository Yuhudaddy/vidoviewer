"""Undo saved measurements atomically; all drawings are synthetic."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixtures=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files([str(fixtures/'no-unit.dxf'),str(fixtures/'arc-check.dxf')]);page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
 f=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 def point(x,y):page.mouse.click(f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 def count(n):page.wait_for_function('(n)=>document.querySelector("#drawing").dataset.markCount===String(n)',arg=n)
 def save(n):page.click('#saveMark');count(n);page.wait_for_function("() => document.querySelector('#clear').getAttribute('aria-label')==='刪除此標記'")
 def line(a,b):
  if page.locator('#measure').get_attribute('aria-pressed')=='true':page.click('#measure')
  page.click('#measure');point(*a);point(*b)
 def undo(n):page.click('#undoMeasurement');count(n);page.wait_for_timeout(120)
 def list_text():page.click('#speedToggle');page.click('#marksOpen');page.wait_for_timeout(100);s=page.evaluate("() => [...document.querySelectorAll('#marksList .vv-mark-row')].map(r=>r.querySelector('.vv-mark-row__no').textContent+'. '+[...r.querySelectorAll('.vv-mark-row__name,.vv-mark-row__value')].map(e=>e.textContent).join(' ')).join('\\n')");page.click('#marksClose');return s
 assert page.locator('#undoMeasurement').is_disabled()
 line((0,0),(60,0));save(1);line((0,40),(30,40));save(2)
 page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='arc-check.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(0);assert page.locator('#undoMeasurement').is_disabled();page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(2)
 page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(2)
 undo(1);assert page.locator('#resultValue').inner_text()=='60';page.screenshot(path='/private/tmp/vv-undo-saved.png');assert '1.' in list_text() and '2.' not in list_text()
 page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(1);assert page.locator('#resultValue').inner_text()=='60'
 undo(0);assert page.locator('#result').is_hidden() and page.locator('#undoMeasurement').is_disabled();page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(0);assert page.locator('#undoMeasurement').is_disabled()
 # Number 3 is not reused after undoing 1 and 2; manual deletion must not resurrect it.
 line((0,0),(60,0));save(1);assert '3.' in list_text();page.click('#clear');count(0);assert page.locator('#undoMeasurement').is_disabled()
 # Saved 4 and 5: failed transaction leaves both intact, retry removes 5 only.
 line((0,0),(60,0));save(1);line((0,40),(30,40));save(2);page.wait_for_timeout(250)
 page.evaluate('''() => {window.__oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){const req=window.__oldPut.call(this,value,...rest);if(value?.measurementState?.historyVersion===2 && value?.marks?.length===1)this.transaction.abort();return req}}''')
 page.click('#undoMeasurement');page.get_by_text('復原失敗，請重試').wait_for();count(2);assert page.locator('#resultValue').inner_text()=='30' and page.locator('#undoMeasurement').is_enabled()
 page.evaluate('''() => {IDBObjectStore.prototype.put=window.__oldPut}''');undo(1);assert page.locator('#resultValue').inner_text()=='60';assert '4.' in list_text() and '5.' not in list_text()
 # In-progress polygon is undone before the saved mark.
 page.click('#area');page.click('#polygon');point(0,0);point(60,0);assert '2 點' in page.locator('#polygonStatus').inner_text()
 page.wait_for_timeout(200);page.evaluate('''() => {window.__oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...rest){const req=window.__oldPut.call(this,value,...rest);if(value?.measurementState?.historyVersion===2 && value?.marks?.length===1)this.transaction.abort();return req}}''')
 page.click('#undoMeasurement');page.get_by_text('復原失敗，請重試').wait_for();page.wait_for_function("() => !document.querySelector('#undoMeasurement').disabled");assert '2 點' in page.locator('#polygonStatus').inner_text();count(1);assert page.locator('#undoMeasurement').is_enabled();page.evaluate('''() => {IDBObjectStore.prototype.put=window.__oldPut}''')
 page.click('#undoMeasurement');page.get_by_text('已選 1 點').wait_for();count(1)
 page.click('#undoMeasurement');page.get_by_text('請點選至少 3 個點').wait_for();count(1)
 page.click('#undoMeasurement');page.wait_for_function("() => !document.querySelector('#result').hidden");count(1);assert page.locator('#resultValue').inner_text()=='60'
 undo(0);assert page.locator('#undoMeasurement').is_disabled()
 # Deleting older 6 manually cannot resurrect it; undo then removes latest 7.
 line((0,0),(60,0));save(1);line((0,40),(30,40));save(2)
 page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList button[aria-label="刪除標記 6"]').click();page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'");assert '7.' in page.evaluate("() => [...document.querySelectorAll('#marksList .vv-mark-row')].map(r=>r.querySelector('.vv-mark-row__no').textContent+'. '+[...r.querySelectorAll('.vv-mark-row__name,.vv-mark-row__value')].map(e=>e.textContent).join(' ')).join('\\n')");page.click('#marksClose');undo(0);assert page.locator('#undoMeasurement').is_disabled();page.reload();page.locator('#viewerLayer').wait_for(state='visible');count(0)
 # A completed but unsaved earlier measurement is restored after undoing a later saved one.
 line((0,0),(60,0));assert page.locator('#resultValue').inner_text()=='60';line((0,40),(30,40));save(1);undo(0);assert page.locator('#resultValue').inner_text()=='60' and page.locator('#clear').get_attribute('aria-label')=='清除目前量測';page.click('#undoMeasurement');page.locator('#result').wait_for(state='hidden')
 # Switching drawings does not transfer history or mutate the other file.
 page.click('#open');page.locator('#homeScroll').wait_for(state='visible');page.locator('.drawing-item',has_text='arc-check.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');count(0);assert page.locator('#undoMeasurement').is_disabled()
 assert not errors,errors
 print('PASS saved A/B undo, persistence, stable numbering, failed transaction, polygon priority and isolation:',url);b.close()
