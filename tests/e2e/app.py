"""End-to-end check of a served preview with synthetic drawings only.
Usage: python3 tests/e2e/app.py URL [EVIDENCE_DIR PREFIX]
Mouse steps use real mouse input events; touch steps use Chrome's simulated touch input (not a real phone)."""
import shutil, sys, tempfile
from pathlib import Path
from request_failures import watch
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
EVIDENCE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
PREFIX = sys.argv[3] if len(sys.argv) > 3 else 'e2e'
TESTS = Path(__file__).resolve().parents[1]
ARC = (TESTS / 'arc-check.dxf').read_bytes()
NOUNIT = TESTS / 'no-unit.dxf'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
ACCENT = [76, 215, 246]
SECURE = URL.startswith('https://') or '127.0.0.1' in URL or 'localhost' in URL
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''))

def shot(page, name):
    if EVIDENCE:
        page.screenshot(path=str(EVIDENCE / f'{PREFIX}-{name}.png'))

def payload(name, data):
    return {'name': name, 'mimeType': 'application/dxf', 'buffer': data}

SCAN = """() => { const c=document.getElementById('drawing'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 let x0=1e9,y0=1e9,x1=-1,y1=-1; for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;
 if(d[i]<90&&d[i+1]>170&&d[i+2]<90){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}}
 const r=c.getBoundingClientRect(); return {x0,y0,x1,y1,dpr:c.width/r.width,left:r.left,top:r.top} }"""
NEAR = """([id,px,py,rad,rgb]) => { const c=document.getElementById(id),d=c.getContext('2d').getImageData(px-rad,py-rad,2*rad+1,2*rad+1).data;
 for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-rgb[0])<60&&Math.abs(d[i+1]-rgb[1])<60&&Math.abs(d[i+2]-rgb[2])<60) return true } return false }"""
BLUE_UI = """() => { const bad=[],props=['color','backgroundColor','borderTopColor','outlineColor','boxShadow','fill','stroke'];
 for(const el of document.querySelectorAll('.vv-app *')){ if(el.closest('.vv-pill')||el.closest('[hidden]'))continue; const cs=getComputedStyle(el);
  for(const p of props){ for(const m of (cs[p]||'').matchAll(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/g)){ if(m[4]==='0')continue; if(+m[3]-+m[1]>60) bad.push(el.tagName+'#'+el.id+'.'+el.className+' '+p+' '+m[0]) } } }
 return bad }"""
LAYOUT = """() => { const r=s=>{const e=document.querySelector(s); if(!e||e.hidden||getComputedStyle(e).display==='none'||getComputedStyle(e).visibility==='hidden')return null; const b=e.getBoundingClientRect(); return b.width?{l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height}:null};
 return {vw:innerWidth,vh:innerHeight,back:r('#open'),title:r('.vv-titlebar'),dock:r('.vv-dock'),side:r('#side .vv-zoom'),readout:r('#result'),tools:[...document.querySelectorAll('.vv-dock .vv-tool')].map(e=>{const b=e.getBoundingClientRect();return [b.width,b.height]})} }"""


class View:
    """Maps the synthetic frame (0..60 x 0..40) to screen positions by scanning the green frame pixels."""
    def __init__(self, page):
        self.page = page
        self.calibrate()

    def calibrate(self):
        self.page.wait_for_timeout(250)
        self.f = self.page.evaluate(SCAN)
        f = self.f
        self.sx = (f['x1'] - f['x0']) / 60
        self.sy = (f['y1'] - f['y0']) / 40

    def dev(self, x, y):
        return self.f['x0'] + x * self.sx, self.f['y1'] - y * self.sy

    def css(self, x, y, dx=0, dy=0):
        px, py = self.dev(x, y)
        return px / self.f['dpr'] + self.f['left'] + dx, py / self.f['dpr'] + self.f['top'] + dy

    def box(self):  # frame in CSS px
        f = self.f
        return (f['x0'] / f['dpr'] + f['left'], f['y0'] / f['dpr'] + f['top'], f['x1'] / f['dpr'] + f['left'], f['y1'] / f['dpr'] + f['top'])

    def accent(self, x, y, dx=0, dy=0, rad=1):  # dx, dy in CSS px from the world point
        px, py = self.dev(x, y)
        d = self.f['dpr']
        return self.page.evaluate(NEAR, ['drawing', round(px + dx * d), round(py + dy * d), rad, ACCENT])


