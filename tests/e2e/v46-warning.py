"""Synthetic warning and readout must not overlap menus or undo in landscape."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
s=Path('tests/no-unit.dxf').read_text().replace('0\nENDSEC\n0\nEOF','0\nCIRCLE\n8\n0\n10\n20\n20\n20\n30\n0\n40\n3\n210\n1\n220\n0\n230\n0\n0\nENDSEC\n0\nEOF')
def overlap(a,b):return a['x']<b['x']+b['width']-.5 and b['x']<a['x']+a['width']-.5 and a['y']<b['y']+b['height']-.5 and b['y']<a['y']+a['height']-.5
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for w,h in [(320,568),(390,590),(600,390),(700,390),(844,390)]:
  q=b.new_page(viewport={'width':w,'height':h},has_touch=True);q.goto(sys.argv[1]);q.locator('#file').set_input_files({'name':'synthetic-tilted.dxf','mimeType':'application/dxf','buffer':s.encode()});q.locator('.drawing-item').first.click();q.locator('#viewerLayer').wait_for(state='visible');q.wait_for_timeout(150)
  f=q.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let a=1e9,b=1e9,x=-1,y=-1;for(let j=0;j<c.height;j++)for(let i=0;i<c.width;i++){let k=(j*c.width+i)*4;if(d[k]<90&&d[k+1]>170&&d[k+2]<90){a=Math.min(a,i);b=Math.min(b,j);x=Math.max(x,i);y=Math.max(y,j)}}return [a,b,x,y]}''');q.click('#measure');q.mouse.click(f[0],f[3]);q.mouse.click(f[2],f[1]);q.wait_for_timeout(100)
  assert q.locator('#drawingWarning').is_visible();q.click('#area');q.wait_for_timeout(200)
  items={s:q.locator(s).bounding_box() for s in ['#areaClosed','#polygon','#result','#drawingWarning','#undoMeasurement','#side .vv-zoom','#measurementPill']}
  for menu in ['#areaClosed','#polygon']:
   for other in ['#result','#drawingWarning','#undoMeasurement','#side .vv-zoom','#measurementPill']:
    if items[other]:assert not overlap(items[menu],items[other]),(w,h,menu,other,items)
  q.screenshot(path=f'evidence/v46-warning-menu-{w}x{h}.png');q.keyboard.press('Escape');q.click('#speedToggle');q.wait_for_timeout(100);items={s:q.locator(s).bounding_box() for s in ['#speedMenu','#result','#drawingWarning','#undoMeasurement','#measurementPill']}
  for other in ['#result','#drawingWarning','#undoMeasurement','#measurementPill']:assert not overlap(items['#speedMenu'],items[other]),(w,h,'speed',other,items)
  print('PASS warning/menu/readout/undo',w,h,sys.argv[1]);q.close()
 b.close()
