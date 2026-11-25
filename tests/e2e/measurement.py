"""Synthetic measurement checks against an actual served entry point."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1]
fixtures=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},device_scale_factor=1)
 errors=[]; page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto(url); page.locator('#file').set_input_files(str(fixtures/'no-unit.dxf'))
 page.locator('.drawing-item',has_text='no-unit.dxf').first.click(); page.locator('#viewerLayer').wait_for(state='visible')
 page.wait_for_timeout(300)
 box=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}} return [x0,y0,x1,y1]}''')
 def click(x,y): page.mouse.click(box[0]+x*(box[2]-box[0])/60,box[3]-y*(box[3]-box[1])/40)
 def val(id): return page.locator('#'+id).inner_text()
 page.click('#area'); page.click('#areaClosed'); click(30,0)
 assert val('resultUnit')=='圖面單位²' and '200 圖面單位' in val('resultLine1') and '未知' in val('resultLine2')
 page.click('#filename'); page.select_option('#sourceUnit','mm'); page.click('#unitClose')
 assert val('resultValue')=='24.00' and val('resultUnit')=='cm²' and val('resultLine1')=='周長 20 cm'
 rects=page.evaluate('''() => ['#resultValue','#resultLine1','#saveMark','#clear'].map(s=>{let r=document.querySelector(s).getBoundingClientRect();return {l:r.left,r:r.right,t:r.top,b:r.bottom}})''')
 assert all(r['l']>=0 and r['r']<=390 for r in rects)
 assert all(not (a['l']<b['r'] and b['l']<a['r'] and a['t']<b['b'] and b['t']<a['b']) for a in rects[:2] for b in rects[2:]), rects
 page.click('#filename'); page.select_option('#displayUnit','m'); page.click('#unitClose')
 assert val('resultUnit')=='m²' and val('resultLine1')=='周長 0.2 m'
 page.click('#saveMark'); page.wait_for_function("() => document.querySelector('#clear').getAttribute('aria-label') === '刪除此標記'"); page.click('#clearDock'); assert page.locator('#result').is_hidden(); page.reload(); page.locator('#viewerLayer').wait_for(state='visible')
 page.click('#speedToggle'); page.click('#marksOpen'); page.locator('#marksList button').first.wait_for(); assert '0.0024' in val('marksList'); page.locator('#marksList button').first.click(); assert val('resultValue')=='0.0024'
 page.click('#clearDock'); page.click('#speedToggle'); page.click('#marksOpen'); page.locator('#marksList button').last.click(); page.get_by_text('尚無儲存的標記').wait_for(); assert '尚無' in val('marksList'); page.click('#marksClose')
 page.click('#filename'); page.select_option('#displayUnit','cm'); page.click('#unitClose')
 page.click('#area'); page.click('#polygon')
 # A two-finger zoom must never place a polygon point.
 c=page.context.new_cdp_session(page)
 def fingers(kind, points): c.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{'x':x,'y':y,'id':i} for i,(x,y) in enumerate(points)]})
 fingers('touchStart',[(150,250),(220,250)]); fingers('touchMove',[(140,250),(230,250)]); fingers('touchEnd',[])
 assert '至少 3' in val('polygonStatus')
 page.click('#fit'); page.wait_for_timeout(100)
 page.mouse.move(box[0]+3,box[3]-3); page.wait_for_timeout(100); assert page.locator('#drawing').get_attribute('data-lock-type') == 'endpoint'
 for x,y in [(0,0),(60,0),(60,40),(0,40)]: click(x,y)
 assert '4 點' in val('polygonStatus')
 click(0,0); assert val('resultValue')=='24.00' and val('resultLine1')=='周長 20 cm'
 page.click('#clearDock'); assert page.locator('#result').is_hidden()
 page.keyboard.press('Escape'); page.click('#speedToggle'); page.click('#viewerHelpOpen'); assert page.locator('#viewerHelp').is_visible(); page.click('#viewerHelpClose')
 page.set_viewport_size({'width':844,'height':390}); page.wait_for_timeout(200)
 for selector in ['#speedToggle','#area','#clearDock','#snap']:
  box2=page.locator(selector).bounding_box(); assert box2 and box2['x']>=0 and box2['x']+box2['width']<=844 and box2['y']>=0 and box2['y']+box2['height']<=390
 assert not errors,errors
 print('PASS synthetic closed object, unknown unit, conversion, polygon, clear, menu, help and layouts:',url)
 b.close()
