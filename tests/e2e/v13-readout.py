"""v13 readout and polygon interactions using only synthetic files."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1]; fixtures=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files([str(fixtures/'no-unit.dxf'),str(fixtures/'arc-check.dxf')]);page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(250)
 def frame():return page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 f=frame()
 def pt(x,y):page.mouse.click(f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 def val(x):return page.locator('#'+x).inner_text()
 def units(source=None,display=None):
  page.click('#filename')
  if source is not None:page.select_option('#sourceUnit',source)
  if display is not None:page.select_option('#displayUnit',display)
  page.click('#unitClose')
 assert page.locator('#unitHint').is_hidden()
 page.click('#measure');pt(0,0);pt(60,40)
 assert val('resultLine1')=='Δx 60 圖面單位' and val('resultLine2')=='Δy 40 圖面單位',(val('resultLine1'),val('resultLine2'))
 page.click('#clearDock');pt(60,40);pt(0,0)
 assert val('resultLine1')=='Δx -60 圖面單位' and val('resultLine2')=='Δy -40 圖面單位'
 units('mm');assert val('resultLine1')=='Δx -6 cm' and val('resultLine2')=='Δy -4 cm'
 units(display='m');assert val('resultLine1')=='Δx -0.06 m' and val('resultLine2')=='Δy -0.04 m'
 page.locator('#saveMark').focus();page.keyboard.press('Tab');assert page.evaluate('document.activeElement.id')=='clear'
 assert page.locator('#clear').evaluate("e => {let s=getComputedStyle(e);return s.outlineStyle!=='none'||s.boxShadow!=='none'}")
 for size in [(320,568),(390,590),(390,844),(844,390)]:
  page.set_viewport_size({'width':size[0],'height':size[1]});page.wait_for_timeout(100)
  rect=page.evaluate('''() => Object.fromEntries(['result','resultLabel','resultValue','resultUnit','resultLine1','resultLine2','saveMark','clear','filename','speedToggle','undoMeasurement'].map(id=>{let e=document.getElementById(id),r=e.getBoundingClientRect();return [id,{x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}]}))''')
  assert rect['resultLine1']['x']>=rect['resultValue']['right']-1 and rect['resultLine2']['y']>=rect['resultLine1']['bottom']-1,rect
  for k in ['saveMark','clear']:
   assert rect[k]['w']>=44 and rect[k]['h']>=44 and rect[k]['right']<=size[0],(size,rect)
   centered=page.locator('#'+k).evaluate('''e=>{let a=e.getBoundingClientRect(),s=e.querySelector('svg').getBoundingClientRect();return [Math.abs(a.x+a.width/2-s.x-s.width/2),Math.abs(a.y+a.height/2-s.y-s.height/2)]}''');assert max(centered)<1,centered
  assert rect['result']['y']>=rect['filename']['bottom'] and rect['result']['bottom']<rect['undoMeasurement']['y'],(size,rect)
 page.set_viewport_size({'width':390,'height':590});page.wait_for_timeout(100);f=frame()
 page.click('#saveMark');page.wait_for_function("() => document.querySelector('#clear').getAttribute('aria-label')==='刪除此標記'")
 page.reload();page.locator('#viewerLayer').wait_for(state='visible');page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList .app-mark-open').first.focus();page.keyboard.press('Enter');assert val('resultLine1')=='Δx -0.06 m' and val('resultLine2')=='Δy -0.04 m'
 page.click('#clearDock');page.click('#area');page.click('#areaClosed');f=frame();pt(30,0);assert val('resultUnit')=='m²' and val('resultLine1')=='周長 0.2 m'
 units('');assert val('resultUnit')=='圖面單位²' and val('resultLine1')=='周長 200 圖面單位' and '未知' in val('resultLine2')
 page.click('#area');page.click('#area');page.click('#polygon');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='true'
 pt(0,0);pt(60,0);assert page.locator('#result').is_hidden();pt(60,40);assert val('resultValue')=='1,200.00' and page.locator('#saveMark').is_enabled() and page.locator('#polygonActions').is_visible()
 page.click('#polygonClose');assert page.locator('#result').is_hidden();page.reload();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#polygonClose').get_attribute('aria-pressed')=='false';f=frame();pt(0,0);assert page.locator('#result').is_visible() and page.locator('#polygonActions').is_visible();page.click('#polygonBack');assert page.locator('#result').is_hidden();page.click('#polygonBack');assert '2 點' in val('polygonStatus')
 page.click('#polygonClear');pt(0,0);pt(60,40);pt(0,40);pt(60,0);pt(0,0);assert page.locator('#result').is_hidden() and '交叉' in val('noticeText');page.click('#polygonBack');assert page.locator('#notice').is_hidden()
 page.click('#polygonClear');page.click('#polygonClose');pt(0,0);pt(60,0);pt(60,40);assert page.locator('#saveMark').is_enabled();page.click('#saveMark');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='2'")
 page.reload();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#drawing').get_attribute('data-mark-count')=='2';page.click('#open');page.locator('.drawing-item',has_text='arc-check.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#drawing').get_attribute('data-mark-count')=='0';page.click('#open');page.locator('.drawing-item',has_text='no-unit.dxf').first.click();page.locator('#viewerLayer').wait_for(state='visible');assert page.locator('#drawing').get_attribute('data-mark-count')=='2'
 assert not errors,errors
 print('PASS v13 readout, signed units, icon focus, four viewports, polygon switch, save/reload/isolation:',url);b.close()
