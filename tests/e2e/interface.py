"""Synthetic interaction checks on the served app, including reduced motion."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1)
 failures=[];page.on('pageerror',lambda e:failures.append(str(e)))
 page.goto(url); page.locator('#file').set_input_files(str(Path(__file__).resolve().parents[1]/'arc-check.dxf')); page.locator('.drawing-item').first.click(); page.locator('#viewerLayer').wait_for(state='visible')
 assert page.locator('#filename').inner_text()=='arc-check.dxf'
 assert page.locator('#unitHint').is_hidden()
 page.click('#filename'); assert page.evaluate('document.activeElement.id')=='unitPanel'; assert page.locator('#unitClose').bounding_box()['height'] >= 44; page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id')=='sourceUnit'; page.keyboard.press('Shift+Tab'); assert page.evaluate('document.activeElement.id')=='unitClose'; page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id')=='sourceUnit'
 colors=page.evaluate("""() => {const s=document.querySelector('#sourceUnit'),c=getComputedStyle(s);return [c.color,c.backgroundColor,c.colorScheme]}""")
 assert colors==['rgb(255, 255, 255)','rgb(40, 50, 59)','dark'],colors
 page.select_option('#displayUnit','mm'); page.click('#unitClose'); assert page.locator('#unitHint').is_hidden()
 page.click('#speedToggle'); assert page.locator('#speedMenu button').all_text_contents()==['使用說明','標記清單'];page.click('#speedToggle')
 page.click('#area'); assert page.locator('#areaMenu').is_visible(); assert page.locator('#areaMenu button').all_text_contents()==['封閉面積','逐點封閉']; assert page.locator('#areaMenu').bounding_box()['y'] < page.locator('#area').bounding_box()['y']; assert page.locator('#areaClosed use').get_attribute('href') != page.locator('#polygon use').get_attribute('href')
 centers=[]
 for sel in ['#areaClosed','#polygon','#area']:
  r=page.locator(sel).bounding_box(); centers.append((r['x']+r['width']/2,r['y']+r['height']/2))
 a,z=page.locator('#areaClosed').bounding_box(),page.locator('#polygon').bounding_box();dock=page.locator('.vv-dock').bounding_box();assert max(abs(centers[0][0]-centers[1][0]),abs(centers[1][0]-centers[2][0]))<1 and abs((z['y']-a['y']-a['height'])-(dock['y']-z['y']-z['height']))<1,(centers,a,z,dock)
 page.keyboard.press('Escape'); assert page.locator('#areaMenu').is_hidden() and page.locator('#area').get_attribute('aria-expanded')=='false'; page.keyboard.press('Enter'); assert page.evaluate('document.activeElement.id')=='areaClosed'; page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id')=='polygon'; page.keyboard.press('Enter'); assert page.locator('#polygon').get_attribute('aria-pressed')=='true' and page.locator('#areaMenu').is_hidden(); page.click('#area'); assert page.locator('#polygon').get_attribute('aria-pressed')=='false' and page.locator('#areaMenu').is_hidden()
 page.click('#area'); page.click('#polygon'); assert page.locator('#polygonActions').is_visible()
 css=page.evaluate("""() => {const c=getComputedStyle(document.querySelector('#drawing'));return [c.webkitUserSelect,c.webkitTouchCallout]}""")
 assert css[0]=='none' and '-webkit-touch-callout: none' in Path('design-bridge.css').read_text(),css
 # Long press at a known endpoint and drag to the next point: the displayed lock is the placed coordinate.
 page.click('#fit');page.wait_for_timeout(200)
 frame=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 def pt(x,y):return {'x':frame[0]+x*(frame[2]-frame[0])/60,'y':frame[3]-y*(frame[3]-frame[1])/40,'id':0}
 c=page.context.new_cdp_session(page); a=pt(5,34); q=pt(15,34)
 c.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[a]});page.wait_for_timeout(300);assert page.locator('#loupeBox').is_visible()
 c.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[q]});page.wait_for_timeout(120);assert page.locator('#drawing').get_attribute('data-lock-x')=='15';c.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});assert '1 點' in page.locator('#polygonStatus').inner_text()
 page.click('#clearDock'); assert '至少 3' in page.locator('#polygonStatus').inner_text(); assert page.locator('#unitHint').is_hidden()
 page.screenshot(path='/private/tmp/vv-new-ui.png')
 # Switch tools: sample the actual Web Animation mid-jump, interrupt it, and verify the new motion starts there.
 page.click('#measure'); page.wait_for_timeout(600); page.click('#area'); page.click('#areaClosed')
 sample=page.evaluate('''() => {const e=document.querySelector('#dockIndicator'),a=e.getAnimations()[0];a.currentTime=0;const from=new DOMMatrixReadOnly(getComputedStyle(e).transform);a.currentTime=130;const m=new DOMMatrixReadOnly(getComputedStyle(e).transform);return {x:m.m41,y:m.m42,startX:from.m41,startY:from.m42}}'''); assert sample['x'] > sample['startX'] and sample['y'] < sample['startY']-4,sample
 page.evaluate("document.querySelector('#measure').click()")
 resume=page.evaluate('''() => {const a=document.querySelector('#dockIndicator').getAnimations()[0];a.currentTime=0;const m=new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#dockIndicator')).transform);return {x:m.m41,y:m.m42}}''')
 assert abs(sample['x']-resume['x'])<1 and abs(sample['y']-resume['y'])<1,(sample,resume)
 page.wait_for_timeout(600); assert page.evaluate("getComputedStyle(document.querySelector('#measure svg')).color") == 'rgb(33, 40, 48)'
 snap=page.locator('#snap').get_attribute('aria-pressed');page.click('#snap');assert page.locator('#snap').get_attribute('aria-pressed') != snap and page.locator('#measure').get_attribute('aria-pressed')=='true'
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100)
 for wh in [(390,590),(390,844),(844,390)]:
  page.set_viewport_size({'width':wh[0],'height':wh[1]});page.wait_for_timeout(100)
  assert page.locator('#unitHint').is_hidden()
  page.click('#area'); a,z=page.locator('#areaClosed').bounding_box(),page.locator('#polygon').bounding_box();dock=page.locator('.vv-dock').bounding_box();assert abs((z['y']-a['y']-a['height'])-(dock['y']-z['y']-z['height']))<1,(a,z,dock)
  page.keyboard.press('Escape')
 page.emulate_media(reduced_motion='reduce');page.click('#area');page.click('#areaClosed');assert page.evaluate("document.querySelector('#dockIndicator').getAnimations().length")==0
 page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(100)
 for sel in ['#filename','#speedToggle','#area','#clearDock','#snap']:
  r=page.locator(sel).bounding_box();assert r and r['x']>=0 and r['x']+r['width']<=844 and r['y']>=0 and r['y']+r['height']<=390,(sel,r)
 page.click('#open');page.locator('#homeScroll').wait_for(state='visible'); page.emulate_media(reduced_motion='no-preference'); page.click('#tab-recent'); assert page.evaluate("document.querySelector('#tabIndicator').getAnimations().length") > 0; page.emulate_media(reduced_motion='reduce');page.click('#tab-recent');page.click('#tab-favorites')
 assert page.evaluate("document.querySelector('#tabIndicator').getAnimations().length")==0
 assert page.locator('#tab-favorites').get_attribute('aria-selected')=='true'
 assert not failures,failures
 print('PASS menu, readable unit controls, polygon long-press snap, clear, orientation and reduced motion:',url)
 b.close()
