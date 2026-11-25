"""Synthetic skipped-object warning, compact readout and long-value layout."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
s=fixture.read_text().replace('0\nENDSEC\n0\nEOF','0\nCIRCLE\n8\n0\n10\n20\n20\n20\n30\n0\n40\n3\n210\n1\n220\n0\n230\n0\n0\nENDSEC\n0\nEOF')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for w,h in [(320,568),(390,590)]:
  page=b.new_page(viewport={'width':w,'height':h},has_touch=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto(url)
  page.locator('#file').set_input_files({'name':'synthetic-tilted.dxf','mimeType':'application/dxf','buffer':s.encode()});page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
  assert page.locator('#drawingWarning').is_visible() and page.locator('#drawingWarningText').inner_text()=='已略過 1 個物件'
  page.click('#filename');page.select_option('#sourceUnit','mm');page.click('#unitClose')
  f=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''')
  page.click('#measure');page.mouse.click(f[0],f[3]);page.mouse.click(f[2],f[1]);page.wait_for_timeout(250)
  assert page.locator('#resultValue').inner_text()=='7.2111' and page.locator('#resultUnit').inner_text()=='cm'
  v=page.locator('#resultValue').bounding_box();u=page.locator('#resultUnit').bounding_box();card=page.locator('#result').bounding_box();warning=page.locator('#drawingWarning').bounding_box();close=page.locator('#drawingWarningClose').bounding_box()
  assert abs(v['y']-u['y'])<6,(w,h,v,u,card);assert card['height']<=60,(w,h,card);assert warning['y']>=card['y']+card['height'] and close['width']>=44 and close['height']>=44,(card,warning,close)
  page.screenshot(path=f'evidence/readout-warning-{w}x{h}.png');print('MEASURE',w,h,'card',card,'warning',warning,'close',close,'value',v,'unit',u)
  page.click('#clearDock');assert page.locator('#drawingWarning').is_visible();page.click('#measure') if page.locator('#measure').get_attribute('aria-pressed')=='false' else None;page.mouse.click(f[0],f[3]);page.mouse.click(f[2],f[1]);assert page.locator('#drawingWarning').is_visible()
  page.click('#filename');page.select_option('#sourceUnit','ft');page.select_option('#displayUnit','mm');page.click('#unitClose');assert page.locator('#resultValue').inner_text()=='21,979.4406' and page.locator('#resultUnit').inner_text()=='mm',(page.locator('#resultValue').inner_text(),page.locator('#resultUnit').inner_text())
  geom=page.evaluate('''() => {let val=document.querySelector('#resultValue'),unit=document.querySelector('#resultUnit'),aside=document.querySelector('.vv-readout__aside').getBoundingClientRect();return {value:[...val.getClientRects()].map(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom})),unit:[...unit.getClientRects()].map(r=>({l:r.left,r:r.right,t:r.top,b:r.bottom})),aside:{l:aside.left,r:aside.right,t:aside.top,b:aside.bottom}}}''')
  for r in geom['value']+geom['unit']:
   assert r['l']>=0 and r['r']<=w and not(r['l']<geom['aside']['r'] and geom['aside']['l']<r['r'] and r['t']<geom['aside']['b'] and geom['aside']['t']<r['b']),geom
  page.locator('#drawingWarningClose').focus();assert page.evaluate('document.activeElement.id')=='drawingWarningClose';page.keyboard.press('Enter');assert page.locator('#drawingWarning').is_hidden()
  assert not errors,errors;page.close()
 print('PASS ordinary and long readouts, persistent warning, keyboard dismissal and layouts:',url);b.close()