def lock(page):
    c = page.locator('#drawing')
    t = c.get_attribute('data-lock-type')
    return (t, float(c.get_attribute('data-lock-x')), float(c.get_attribute('data-lock-y'))) if t else None

def readout(page):
    if page.locator('#result').is_hidden():
        return None
    return {k: page.locator('#' + i).inner_text() for k, i in [('label', 'resultLabel'), ('value', 'resultValue'), ('unit', 'resultUnit'), ('l1', 'resultLine1'), ('l2', 'resultLine2')]}

def open_tile(page, text):
    page.locator('.drawing-item', has_text=text).first.click()
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)


def layout_checks(page, view, tag):
    view.calibrate()
    L = page.evaluate(LAYOUT)
    x0, y0, x1, y1 = view.box()
    inside = lambda r: r['l'] >= 0 and r['t'] >= 0 and r['r'] <= L['vw'] + .5 and r['b'] <= L['vh'] + .5
    over = lambda a, b: a and b and a['l'] < b['r'] and b['l'] < a['r'] and a['t'] < b['b'] and b['t'] < a['b']
    check(f'{tag}: 返回在左上且至少 44px', L['back'] and L['back']['l'] <= 24 and L['back']['t'] <= 24 and min(L['back']['w'], L['back']['h']) >= 44, L['back'])
    check(f'{tag}: 面板都在可視範圍內', all(inside(L[k]) for k in ('back', 'title', 'dock') if L[k]) and (not L['side'] or inside(L['side'])), (L['vw'], L['vh']))
    check(f'{tag}: 面板互不重疊', not any(over(L[a], L[b]) for a, b in [('title', 'dock'), ('side', 'title'), ('side', 'dock'), ('back', 'dock'), ('readout', 'title'), ('readout', 'side')]))
    check(f'{tag}: 工具按鈕至少 44px', all(min(t) >= 44 for t in L['tools']), L['tools'])
    check(f'{tag}: 全圖落在標題列與 Dock 之間', y0 >= L['title']['b'] and y1 <= L['dock']['t'] and x0 >= 0 and x1 <= (L['side']['l'] if L['side'] else L['vw']), f'frame=({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}) title.b={L["title"]["b"]:.0f} dock.t={L["dock"]["t"]:.0f}')


