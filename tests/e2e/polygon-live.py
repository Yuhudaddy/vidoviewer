"""Live polygon results, invalid geometry, explicit close and saved-mark preservation."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 page=b.new_page(viewport={'width':390,'height':590},has_touch=True,device_scale_factor=1);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_timeout(200)
 f=page.evaluate('''() => {const c=document.querySelector('#drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){let i=(y*c.width+x)*4;if(d[i]<90&&d[i+1]>170&&d[i+2]<90){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}return [x0,y0,x1,y1]}''')
 def point(x,y):page.mouse.click(f[0]+x*(f[2]-f[0])/60,f[3]-y*(f[3]-f[1])/40)
 def val(id):return page.locator('#'+id).inner_text()
 def toggle():page.click('#area')
 def enter_polygon():toggle();page.click('#polygon')
 toggle();page.click('#areaClosed');point(30,0);page.click('#saveMark');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'")
 toggle();assert page.locator('#areaMenu').is_hidden() and page.locator('#area').get_attribute('aria-pressed')=='false' and page.locator('#drawing').get_attribute('data-mark-count')=='1'
 enter_polygon();assert page.locator('#polygonClose').get_attribute('aria-pressed')=='true'
 assert page.locator('#result').is_hidden()
 point(0,0);point(60,0);assert page.locator('#result').is_hidden()
 point(60,40);page.wait_for_timeout(200);page.screenshot(path='/private/tmp/vv-polygon-live-v41.png');assert val('resultValue')=='1,200.00' and val('resultUnit')=='圖面單位²' and val('resultLine1')=='周長 172.111 圖面單位' and '未知' in val('resultLine2');assert page.locator('#saveMark').is_enabled()
 page.click('#polygonBack');assert page.locator('#result').is_hidden();point(60,40)
 page.click('#filename');page.select_option('#sourceUnit','mm');page.click('#unitClose');assert val('resultValue')=='12.00' and val('resultUnit')=='cm²' and val('resultLine1')=='周長 17.2111 cm'
 page.click('#filename');page.select_option('#displayUnit','m');page.click('#unitClose');assert val('resultValue')=='0.0012' and val('resultUnit')=='m²' and val('resultLine1')=='周長 0.1721 m';page.click('#filename');page.select_option('#displayUnit','cm');page.click('#unitClose')
 point(0,0);assert val('resultLabel')=='面積' and page.locator('#polygonActions').is_visible() and page.locator('#saveMark').is_enabled()
 page.click('#undoMeasurement');page.locator('#polygonActions').wait_for(state='visible');assert val('resultLabel')=='面積' and page.locator('#saveMark').is_enabled() and page.locator('#drawing').get_attribute('data-mark-count')=='1';point(0,0);assert val('resultLabel')=='面積'
 toggle();assert page.locator('#areaMenu').is_hidden() and page.locator('#drawing').get_attribute('data-mark-count')=='1';enter_polygon()
 for x,y in [(0,0),(60,40),(0,40)]:point(x,y)
 assert page.locator('#result').is_visible();point(60,0);assert page.locator('#result').is_hidden() and '交叉' in val('noticeText')
 page.click('#polygonBack');assert page.locator('#result').is_visible() and page.locator('#notice').is_hidden()
 page.click('#filename');page.select_option('#sourceUnit','');page.click('#unitClose');assert val('resultUnit')=='圖面單位²' and '未知' in val('resultLine2')
 page.click('#polygonClear');point(0,0);point(30,0);point(60,0);assert page.locator('#result').is_hidden() and ('重疊' in val('noticeText') or '無法計算' in val('noticeText'))
 toggle();page.click('#speedToggle');page.click('#marksOpen');page.locator('#marksList .app-mark-open').wait_for();styles=page.locator('#marksList .app-mark-open').evaluate("e => {const s=getComputedStyle(e);return [s.backgroundColor,s.borderTopWidth,s.borderRightWidth,s.borderBottomWidth,s.borderLeftWidth]}");assert styles==['rgba(0, 0, 0, 0)','0px','0px','0px','0px'],styles;page.locator('#marksList .app-mark-open').focus();page.keyboard.press('Enter');assert page.locator('#marksDialog').is_hidden() and page.locator('#drawing').get_attribute('data-mark-count')=='1' and page.locator('#result').is_visible()
 assert not errors,errors
 page.screenshot(path='/private/tmp/vv-live-synthetic.png');print('PASS live polygon, invalid geometry, units, exit, saved mark and keyboard:',url);b.close()
