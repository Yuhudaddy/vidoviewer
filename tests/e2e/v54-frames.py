"""Sample the full menu and actionbar animation in actual DOM."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
 for w,h in [(320,568),(390,590),(390,844),(844,390)]:
  q=b.new_page(viewport={'width':w,'height':h},has_touch=True);q.goto(sys.argv[1]);q.locator('#file').set_input_files(str(Path('tests/no-unit.dxf').resolve()));q.locator('.drawing-item').first.click();q.locator('#viewerLayer').wait_for(state='visible');q.click('#measure');q.wait_for_timeout(550);q.click('#area');a=q.locator('#areaClosed').bounding_box();z=q.locator('#polygon').bounding_box();dock=q.locator('.vv-dock').bounding_box();assert abs((z['y']-a['y']-a['height'])-(dock['y']-z['y']-z['height']))<1,(a,z,dock)
  q.click('#areaClosed');q.wait_for_timeout(550);q.click('#measure');q.click('#area');q.evaluate("() => document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.pause())")
  result=q.evaluate('''() => {const e=document.querySelector('#dockIndicator'),a=e.getAnimations()[0],items=[...document.querySelectorAll('#areaMenu button')];let min=Infinity,hit=false;for(let t=0;t<=540;t+=10){if(a)a.currentTime=t;const r=e.getBoundingClientRect();for(const item of items){const z=item.getBoundingClientRect();min=Math.min(min,r.top-z.bottom);if(r.left<z.right&&z.left<r.right&&r.top<z.bottom&&z.top<r.bottom)hit=true}}return {min,hit}}''');assert not result['hit'],(w,h,result)
  q.evaluate("() => document.querySelector('#dockIndicator').getAnimations().forEach(a=>a.finish())");q.click('#polygon');q.wait_for_timeout(40);assert q.locator('#polygonClose svg').count()==0
  result=q.evaluate('''() => {const bubble=document.querySelector('#dockIndicator'),bar=document.querySelector('#polygonActions');for(const e of [bubble,bar])e.getAnimations().forEach(a=>a.pause());let min=Infinity;for(let t=0;t<=540;t+=10){for(const e of [bubble,bar])for(const a of e.getAnimations())a.currentTime=Math.min(t,a.effect.getTiming().duration);const r=bubble.getBoundingClientRect(),s=bar.getBoundingClientRect();min=Math.min(min,r.top-s.bottom)}return min}''');assert result>=-.75,(w,h,result)
  assert q.locator('#polygonClose').get_attribute('aria-pressed')=='true' and 'gradient' in q.locator('#polygonClose span').evaluate('e=>getComputedStyle(e).backgroundImage');assert q.locator('#polygonClose span').evaluate('e=>getComputedStyle(e).filter')!='none' and q.locator('#snap svg').evaluate('e=>getComputedStyle(e).filter')!='none'
  q.click('#polygonClose');assert q.locator('#polygonClose').get_attribute('aria-pressed')=='false' and q.locator('#polygonClose span').evaluate('e=>getComputedStyle(e).filter')=='none';q.emulate_media(reduced_motion='reduce');q.click('#polygonClose');assert q.locator('#polygonClose').get_attribute('aria-pressed')=='true' and q.evaluate("document.querySelector('#polygonClose').getAnimations().length")==0
  print('PASS',w,h,'55 samples both animations, edge gaps, toggle and reduced motion',sys.argv[1]);q.close()
 b.close()