def desktop(p):
    profile = tempfile.mkdtemp(prefix='vv-e2e-')
    launch = lambda: p.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=True, args=['--no-proxy-server'], viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx = launch()
    page = ctx.pages[0]
    errors = watch(page, URL)
    page.goto(URL, wait_until='networkidle')

    # 首頁
    text = page.locator('body').inner_text()
    check('首頁：無行銷句', '在現場看清楚' not in text and '圖面，' not in text)
    check('首頁：分頁與匯入鈕', all(s in text for s in ['最近', '收藏', '資料庫', 'VidoViewer']) and page.locator('#import').get_attribute('aria-label') == '匯入圖面')
    logo = page.evaluate("() => { const i=document.querySelector('.vv-brand img'),b=i.getBoundingClientRect(); return [i.naturalWidth,b.width,b.height] }")
    check('首頁：Logo 已載入且為 36px', logo[0] > 0 and logo[1] == 36 and logo[2] == 36, logo)
    check('首頁：沒有圖面時只有一行字，沒有讀數', page.locator('#homeEmpty').inner_text() == '還沒有圖面' and page.locator('#result').is_hidden())
    if not SECURE:
        check('HTTP 預覽標示無法離線', '無法離線' in page.locator('#toastText').inner_text())

    # 兩檔匯入、同名不覆寫、不重複匯入
    page.locator('#file').set_input_files([payload('arc-check.dxf', ARC), payload('arc-check.dxf', ARC + b'\n')])
    page.locator('.drawing-item').nth(1).wait_for()
    names = page.locator('.drawing-item .vv-tile__name').all_inner_texts()
    metas = page.locator('.drawing-item .vv-tile__meta').all_inner_texts()
    check('兩檔匯入：同名兩筆都在', names == ['arc-check.dxf', 'arc-check.dxf'], names)
    check('清單顯示檔名與格式', all(m.startswith('DXF') for m in metas), metas)
    page.locator('#file').set_input_files([payload('arc-check.dxf', ARC)])
    page.wait_for_timeout(400)
    check('重複匯入同內容不新增', page.locator('.drawing-item').count() == 2 and '已在資料庫' in page.locator('#toastText').inner_text(), page.locator('#toastText').inner_text())
    shot(page, 'home')

    # 開圖、返回鈕、閒置時沒有讀數卡
    page.locator('.drawing-item').last.click()  # 最早匯入的原始內容
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    v = View(page)
    check('開圖：檔名與隱藏單位提示', page.locator('#filename').inner_text() == 'arc-check.dxf' and page.locator('#unitHint').is_hidden())
    check('返回鈕無障礙名稱', page.locator('#open').get_attribute('aria-label') == '返回圖面清單')
    check('閒置：讀數卡隱藏且不占空間', page.locator('#result').is_hidden() and page.locator('#measurementPill').is_hidden())
    check('鎖點在 Dock 內、右側只有縮放', page.locator('.vv-dock #snap').inner_text().strip() == '鎖點' and page.locator('#side > *').count() == 1 and page.locator('#side .vv-zoom').count() == 1)
    check('介面沒有「吸附」等其他稱呼', not any(w in page.locator('body').inner_text() for w in ['吸附', '捕捉', '抓點']))
    layout_checks(page, v, '390x844')

    # 距離工具：選了工具但沒有值時仍不顯示讀數卡
    page.click('#measure')
    check('選工具後未量測：讀數卡仍隱藏', page.locator('#result').is_hidden())
    page.wait_for_timeout(250)  # 等選取的顏色轉場結束
    check('選取中的工具為白色', page.evaluate("() => getComputedStyle(document.getElementById('measure')).color") == 'rgb(255, 255, 255)')
    check('鎖點開啟為白色', page.evaluate("() => getComputedStyle(document.getElementById('snap')).color") == 'rgb(255, 255, 255)')
    blue = page.evaluate(BLUE_UI)
    check('介面元件沒有藍色', not blue, blue[:3])

    # 桌面 hover：未按鍵移近端點即出現藍色空心方框
    page.mouse.move(*v.css(5, 34, 6, 5))
    page.wait_for_timeout(150)
    check('hover：鎖到端點 (5,34)', lock(page) == ('endpoint', 5.0, 34.0), lock(page))
    check('hover：方框邊為藍色', v.accent(5, 34, -7, 0) and v.accent(5, 34, 0, 7))
    check('hover：方框內為空心', not v.accent(5, 34, -3, -3) and not v.accent(5, 34, -3, 3))
    check('hover：尚未落點，讀數卡隱藏', page.locator('#result').is_hidden())
    shot(page, 'hover-lock')
    page.mouse.move(195, 5)  # 離開畫布到標題列
    page.wait_for_timeout(150)
    check('hover 離開：方框消失', lock(page) is None and not v.accent(5, 34, -7, 0))
    page.mouse.move(*v.css(5, 34, 6, 5)); page.wait_for_timeout(150)
    page.keyboard.press('Escape'); page.wait_for_timeout(100)
    check('取消（Esc）：工具關閉且方框消失', page.locator('#measure').get_attribute('aria-pressed') == 'false' and lock(page) is None and not v.accent(5, 34, -7, 0))
    page.mouse.move(*v.css(5, 34, 9, 0)); page.wait_for_timeout(150)
    check('未選工具時 hover 不出現方框', lock(page) is None)
    page.click('#measure'); page.click('#snap')
    page.mouse.move(*v.css(5, 34, 6, 5)); page.wait_for_timeout(150)
    check('關閉鎖點：不出現方框', lock(page) is None and not v.accent(5, 34, -7, 0) and page.locator('#snap').get_attribute('aria-pressed') == 'false')
    page.click('#snap')

    # 距離 10 mm：點擊位置偏離端點數像素，落點採用鎖點座標
    page.mouse.move(*v.css(5, 34, 6, 5)); page.wait_for_timeout(120)
    page.mouse.click(*v.css(5, 34, 6, 5))
    check('放第一點後：讀數卡仍隱藏', page.locator('#result').is_hidden())
    page.mouse.move(*v.css(15, 34, -5, -6)); page.wait_for_timeout(120)
    page.mouse.click(*v.css(15, 34, -5, -6)); page.wait_for_timeout(150)
    r = readout(page)
    check('距離讀數 10 mm', r and r['label'] == '距離' and r['value'] == '1' and r['unit'] == 'cm', r)
    check('圖上膠囊 10 mm（藍）', page.locator('#measurementPill').inner_text() == '1 cm' and page.evaluate("() => getComputedStyle(document.getElementById('measurementPill')).backgroundColor") == 'rgb(76, 215, 246)')
    check('讀數為白色', page.evaluate("() => getComputedStyle(document.querySelector('.vv-readout__value')).color") == 'rgb(255, 255, 255)')
    layout_checks(page, v, '390x844 有讀數')
    OVER = """() => { const p = document.getElementById('measurementPill').getBoundingClientRect(), hit = r => r.width && p.left < r.right && r.left < p.right && p.top < r.bottom && r.top < p.bottom;
      return {pill: [Math.round(p.left), Math.round(p.top), Math.round(p.right), Math.round(p.bottom)], zoom: hit(document.querySelector('#side .vv-zoom').getBoundingClientRect()), readout: hit(document.getElementById('result').getBoundingClientRect()), inside: p.left >= 0 && p.right <= innerWidth && p.top >= 0} }"""
    def pan(dx, dy):
        sx, sy = v.css(30, 21)
        page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx + dx, sy + dy, steps=6); page.mouse.up(); page.wait_for_timeout(150)
    mid = v.css(10, 34)
    zoom = page.locator('#side .vv-zoom').bounding_box(); card = page.locator('#result').bounding_box()
    d1 = (zoom['x'] + zoom['width'] / 2 - mid[0], zoom['y'] + zoom['height'] / 2 - mid[1] + 18)
    pan(*d1); o1 = page.evaluate(OVER)
    check('膠囊：量測線移到縮放鈕下方時，膠囊避開縮放鈕', not o1['zoom'] and not o1['readout'] and o1['inside'], o1)
    pan(-d1[0], -d1[1])
    d2 = (card['x'] + card['width'] / 2 - mid[0], card['y'] + card['height'] / 2 - mid[1] + 18)
    pan(*d2); o2 = page.evaluate(OVER)
    check('膠囊：量測線移到讀數卡下方時，膠囊避開讀數卡', not o2['readout'] and not o2['zoom'] and o2['inside'], o2)
    shot(page, 'pill-avoids-readout')
    pan(-d2[0], -d2[1]); v.calibrate()
    shot(page, 'measure-10mm')
    page.click('#clear'); page.wait_for_timeout(100)
    check('清除後：讀數卡與膠囊隱藏', page.locator('#result').is_hidden() and page.locator('#measurementPill').is_hidden())

    # 面積：ok / unreliable / miss
    page.click('#area'); page.click('#areaClosed')
    page.mouse.click(*v.css(42, 20)); page.wait_for_timeout(150)
    r = readout(page)
    check('面積（負 bulge 圓角矩形）：周長 64.5664 mm、m² 與坪', r and r['label'] == '面積' and r['unit'] == 'cm²' and r['value'] == '2.77' and r['l1'] == '周長 6.4566 cm', r)
    shot(page, 'area')
    page.mouse.click(*v.css(5, 22)); page.wait_for_timeout(150)
    msg = page.locator('#noticeText').inner_text()
    check('自交多邊形：收起上一次讀數，改以提示說明且不報數字', page.locator('#result').is_hidden() and page.locator('#measurementPill').is_hidden() and page.locator('#notice').is_visible() and msg == '無法可靠量測：邊界自交', msg)
    page.mouse.click(*v.css(30, 21)); page.wait_for_timeout(150)
    check('沒點到封閉邊界：不顯示讀數', page.locator('#result').is_hidden() and page.locator('#notice').is_visible(), page.locator('#noticeText').inner_text())
    page.click('#area')

    # 瀏覽器上一頁
    page.go_back()
    page.locator('#homeScroll').wait_for(state='visible')
    check('瀏覽器上一頁：回到清單，資料仍在', page.locator('.drawing-item').count() == 2 and page.locator('#viewerLayer').is_hidden())

    # 未設定單位
    page.locator('#file').set_input_files(str(NOUNIT))
    page.locator('.drawing-item', has_text='no-unit.dxf').wait_for()
    open_tile(page, 'no-unit.dxf')
    v = View(page)
    check('單位未設定：設定視窗提醒', '來源未知' in page.locator('#unitStatus').text_content())
    page.click('#measure')
    page.mouse.click(*v.css(5, 34, 4, 4)); page.mouse.click(*v.css(15, 34, 4, -4)); page.wait_for_timeout(150)
    r = readout(page)
    check('單位未設定：距離標圖面單位', r and r['value'] == '10' and r['unit'] == '圖面單位', r)
    page.click('#area'); page.click('#areaClosed'); page.mouse.click(*v.css(30, 0)); page.wait_for_timeout(150)
    r = readout(page)
    check('單位未設定：面積不換算 m² 與坪', r and r['value'] == '2,400.00' and r['unit'] == '圖面單位²' and r['l1'] == '周長 200 圖面單位' and '未知' in r['l2'], r)
    page.click('#open')
    page.locator('#homeScroll').wait_for(state='visible')

    # 範例圖：只能從使用說明開啟，不列在首頁清單
    SAMPLE_DB = """() => new Promise((res, rej) => { const o = indexedDB.open('vidoviewer-library'); o.onsuccess = () => { const q = o.result.transaction('drawings').objectStore('drawings').getAll();
      q.onsuccess = () => { o.result.close(); res(q.result.filter(r => r.name === 'mini.dxf').map(r => ({example: !!r.example, deleted: !!r.deletedAt}))) }; q.onerror = () => rej(q.error) }; o.onerror = () => rej(o.error) })"""
    def open_example():
        page.click('#helpOpen'); page.click('#example')
        page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    def listed(name):
        found = []
        for key in ('recent', 'favorites', 'library'):
            page.click(f'#tab-{key}'); page.wait_for_timeout(120)
            found.append(page.locator('.drawing-item', has_text=name).count())
        return found
    open_example()
    check('範例圖：從使用說明開啟 mini.dxf', page.locator('#filename').inner_text() == 'mini.dxf' and page.locator('#unitHint').is_hidden())
    page.go_back(); page.locator('#homeScroll').wait_for(state='visible')
    check('範例圖：返回首頁，說明面板已關閉', page.locator('#helpSheet').is_hidden() and page.locator('#tabs').is_visible())
    open_example(); page.reload(); page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    check('範例圖：重新整理後可重開', page.locator('#filename').inner_text() == 'mini.dxf')
    page.click('#open'); page.locator('#homeScroll').wait_for(state='visible'); page.wait_for_timeout(200)
    check('範例圖不出現在最近、收藏、資料庫，且只存一份', listed('mini.dxf') == [0, 0, 0] and page.evaluate(SAMPLE_DB) == [{'example': True, 'deleted': False}], page.evaluate(SAMPLE_DB))
    page.locator('#file').set_input_files([payload('mini.dxf', (TESTS.parent / 'example' / 'mini.dxf').read_bytes())]); page.wait_for_timeout(400)
    check('使用者自行匯入同一檔：成為自己的檔案並列在資料庫，不重複儲存', page.locator('.drawing-item', has_text='mini.dxf').count() == 1 and page.evaluate(SAMPLE_DB) == [{'example': False, 'deleted': False}], page.evaluate(SAMPLE_DB))

    # 縮圖：開過的圖有 16:10 小圖，沒開過的用圖示；兩張不同圖面的小圖不同，且不含量測覆疊
    THUMB = """(name) => { const out = []; for (const t of document.querySelectorAll('.vv-tile, .vv-lrow')) { if (!t.textContent.includes(name)) continue; const img = t.querySelector('img.vv-tile__art');
      if (!img) { out.push({icon: !!t.querySelector('.vv-tile__thumb svg.vv-icon, .vv-lrow__thumb svg.vv-icon')}); continue }
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data;
      let magenta = 0, green = 0, accent = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 180 && d[i+1] < 90 && d[i+2] > 180) magenta++; if (d[i+1] > 100 && d[i+1] > d[i] + 40 && d[i+1] > d[i+2] + 40) green++; if (Math.abs(d[i]-76) < 40 && Math.abs(d[i+1]-215) < 40 && Math.abs(d[i+2]-246) < 40) accent++ }
      const b = img.getBoundingClientRect(); out.push({w: img.naturalWidth, h: img.naturalHeight, magenta, green, accent, box: [Math.round(b.width), Math.round(b.height)], data: img.src.startsWith('data:image/png'), len: img.src.length}) } return out }"""
    arc_t, plain_t = page.evaluate(THUMB, 'arc-check.dxf'), page.evaluate(THUMB, 'no-unit.dxf')
    opened = [t for t in arc_t if 'w' in t]
    check('縮圖：開過的圖為 320x200（16:10）的本機 data 圖', len(opened) == 1 and opened[0]['w'] == 320 and opened[0]['h'] == 200 and opened[0]['data'] and plain_t[0].get('w') == 320, (arc_t, plain_t))
    check('縮圖：沒開過的同名檔用圖示退路', len(arc_t) == 2 and any(t.get('icon') for t in arc_t), arc_t)
    check('縮圖：兩張不同圖面可分辨（圓角矩形只在其中一張）', opened[0]['magenta'] > 20 and plain_t[0]['magenta'] == 0 and opened[0]['green'] > 100 and plain_t[0]['green'] > 100, (opened[0], plain_t[0]))
    check('縮圖：不含量測線、鎖點框等覆疊', opened[0]['accent'] == 0 and plain_t[0]['accent'] == 0)
    shot(page, 'home-thumbs-grid')
    page.click('#viewList'); page.wait_for_timeout(200)
    arc_l = [t for t in page.evaluate(THUMB, 'arc-check.dxf') if 'w' in t]
    check('縮圖：條列同樣顯示，56px 方框內', len(arc_l) == 1 and arc_l[0]['box'] == [56, 56] and arc_l[0]['magenta'] > 20, arc_l)
    shot(page, 'home-thumbs-list')
    page.click('#viewGrid'); page.wait_for_timeout(200)

    # 清單位置：矮視窗、多筆資料
    page.set_viewport_size({'width': 390, 'height': 590})
    page.locator('#file').set_input_files([payload(f'合成圖-{i:02d}.dxf', ARC + b'\n' * (i + 2)) for i in range(10)])
    page.locator('.drawing-item').nth(13).wait_for()
    total = page.locator('.drawing-item').count()
    target = page.locator('.drawing-item').nth(9)
    target.scroll_into_view_if_needed()
    page.evaluate("() => { document.getElementById('homeScroll').scrollTop += 37 }"); page.wait_for_timeout(150)
    top = page.evaluate("() => document.getElementById('homeScroll').scrollTop")
    name = target.locator('.vv-tile__name').inner_text()
    target.click(); page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    check('清單可捲動', top > 50, top)
    page.go_back(); page.locator('#homeScroll').wait_for(state='visible'); page.wait_for_timeout(200)
    now = page.evaluate("() => document.getElementById('homeScroll').scrollTop")
    check('上一頁後清單位置保留', abs(now - top) <= 1, (top, now))
    target.click(); page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)

    # 重新整理後重開同一張圖，再按返回鈕
    page.reload()
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    check('重新整理：重開同一張圖', page.locator('#filename').inner_text() == name, name)
    v = View(page)
    layout_checks(page, v, '390x590')
    shot(page, 'view-590')
    page.click('#open'); page.locator('#homeScroll').wait_for(state='visible'); page.wait_for_timeout(200)
    now = page.evaluate("() => document.getElementById('homeScroll').scrollTop")
    check('重新整理後按返回：清單筆數與位置保留', page.locator('.drawing-item').count() == total and abs(now - top) <= 1, (total, top, now))
    home = page.evaluate("() => { const l=document.getElementById('homeScroll'); return [l.scrollWidth, l.clientWidth, document.documentElement.scrollWidth, innerWidth] }")
    check('首頁 590 高：沒有水平捲動', home[0] <= home[1] and home[2] <= home[3], home)
    shot(page, 'home-590')

    # 橫向與視窗高度變化時自動重新配置
    open_tile(page, 'arc-check.dxf')
    v = View(page)
    page.set_viewport_size({'width': 844, 'height': 390})
    layout_checks(page, v, '844x390 橫向')
    shot(page, 'view-landscape')
    page.set_viewport_size({'width': 390, 'height': 844})
    layout_checks(page, v, '回到 390x844')
    check('桌面流程無頁面錯誤', not errors, errors[:3])

    # 關閉瀏覽器後重開：資料仍在裝置本機
    if SECURE:
        page.evaluate('() => navigator.serviceWorker.ready.then(() => true)')
    ctx.close()
    ctx = launch()
    page = ctx.pages[0]
    offline_state = {'offline': False}
    errors = watch(page, URL, offline_state)
    page.goto(URL, wait_until='networkidle')
    page.click('#tab-library'); page.wait_for_timeout(150)
    check('關閉瀏覽器重開：清單仍在', page.locator('.drawing-item').count() == total, page.locator('.drawing-item').count())
    kept = [t for t in page.evaluate(THUMB, 'no-unit.dxf') if 'w' in t]
    check('關閉瀏覽器重開：縮圖仍在', len(kept) == 1 and kept[0]['green'] > 100 and page.locator('img.vv-tile__art').count() >= 3, page.locator('img.vv-tile__art').count())
    if SECURE:
        page.evaluate('() => navigator.serviceWorker.ready.then(() => true)')
        keys = page.evaluate('() => caches.keys()')
        check('SW 快取為新版且只有一份', len(keys) == 1 and keys[0].endswith('-v64'), keys)
        ctx.set_offline(True)
        offline_state['offline'] = True
        page.reload(); page.locator('.drawing-item').first.wait_for(timeout=15000)
        open_tile(page, 'arc-check.dxf')
        check('離線：重新載入後仍可開圖', page.locator('#filename').inner_text() == 'arc-check.dxf')
        ctx.set_offline(False)
    # 離線時 sw.js 刻意不攔 manifest 與 status.json（要走網路才有意義），瀏覽器記錄這兩個請求失敗是預期，不算頁面錯誤。
    unexpected = [e for e in errors if not (('/manifest.webmanifest' in e or '/status.json' in e) and 'ERR_INTERNET_DISCONNECTED' in e)]
    check('重開流程無頁面錯誤', not unexpected, unexpected[:3])
    ctx.close()
    shutil.rmtree(profile, ignore_errors=True)


