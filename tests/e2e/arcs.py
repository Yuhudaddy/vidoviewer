"""Negative-bulge arc check against a served preview, using synthetic tests/arc-check.dxf only.
Usage: python3 tests/e2e/arcs.py URL [screenshot.png]"""
import math, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else None
DXF = Path(__file__).resolve().parents[1] / 'arc-check.dxf'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
R2 = math.sqrt(2)
COLORS = {'red': (255, 0, 0), 'yellow': (255, 255, 0), 'magenta': (255, 0, 255)}
results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(detail) if detail else ''))

SCAN = """() => { const c=document.getElementById('drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 let x0=1e9,y0=1e9,x1=-1,y1=-1; for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;
 if(d[i]<90&&d[i+1]>170&&d[i+2]<90){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}
 return {x0,y0,x1,y1,dpr:c.width/c.getBoundingClientRect().width,left:c.getBoundingClientRect().left,top:c.getBoundingClientRect().top} }"""
NEAR = """([px,py,rgb]) => { const c=document.getElementById('drawing'),d=c.getContext('2d').getImageData(px-3,py-3,7,7).data;
 for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-rgb[0])<110&&Math.abs(d[i+1]-rgb[1])<110&&Math.abs(d[i+2]-rgb[2])<110) return true } return false }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-proxy-server'])
    page = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL, wait_until='networkidle')
    page.locator('#file').set_input_files(str(DXF))
    page.locator('.drawing-item', has_text='arc-check.dxf').first.click()
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    page.wait_for_timeout(300)
    f = page.evaluate(SCAN)
    sx = (f['x1'] - f['x0']) / 60; sy = (f['y1'] - f['y0']) / 40
    check('frame found, isotropic scale', f['x1'] > 0 and abs(sx - sy) < 0.05 * sx, f'{sx:.3f} {sy:.3f} dpx/unit')
    dev = lambda x, y: (round(f['x0'] + x * sx), round(f['y1'] - y * sy))
    css = lambda x, y: (dev(x, y)[0] / f['dpr'] + f['left'], dev(x, y)[1] / f['dpr'] + f['top'])
    def drawn(x, y, color): return page.evaluate(NEAR, [*dev(x, y), list(COLORS[color])])
    def side(name, on, off, color):
        check(f'{name}: 弧在正確側 {on}', drawn(*on, color))
        for o in off: check(f'{name}: 錯誤側／弦上無線 {o}', not drawn(*o, color))
    h = 5 / R2
    side('負 bulge 90° 圓心(15,15)', (15 - h, 15 - h), [(10 + h, 10 + h), (12.5, 12.5)], 'red')
    side('負 bulge -0.5 圓心(22,23.5)', (22, 26), [(22, 24), (22, 25)], 'red')
    side('正 bulge 90° 圓心(30,10)', (30 + h, 10 + h), [(35 - h, 15 - h), (32.5, 12.5)], 'yellow')
    q = 2 / R2
    for cx, cy, dx, dy in [(44, 28, -1, 1), (54, 28, 1, 1), (54, 12, 1, -1), (44, 12, -1, -1)]:
        side(f'順時針圓角 圓心({cx},{cy})', (cx + dx * q, cy + dy * q), [(cx + dx * (2 - q), cy + dy * (2 - q))], 'magenta')
    page.click('#measure')
    def lock(x, y):
        page.mouse.move(*css(x, y)); page.wait_for_timeout(120)
        c = page.locator('#drawing')
        t = c.get_attribute('data-lock-type')
        return (t, float(c.get_attribute('data-lock-x')), float(c.get_attribute('data-lock-y'))) if t else None
    def snap(name, pt, kind):
        r = lock(*pt)
        check(f'鎖點 {name} {kind} {pt}', bool(r) and r[0] == kind and abs(r[1] - pt[0]) < 1e-6 and abs(r[2] - pt[1]) < 1e-6, r)
    snap('A 端點', (15, 10), 'endpoint'); snap('A 端點', (10, 15), 'endpoint')
    snap('A 圓心', (15, 15), 'center'); snap('A 中點', (15 - h, 15 - h), 'midpoint')
    snap('B 端點', (20, 25), 'endpoint'); snap('B 端點', (24, 25), 'endpoint')
    snap('B 圓心', (22, 23.5), 'center'); snap('B 中點', (22, 26), 'midpoint')
    snap('圓角圓心', (44, 28), 'center'); snap('圓角中點', (44 - q, 28 + q), 'midpoint')
    if SHOT:
        page.mouse.move(*css(22, 26)); page.wait_for_timeout(150); page.screenshot(path=SHOT)
    page.mouse.click(*css(5, 34)); page.mouse.click(*css(15, 34)); page.wait_for_timeout(150)
    val = page.locator('#resultValue').inner_text() + page.locator('#resultUnit').inner_text()
    check('10 mm 基準線讀數', val.replace(' ', '') == '1cm', val)
    check('無頁面錯誤', not errors, errors)
    b.close()
print(f'{sum(results)}/{len(results)} passed @ {URL}')
sys.exit(0 if all(results) else 1)