def touch(p):
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-proxy-server'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = watch(page, URL)
    page.goto(URL, wait_until='networkidle')
    page.locator('#file').set_input_files([payload('arc-check.dxf', ARC)])
    page.locator('.drawing-item').first.wait_for()
    page.tap('.drawing-item')
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    v = View(page)
    cdp = ctx.new_cdp_session(page)
    def fingers(kind, *pts):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in enumerate(pts)]})
    side_hidden = lambda: 'is-hidden' in (page.locator('#side').get_attribute('class') or '')

    page.tap('#measure')
    check('模擬觸控：選工具後讀數卡隱藏', page.locator('#result').is_hidden())

    # 按住：先看到框，長按出現放大鏡，拖曳時同步
    a = v.css(5, 34, 5, 4)
    fingers('touchStart', a); page.wait_for_timeout(70)
    check('模擬觸控：按下即出現鎖點框，尚未落點', lock(page) == ('endpoint', 5.0, 34.0) and v.accent(5, 34, -7, 0) and page.locator('#result').is_hidden(), lock(page))
    page.wait_for_timeout(330)
    lens = page.evaluate("""() => { const c=document.getElementById('loupe'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let x0=1e9,y0=1e9,x1=-1,y1=-1;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4; if(Math.abs(d[i]-76)<60&&Math.abs(d[i+1]-215)<60&&Math.abs(d[i+2]-246)<60){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}
      const b=document.getElementById('loupeBox').getBoundingClientRect(); return {cx:(x0+x1)/2/c.width,cy:(y0+y1)/2/c.height,w:(x1-x0)/c.width,top:b.top,bottom:b.bottom,mid:b.left+b.width/2} }""")
    check('模擬觸控：長按出現放大鏡，位於手指上方', page.locator('#loupeBox').is_visible() and lens['bottom'] < a[1] and abs(lens['mid'] - a[0]) < 60, lens)
    check('模擬觸控：放大鏡中心就是鎖定的方框（3 倍）', abs(lens['cx'] - .5) < .03 and abs(lens['cy'] - .5) < .03 and abs(lens['w'] * 112 - 14 * 3) < 6, lens)
    check('模擬觸控：標出鎖點種類', page.locator('#lockTag').inner_text() == '端點')
    check('模擬觸控：長按時右側縮放收起', side_hidden())
    shot(page, 'touch-loupe')
    bpt = v.css(15, 34, -6, 5)
    fingers('touchMove', ((a[0] + bpt[0]) / 2, a[1])); page.wait_for_timeout(60)
    fingers('touchMove', bpt); page.wait_for_timeout(120)
    check('模擬觸控：長按拖曳時鎖點跟著更新', lock(page) == ('endpoint', 15.0, 34.0) and page.locator('#loupeBox').is_visible(), lock(page))
    back = v.css(5, 34, 7, -6)
    fingers('touchMove', back); page.wait_for_timeout(120)
    before = lock(page)
    fingers('touchEnd'); page.wait_for_timeout(80)
    check('模擬觸控：放開後放大鏡關閉、縮放回來、只有一點不顯示讀數', before == ('endpoint', 5.0, 34.0) and page.locator('#loupeBox').is_hidden() and not side_hidden() and page.locator('#result').is_hidden())
    check('模擬觸控：放開後鎖點框短暫停留', lock(page) == ('endpoint', 5.0, 34.0))
    page.wait_for_timeout(1000)
    check('模擬觸控：停留後鎖點框消失', lock(page) is None and not v.accent(5, 34, -7, 0))

    # 點一下第二點：放開前已看到框，放開採用框的座標
    tap = v.css(15, 34, 6, 6)
    fingers('touchStart', tap); page.wait_for_timeout(60)
    seen = lock(page)
    fingers('touchEnd'); page.wait_for_timeout(150)
    r = readout(page)
    check('模擬觸控：先看框再放點，讀數 10 mm', seen == ('endpoint', 15.0, 34.0) and r and r['value'] == '1' and r['unit'] == 'cm', (seen, r))
    shot(page, 'touch-measure-10mm')
    page.tap('#clear'); page.wait_for_timeout(100)
    check('模擬觸控：清除後讀數卡隱藏', page.locator('#result').is_hidden())

    # 單指平移不落點
    s = v.css(30, 21)
    fingers('touchStart', s); page.wait_for_timeout(30)
    for i in range(1, 6):
        fingers('touchMove', (s[0] + 12 * i, s[1] + 6 * i)); page.wait_for_timeout(20)
    fingers('touchEnd'); page.wait_for_timeout(150)
    old = v.box(); v.calibrate(); new = v.box()
    check('模擬觸控：單指拖曳會平移', abs((new[0] - old[0]) - 60) < 3 and abs((new[1] - old[1]) - 30) < 3, (old[:2], new[:2]))
    check('模擬觸控：平移不出現放大鏡與鎖點框', page.locator('#loupeBox').is_hidden() and lock(page) is None)
    t1 = v.css(5, 34, 4, 4)
    fingers('touchStart', t1); page.wait_for_timeout(50); fingers('touchEnd'); page.wait_for_timeout(120)
    check('模擬觸控：平移沒有落點（之後第一下仍是第一點）', page.locator('#result').is_hidden())
    page.tap('#measure'); page.tap('#measure')  # 重設量測

    # 雙指縮放不落點
    c = v.css(30, 20)
    fingers('touchStart', (c[0] - 40, c[1]), (c[0] + 40, c[1])); page.wait_for_timeout(40)
    for d in (44, 48, 52):
        fingers('touchMove', (c[0] - d, c[1]), (c[0] + d, c[1])); page.wait_for_timeout(30)
    fingers('touchEnd'); page.wait_for_timeout(150)
    w0 = new[2] - new[0]; v.calibrate(); w1 = v.box()[2] - v.box()[0]
    check('模擬觸控：雙指張開會放大', 1.15 < w1 / w0 < 1.35, (round(w0), round(w1)))
    check('模擬觸控：縮放不出現鎖點框與讀數', lock(page) is None and page.locator('#result').is_hidden() and page.locator('#loupeBox').is_hidden())
    t1 = v.css(5, 34, 4, 4)
    fingers('touchStart', t1); page.wait_for_timeout(50); fingers('touchEnd'); page.wait_for_timeout(120)
    check('模擬觸控：縮放沒有落點（之後第一下仍是第一點）', page.locator('#result').is_hidden())
    t2 = v.css(15, 34, -4, 4)
    fingers('touchStart', t2); page.wait_for_timeout(50); fingers('touchEnd'); page.wait_for_timeout(150)
    r = readout(page)
    check('模擬觸控：縮放後量測仍為 10 mm', r and r['value'] == '1' and r['unit'] == 'cm', r)

    # 返回
    page.tap('#open'); page.locator('#homeScroll').wait_for(state='visible')
    check('模擬觸控：返回鈕回到清單', page.locator('.drawing-item').count() == 1)
    check('模擬觸控流程無頁面錯誤', not errors, errors[:3])
    b.close()


with sync_playwright() as p:
    desktop(p)
    touch(p)
failed = [n for n, ok in results if not ok]
print(f'{len(results) - len(failed)}/{len(results)} passed @ {URL}')
sys.exit(1 if failed else 0)
