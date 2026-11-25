"""Home screen check against a served preview: tabs, grid/list, paging, favourites, swipe, delete + undo.
Synthetic drawings only. Usage: python3 tests/e2e/home.py URL [EVIDENCE_DIR PREFIX]
Mouse steps are real mouse input; the touch section is Chrome's simulated touch, not a real phone."""
import shutil, sys, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1]
EVIDENCE = Path(sys.argv[2]) if len(sys.argv) > 2 else None
PREFIX = sys.argv[3] if len(sys.argv) > 3 else 'e2e'
ARC = (Path(__file__).resolve().parents[1] / 'arc-check.dxf').read_bytes()
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail != '' else ''))

def shot(page, name):
    if EVIDENCE:
        page.screenshot(path=str(EVIDENCE / f'{PREFIX}-{name}.png'))

DB = """() => new Promise((res, rej) => { const o = indexedDB.open('vidoviewer-library', 1);
  o.onsuccess = () => { const q = o.result.transaction('drawings').objectStore('drawings').getAll();
    q.onsuccess = () => { o.result.close(); res(q.result.map(r => ({id: r.id, name: r.name, favorite: !!r.favorite, opened: !!r.openedAt, deleted: !!r.deletedAt, size: r.blob.size}))) }; q.onerror = () => rej(q.error) };
  o.onerror = () => rej(o.error) })"""
LEGACY = """(bytes) => new Promise((res, rej) => { const o = indexedDB.open('vidoviewer-library', 1);
  o.onsuccess = () => { const tx = o.result.transaction('drawings', 'readwrite');
    tx.objectStore('drawings').add({name: '舊資料.dxf', format: 'DXF', blob: new Blob([new Uint8Array(bytes)]), lastModified: 0});
    tx.oncomplete = () => { o.result.close(); res(true) }; tx.onerror = () => rej(tx.error) };
  o.onerror = () => rej(o.error) })"""
SIZES = """() => [...document.querySelectorAll('#library .vv-tab, #library .vv-icon-btn, #library .vv-tile__star, #library .vv-fab, #library .vv-lrow__action')]
  .filter(e => e.getClientRects().length).map(e => { const b = e.getBoundingClientRect(); return Math.min(b.width, b.height) })"""
BLUE_UI = """() => { const bad=[],props=['color','backgroundColor','borderTopColor','outlineColor','boxShadow','fill','stroke'];
 for(const el of document.querySelectorAll('#library *')){ if(el.closest('[hidden]'))continue; const cs=getComputedStyle(el);
  for(const p of props){ for(const m of (cs[p]||'').matchAll(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/g)){ if(m[4]==='0')continue; if(+m[3]-+m[1]>60) bad.push(el.tagName+'.'+el.className+' '+p+' '+m[0]) } } }
 return bad }"""

def names(page):
    return page.locator('.drawing-item .vv-tile__name, .drawing-item .vv-lrow__name').all_inner_texts()

def tab(page, key):
    page.click(f'#tab-{key}'); page.wait_for_timeout(120)

def count(page):
    return None if page.locator('#viewbar').is_hidden() else int(page.locator('#homeCount').inner_text().split()[0])

def pager(page):
    return None if page.locator('#pager').is_hidden() else page.locator('#pageLabel').inner_text()

def open_named(page, name):
    page.locator('.drawing-item', has_text=name).first.click()
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)

def back(page):
    page.go_back(); page.locator('#homeScroll').wait_for(state='visible'); page.wait_for_timeout(200)

def row(page, name):
    return page.locator('.vv-lrow', has=page.locator('.vv-lrow__name', has_text=name)).first

def drag(page, locator, dx, dy=0, during=None):
    b = locator.bounding_box()
    x, y = b['x'] + b['width'] - 60, b['y'] + b['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    for i in range(1, 6):
        page.mouse.move(x + dx * i / 5, y + dy * i / 5); page.wait_for_timeout(15)
    value = during() if during else None
    page.mouse.up(); page.wait_for_timeout(350)
    return value

def is_open(locator):
    return 'is-open' in (locator.get_attribute('class') or '')

def offset(locator):  # how far the row body is shifted, in px
    return locator.locator('.vv-lrow__body').evaluate('e => new DOMMatrix(getComputedStyle(e).transform).m41')

def delete_row(page, name):
    r = row(page, name)
    r.locator('[data-action="delete"]').focus()
    page.keyboard.press('Enter'); page.wait_for_timeout(250)


def main(p):
    profile = tempfile.mkdtemp(prefix='vv-home-')
    launch = lambda: p.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=True, args=['--no-proxy-server'], viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx = launch(); page = ctx.pages[0]
    errors = []
    def watch(pg):
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    watch(page)
    page.goto(URL, wait_until='networkidle')

    # 空狀態與版面
    check('空資料庫：預設在資料庫分頁，一行字', page.locator('#tab-library').get_attribute('aria-selected') == 'true' and page.locator('#homeEmpty').inner_text() == '還沒有圖面' and count(page) is None)
    check('只有三個分頁：最近、收藏、資料庫', page.locator('.vv-tab').all_inner_texts() == ['最近', '收藏', '資料庫'], page.locator('.vv-tab').all_inner_texts())
    check('沒有大型匯入卡，匯入是右下角浮動＋', page.locator('.vv-import').count() == 0 and page.locator('#import').get_attribute('aria-label') == '匯入圖面' and page.evaluate("() => { const b = document.getElementById('import').getBoundingClientRect(); return innerWidth - b.right <= 24 && innerHeight - b.bottom <= 40 && b.width === 56 }"))
    logo = page.evaluate("() => { const i = document.querySelector('.vv-brand img'), b = i.getBoundingClientRect(); return [i.getAttribute('src'), i.naturalWidth, b.width, b.height] }")
    check('Logo：載入 96px 資產、顯示 32px（不載原圖）', logo == ['./icons/icon-96.png', 96, 32, 32], logo)
    icons = page.evaluate("() => Promise.all([32, 96, 180, 192, 512].map(s => createImageBitmap ? fetch(`./icons/icon-${s}.png`).then(r => r.blob()).then(createImageBitmap).then(b => b.width === s) : false))")
    manifest = page.evaluate("() => fetch('./manifest.webmanifest').then(r => r.json()).then(m => m.icons.map(i => i.sizes))")
    check('圖示尺寸 32、96、180、192、512 皆可載入，manifest 指向 192 與 512', all(icons) and manifest == ['192x192', '512x512'], (icons, manifest))
    tab(page, 'recent'); empty_recent = page.locator('#homeEmpty').inner_text()
    tab(page, 'favorites'); empty_fav = page.locator('#homeEmpty').inner_text()
    check('空狀態文字', (empty_recent, empty_fav) == ('沒有最近開啟的圖面', '沒有收藏'), (empty_recent, empty_fav))

    # 匯入 23 筆合成圖，另加一筆沒有開啟紀錄與收藏欄位的舊格式資料
    page.locator('#file').set_input_files([{'name': f'合成圖-{i:02d}.dxf', 'mimeType': 'application/dxf', 'buffer': ARC + b'\n' * (i + 1)} for i in range(23)])
    page.locator('.drawing-item').nth(19).wait_for()
    check('匯入後跳到資料庫並回報數量', page.locator('#tab-library').get_attribute('aria-selected') == 'true' and '已匯入 23 個' in page.locator('#toastText').inner_text() and count(page) == 23)
    page.evaluate(LEGACY, list(ARC + b' '))
    page.reload(wait_until='networkidle'); page.wait_for_timeout(300)
    tab(page, 'library')
    check('舊資料可讀：出現在資料庫', count(page) == 24 and '舊資料.dxf' in names(page), count(page))
    tab(page, 'recent')
    check('沒有開啟紀錄的資料不猜測：最近為空', page.locator('#homeEmpty').inner_text() == '沒有最近開啟的圖面' and count(page) is None)

    # 分頁：每頁 20
    tab(page, 'library')
    check('第 1 頁 20 筆、頁碼 1 / 2、上一頁停用', len(names(page)) == 20 and pager(page) == '1 / 2' and page.locator('#pagePrev').is_disabled() and page.locator('#pageNext').is_enabled())
    shot(page, 'home-grid')
    page.click('#pageNext'); page.wait_for_timeout(150)
    check('第 2 頁 4 筆、下一頁停用', len(names(page)) == 4 and pager(page) == '2 / 2' and page.locator('#pageNext').is_disabled(), names(page))
    check('換頁後回到頂端', page.evaluate("() => document.getElementById('homeScroll').scrollTop") == 0)
    tab(page, 'favorites'); tab(page, 'library')
    check('換分頁後回到第 1 頁', pager(page) == '1 / 2')

    # 最近：只列成功開啟過的，依最後開啟排序
    for name in ['合成圖-05.dxf', '合成圖-10.dxf']:
        open_named(page, name); back(page)
    page.click('#pageNext'); page.wait_for_timeout(150)
    open_named(page, '合成圖-00.dxf'); back(page)
    check('返回後仍在資料庫第 2 頁', page.locator('#tab-library').get_attribute('aria-selected') == 'true' and pager(page) == '2 / 2')
    tab(page, 'recent')
    check('最近：只列開過的，依最後開啟排序', names(page) == ['合成圖-00.dxf', '合成圖-10.dxf', '合成圖-05.dxf'] and count(page) == 3, names(page))
    tab(page, 'library')
    open_named(page, '舊資料.dxf'); back(page)
    tab(page, 'recent')
    check('舊資料開啟後才進入最近', names(page)[0] == '舊資料.dxf' and count(page) == 4, names(page))
    open_named(page, '合成圖-05.dxf'); back(page)
    check('再開一次後排到最前', names(page) == ['合成圖-05.dxf', '舊資料.dxf', '合成圖-00.dxf', '合成圖-10.dxf'], names(page))
    tab(page, 'library')
    check('資料庫仍含全部匯入', count(page) == 24)

    # 塊狀：星號與更多選單
    star = page.locator('.vv-tile', has_text='合成圖-22.dxf').locator('.vv-tile__star')
    star.click(); page.wait_for_timeout(200)
    check('星號切換收藏', page.locator('.vv-tile', has_text='合成圖-22.dxf').locator('.vv-tile__star').get_attribute('aria-pressed') == 'true')
    more = page.locator('.vv-tile', has_text='合成圖-21.dxf').locator('.vv-tile__more')
    more.click(); page.wait_for_timeout(150)
    check('更多選單：收藏與刪除，焦點在第一項', page.locator('#tileMenu').is_visible() and page.locator('#tileMenu .vv-menu__item').all_inner_texts() == ['收藏', '刪除'] and page.evaluate("() => document.activeElement.id") == 'menuFavorite')
    page.keyboard.press('Escape'); page.wait_for_timeout(100)
    check('Esc 關閉選單並把焦點還給按鈕', page.locator('#tileMenu').is_hidden() and page.evaluate("() => document.activeElement.classList.contains('vv-tile__more')"))
    more.click(); page.click('#menuFavorite'); page.wait_for_timeout(200)
    tab(page, 'favorites')
    check('收藏分頁列出兩筆', sorted(names(page)) == ['合成圖-21.dxf', '合成圖-22.dxf'] and count(page) == 2, names(page))
    page.reload(wait_until='networkidle'); page.wait_for_timeout(300)
    check('重新整理後收藏仍在、分頁保留', page.locator('#tab-favorites').get_attribute('aria-selected') == 'true' and sorted(names(page)) == ['合成圖-21.dxf', '合成圖-22.dxf'])
    page.locator('.vv-tile', has_text='合成圖-21.dxf').locator('.vv-tile__more').click()
    label = page.locator('#menuFavoriteLabel').inner_text()
    page.click('#menuFavorite'); page.wait_for_timeout(200)
    check('更多選單可取消收藏', label == '取消收藏' and names(page) == ['合成圖-22.dxf'], (label, names(page)))

    # 條列與檢視偏好
    tab(page, 'library')
    page.click('#pageNext'); page.wait_for_timeout(120)
    page.click('#viewList'); page.wait_for_timeout(200)
    check('切到條列並回到第 1 頁', page.locator('.vv-lrow').count() == 20 and page.locator('.vv-tile').count() == 0 and pager(page) == '1 / 2' and page.locator('#viewList').get_attribute('aria-pressed') == 'true')
    check('條列顯示檔名、格式與收藏標示', page.locator('.vv-lrow__meta').first.inner_text().startswith('DXF') and row(page, '合成圖-22.dxf').locator('.vv-lrow__fav').count() == 1 and row(page, '合成圖-20.dxf').locator('.vv-lrow__fav').count() == 0)
    page.reload(wait_until='networkidle'); page.wait_for_timeout(300)
    check('重新整理後記得條列', page.locator('.vv-lrow').count() == 20 and page.locator('#viewList').get_attribute('aria-pressed') == 'true')
    sizes = page.evaluate(SIZES)
    check('首頁可點目標至少 44px', sizes and min(sizes) >= 44, min(sizes))
    blue = page.evaluate(BLUE_UI)
    check('首頁介面沒有藍色', not blue, blue[:3])

    # 滑動：左滑揭露、右滑收合、未過門檻彈回、上限 144、一次一列、放開不開圖
    r1, r2 = row(page, '合成圖-20.dxf'), row(page, '合成圖-19.dxf')
    peak = drag(page, r1, -300, during=lambda: offset(r1))
    check('左滑跟手且上限 144px', abs(peak + 144) < 1, peak)
    check('左滑超過門檻：停在展開，露出收藏與刪除', is_open(r1) and abs(offset(r1) + 144) < 1 and r1.locator('.vv-lrow__action').all_inner_texts() == ['收藏', '刪除'])
    check('滑動放開不會開圖', page.locator('#viewerLayer').is_hidden())
    shot(page, 'home-list-swipe')
    drag(page, r2, -100)
    check('一次只展開一列', is_open(r2) and not is_open(r1))
    drag(page, r2, 100)
    check('右滑收合', not is_open(r2) and abs(offset(r2)) < 1)
    drag(page, r1, -40)
    check('左滑 40px 未過 72px 門檻：彈回', not is_open(r1) and abs(offset(r1)) < 1 and page.locator('#viewerLayer').is_hidden())
    slow = drag(page, r1, -9, 0, during=lambda: offset(r1))
    check('橫移未超過 10px 不啟動滑動', slow == 0, slow)
    if page.locator('#viewerLayer').is_visible():  # 9px 內放開等同點一下，會開圖
        back(page)
    drag(page, r1, -100)
    r2.locator('.drawing-item').click(); page.wait_for_timeout(300)
    check('有列展開時點其他列：只收合不開圖', not is_open(r1) and page.locator('#viewerLayer').is_hidden())
    drag(page, r1, -100)
    page.evaluate("() => { document.getElementById('homeScroll').scrollTop = 120 }"); page.wait_for_timeout(200)
    check('捲動時收合', not is_open(r1))
    page.evaluate("() => { document.getElementById('homeScroll').scrollTop = 0 }"); page.wait_for_timeout(150)
    before = page.locator('#viewerLayer').is_hidden()
    drag(page, r1, 4, 60)
    check('垂直拖曳不展開、不開圖', before and not is_open(r1) and page.locator('.vv-lrow.is-open').count() == 0 and page.locator('#viewerLayer').is_hidden())

    # 鍵盤替代：動作鈕可聚焦、聚焦即露出
    page.locator('#viewList').focus()
    reached = []
    for _ in range(8):
        page.keyboard.press('Tab')
        reached.append(page.evaluate("() => { const a = document.activeElement; return (a.dataset.action || (a.classList.contains('drawing-item') ? 'open' : a.id)) + '@' + (a.closest('.vv-lrow')?.querySelector('.vv-lrow__name').textContent || '') }"))
    check('鍵盤 Tab 可依序到達每一列的收藏、刪除與開啟', reached[:6] == ['favorite@舊資料.dxf', 'delete@舊資料.dxf', 'open@舊資料.dxf', 'favorite@合成圖-22.dxf', 'delete@合成圖-22.dxf', 'open@合成圖-22.dxf'], reached[:6])
    fav = r1.locator('[data-action="favorite"]')
    fav.focus(); page.keyboard.press('Tab'); page.keyboard.press('Shift+Tab'); page.wait_for_timeout(300)
    check('鍵盤聚焦動作鈕時該列露出', abs(offset(r1) + 144) < 1, offset(r1))
    page.keyboard.press('Enter'); page.wait_for_timeout(300)
    check('鍵盤 Enter 收藏', row(page, '合成圖-20.dxf').locator('.vv-lrow__fav').count() == 1)
    check('已收藏的列動作變成取消收藏', row(page, '合成圖-20.dxf').locator('[data-action="favorite"]').inner_text() == '取消收藏')

    # 刪除與復原：同一筆資料（收藏、開啟紀錄、Blob）一起回來，位置不變
    open_named(page, '合成圖-20.dxf'); back(page)
    before_names, before_db = names(page), {r['name']: r for r in page.evaluate(DB)}
    drag(page, row(page, '合成圖-20.dxf'), -100)
    row(page, '合成圖-20.dxf').locator('[data-action="delete"]').click(); page.wait_for_timeout(300)
    check('刪除後該列立刻消失、數量減一、出現復原', '合成圖-20.dxf' not in names(page) and count(page) == 23 and page.locator('#toastText').inner_text() == '已刪除' and page.locator('#toastUndo').is_visible())
    tab(page, 'recent'); gone_recent = '合成圖-20.dxf' not in names(page)
    tab(page, 'favorites'); gone_fav = '合成圖-20.dxf' not in names(page)
    check('刪除後也從最近與收藏消失', gone_recent and gone_fav)
    gap = page.evaluate("() => document.getElementById('tabs').getBoundingClientRect().top - document.getElementById('toast').getBoundingClientRect().bottom")
    check('復原提示在底部分頁上方 12px', abs(gap - 12) <= 1, gap)
    shot(page, 'home-delete-toast')
    tab(page, 'library')
    page.click('#toastUndo'); page.wait_for_timeout(300)
    after_db = {r['name']: r for r in page.evaluate(DB)}
    check('復原：回到原位置', names(page) == before_names and count(page) == 24 and page.locator('#toast').is_hidden(), names(page)[:4])
    check('復原：同一筆 id、Blob 大小、收藏與開啟紀錄都在', after_db['合成圖-20.dxf'] == before_db['合成圖-20.dxf'] and after_db['合成圖-20.dxf']['favorite'] and after_db['合成圖-20.dxf']['opened'], after_db['合成圖-20.dxf'])
    tab(page, 'recent')
    check('復原後回到最近的第一筆', names(page)[0] == '合成圖-20.dxf', names(page))
    tab(page, 'library')

    # 5 秒後才真的刪除
    delete_row(page, '合成圖-19.dxf')
    mid_db = [r for r in page.evaluate(DB) if r['name'] == '合成圖-19.dxf']
    check('復原時限內本機副本還在（標記為待刪）', len(mid_db) == 1 and mid_db[0]['deleted'])
    page.wait_for_timeout(5600)
    check('5 秒後提示消失且本機副本已刪除', page.locator('#toast').is_hidden() and not [r for r in page.evaluate(DB) if r['name'] == '合成圖-19.dxf'] and count(page) == 23)

    # 連續刪除：每一筆各有自己的 5 秒，可一次復原多筆
    flags = lambda: {r['name']: r for r in page.evaluate(DB)}
    delete_row(page, '合成圖-18.dxf'); delete_row(page, '合成圖-17.dxf')
    db = flags()
    check('連續刪除：兩筆都還在本機（待刪），提示合併為 2 個', db['合成圖-18.dxf']['deleted'] and db['合成圖-17.dxf']['deleted'] and count(page) == 21 and page.locator('#toastText').inner_text() == '已刪除 2 個' and page.locator('#toastUndo').is_visible(), page.locator('#toastText').inner_text())
    shot(page, 'home-delete-multi')
    page.click('#toastUndo'); page.wait_for_timeout(300)
    db = flags()
    check('復原多筆：兩筆都回來', {'合成圖-18.dxf', '合成圖-17.dxf'} <= set(names(page)) and count(page) == 23 and not db['合成圖-18.dxf']['deleted'] and not db['合成圖-17.dxf']['deleted'] and page.locator('#toast').is_hidden())

    # 各自計時：先刪的先到期，後刪的仍可復原
    delete_row(page, '合成圖-18.dxf'); page.wait_for_timeout(3000)
    delete_row(page, '合成圖-17.dxf'); page.wait_for_timeout(1000)
    db = flags()
    check('第一筆滿 4 秒仍未被提前永久刪除', '合成圖-18.dxf' in db and page.locator('#toastText').inner_text() == '已刪除 2 個')
    page.wait_for_timeout(1700)
    db = flags()
    check('第一筆滿 5 秒後永久刪除，第二筆仍在時限內', '合成圖-18.dxf' not in db and db['合成圖-17.dxf']['deleted'] and page.locator('#toastText').inner_text() == '已刪除' and page.locator('#toastUndo').is_visible(), page.locator('#toastText').inner_text())
    page.click('#toastUndo'); page.wait_for_timeout(300)
    check('只復原仍在時限內的那一筆', '合成圖-17.dxf' in names(page) and '合成圖-18.dxf' not in names(page) and count(page) == 22)

    # 跨分頁連刪：資料庫刪一筆、收藏刪一筆，再到最近按復原
    delete_row(page, '合成圖-15.dxf')
    tab(page, 'favorites')
    delete_row(page, '合成圖-22.dxf')
    check('跨分頁連刪：提示仍合併顯示', page.locator('#toastText').inner_text() == '已刪除 2 個' and '合成圖-22.dxf' not in names(page))
    tab(page, 'recent')
    page.click('#toastUndo'); page.wait_for_timeout(300)
    db = flags()
    tab(page, 'favorites'); fav_back = '合成圖-22.dxf' in names(page)
    tab(page, 'library')
    check('跨分頁復原：兩筆回來且收藏保留', fav_back and db['合成圖-22.dxf']['favorite'] and '合成圖-15.dxf' in names(page) and count(page) == 22)

    # 重新整理中斷：時限內的多筆都能再復原；超過時限則定案
    delete_row(page, '合成圖-15.dxf'); delete_row(page, '合成圖-14.dxf')
    page.reload(wait_until='networkidle'); page.wait_for_timeout(400)
    check('刪除兩筆後立刻重新整理：仍不在清單，並再次提供復原', not {'合成圖-15.dxf', '合成圖-14.dxf'} & set(names(page)) and page.locator('#toastText').inner_text() == '已刪除 2 個' and page.locator('#toastUndo').is_visible(), page.locator('#toastText').inner_text())
    page.click('#toastUndo'); page.wait_for_timeout(300)
    check('重新整理後復原兩筆成功', {'合成圖-15.dxf', '合成圖-14.dxf'} <= set(names(page)) and count(page) == 22)
    delete_row(page, '合成圖-16.dxf')
    page.goto('about:blank'); page.wait_for_timeout(5600)
    page.goto(URL, wait_until='networkidle'); page.wait_for_timeout(400)
    check('離開頁面超過時限再回來：已定案刪除，資料庫無殘留', '合成圖-16.dxf' not in names(page) and not [r for r in page.evaluate(DB) if r['name'] == '合成圖-16.dxf'] and count(page) == 21 and page.locator('#toastUndo').is_hidden())

    # 最後一頁清空
    page.click('#pageNext'); page.wait_for_timeout(150)
    last = names(page)
    check('第 2 頁只剩一筆', len(last) == 1 and pager(page) == '2 / 2', last)
    delete_row(page, last[0])
    check('最後一頁刪空：回到第 1 頁且頁碼隱藏', len(names(page)) == 20 and pager(page) is None and count(page) == 20)
    page.click('#toastUndo'); page.wait_for_timeout(300)
    check('復原後回到第 2 頁那一筆', names(page) == last and pager(page) == '2 / 2', (names(page), pager(page)))

    # 返回與重新整理保留分頁、頁碼、檢視
    open_named(page, last[0]); back(page)
    check('瀏覽器上一頁：仍在資料庫、第 2 頁、條列', page.locator('#tab-library').get_attribute('aria-selected') == 'true' and pager(page) == '2 / 2' and page.locator('.vv-lrow').count() == 1)
    open_named(page, last[0]); page.reload(); page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    page.click('#open'); page.locator('#homeScroll').wait_for(state='visible'); page.wait_for_timeout(200)
    check('重新整理重開後按返回：仍在第 2 頁', pager(page) == '2 / 2' and names(page) == last)

    # 搜尋：依檔名篩選目前分頁，分頁碼跟著結果，清除回到原清單
    page.click('#pagePrev'); page.wait_for_timeout(150)
    page.locator('#searchToggle').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(150)
    check('搜尋鈕開啟輸入欄並聚焦', page.locator('#searchBar').is_visible() and page.evaluate("() => document.activeElement.id") == 'searchInput' and page.locator('#searchToggle').get_attribute('aria-expanded') == 'true')
    page.keyboard.type('DXF'); page.wait_for_timeout(200)
    check('搜尋不分大小寫：21 筆分兩頁', count(page) == 21 and pager(page) == '1 / 2' and len(names(page)) == 20)
    page.click('#pageNext'); page.wait_for_timeout(150)
    check('搜尋結果第 2 頁 1 筆', len(names(page)) == 1 and pager(page) == '2 / 2')
    page.fill('#searchInput', '合成圖-0'); page.wait_for_timeout(200)
    hits = names(page)
    check('改關鍵字回到第 1 頁，只列符合檔名的', hits and all('合成圖-0' in n for n in hits) and count(page) == len(hits) < 20 and pager(page) is None, hits)
    shot(page, 'home-search')
    tab(page, 'favorites')
    page.fill('#searchInput', '22'); page.wait_for_timeout(200)
    check('搜尋只篩選目前分頁（收藏）', names(page) == ['合成圖-22.dxf'], names(page))
    page.fill('#searchInput', 'zzz'); page.wait_for_timeout(200)
    check('沒有符合時顯示一行字', page.locator('#homeEmpty').inner_text() == '找不到符合的圖面' and count(page) is None)
    page.click('#searchClear'); page.wait_for_timeout(200)
    check('清除鈕回到原清單並留在輸入欄', sorted(names(page)) == ['合成圖-20.dxf', '合成圖-22.dxf'] and page.input_value('#searchInput') == '' and page.evaluate("() => document.activeElement.id") == 'searchInput')
    tab(page, 'library')
    page.fill('#searchInput', '合成圖-0'); page.wait_for_timeout(150)
    page.locator('#searchInput').focus(); page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check('Esc 關閉搜尋、回到原清單、焦點回搜尋鈕', page.locator('#searchBar').is_hidden() and count(page) == 21 and pager(page) == '1 / 2' and page.evaluate("() => document.activeElement.id") == 'searchToggle')

    # 使用說明面板
    HELP = ['右下角的＋匯入 DWG 或 DXF', 'LINE 或雲端收到的圖，先存到 iPhone 的「檔案」再匯入', '單指移動，雙指縮放', '選工具後點圖面放點；面積可選封閉物件或逐點封閉', '長按會出現放大鏡，放開才定點',
            '「鎖點」開著時，點會吸到端點、中點、圓心、交點', '按「儲存標記」才會加入標記清單，原檔不會被改動', '點圖面檔名可設定來源單位與顯示單位', '條列模式往左滑，可以收藏或刪除']
    page.locator('#helpOpen').focus(); page.keyboard.press('Enter'); page.wait_for_timeout(300)
    check('問號用鍵盤開啟說明，焦點在關閉鈕', page.locator('#helpSheet').is_visible() and page.evaluate("() => document.activeElement.id") == 'helpClose' and page.locator('#helpSheet').get_attribute('role') == 'dialog')
    shown = HELP
    check('說明顯示本版可用的九條，最下面是開啟範例圖', page.locator('#helpList li:visible').all_inner_texts() == shown and len(shown) == 9 and page.locator('#example').inner_text() == '開啟範例圖', page.locator('#helpList li:visible').count())
    check('九條說明皆符合目前功能', page.locator('#helpList li').evaluate_all('els => els.map(e => e.textContent)') == HELP and page.locator('#helpList li[hidden]').evaluate_all('els => els.map(e => e.dataset.topic)') == [])
    check('說明開著時底部分頁與加號不顯示', page.locator('#tabs').is_hidden() and page.locator('#import').is_hidden())
    inside = []
    for _ in range(5):
        page.keyboard.press('Tab'); inside.append(page.evaluate("() => !!document.activeElement.closest('#helpSheet')"))
    check('Tab 焦點留在面板內', all(inside), inside)
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check('Esc 關閉說明，焦點回問號，分頁與加號回來', page.locator('#helpSheet').is_hidden() and page.evaluate("() => document.activeElement.id") == 'helpOpen' and page.locator('#tabs').is_visible() and page.locator('#import').is_visible())
    page.click('#helpOpen'); page.click('#helpClose'); page.wait_for_timeout(150)
    closed_by_button = page.locator('#helpSheet').is_hidden()
    page.click('#helpOpen'); page.mouse.click(100, 30); page.wait_for_timeout(150)
    check('叉與點面板外都能關閉', closed_by_button and page.locator('#helpSheet').is_hidden())
    page.click('#helpOpen'); page.click('#example')
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    check('開啟範例圖進入看圖', page.locator('#filename').inner_text() == 'mini.dxf')
    back(page)
    seen = []
    for key in ('recent', 'favorites', 'library'):
        tab(page, key); seen.append('mini.dxf' in names(page))
    check('返回後範例圖不在任何清單，資料庫筆數不變', seen == [False, False, False] and count(page) == 21 and any(r['name'] == 'mini.dxf' for r in page.evaluate(DB)), seen)

    # 底部分頁與加號：並排不重疊、在捲動區外，最後一列不被蓋住
    for w, h in [(390, 844), (390, 590), (320, 568), (844, 390)]:
        page.set_viewport_size({'width': w, 'height': h}); page.wait_for_timeout(200)
        m = page.evaluate("""() => { const s = document.getElementById('homeScroll'); s.scrollTop = s.scrollHeight; const box = e => e.getBoundingClientRect(), rows = document.querySelectorAll('.vv-lrow'), last = box(rows[rows.length - 1]), usage = box(document.getElementById('usage')), fab = box(document.getElementById('import')), tabs = box(document.getElementById('tabs'));
          const out = {last: Math.round(last.bottom), usage: Math.round(usage.bottom), top: Math.round(Math.min(tabs.top, fab.top)), gap: Math.round(fab.left - tabs.right), inView: tabs.left >= 0 && fab.right <= innerWidth && fab.bottom <= innerHeight && tabs.bottom <= innerHeight, centred: Math.abs((tabs.top + tabs.bottom) / 2 - (fab.top + fab.bottom) / 2) <= 1,
            outside: !s.contains(document.getElementById('tabs')) && !s.contains(document.getElementById('import')), noOverflow: s.scrollWidth <= s.clientWidth, tabSizes: [...document.querySelectorAll('.vv-tab')].map(t => [Math.round(box(t).width), Math.round(box(t).height)])}; s.scrollTop = 0; return out }""")
        check(f'{w}x{h}：分頁與加號相距 12px、垂直置中、都在畫面內且在捲動區外', m['gap'] == 12 and m['centred'] and m['inView'] and m['outside'] and all(t[0] >= 64 and t[1] >= 44 for t in m['tabSizes']), m)
        check(f'{w}x{h}：捲到底時最後一列與頁尾都在底部分頁上方、無水平捲動', m['last'] <= m['top'] and m['usage'] <= m['top'] and m['noOverflow'], m)
        shot(page, f'home-list-{w}x{h}')
        page.click('#helpOpen'); page.wait_for_timeout(250)
        hs = page.evaluate("() => { const b = document.getElementById('helpSheet').getBoundingClientRect(), l = document.getElementById('example').getBoundingClientRect(); return {top: b.top, bottom: b.bottom, link: l.bottom <= innerHeight && l.top >= 0, left: b.left, right: b.right, vw: innerWidth, vh: innerHeight} }")
        check(f'{w}x{h}：說明面板在畫面內，開啟範例圖看得到', hs['top'] >= 0 and hs['bottom'] <= hs['vh'] and hs['left'] >= 0 and hs['right'] <= hs['vw'] and hs['link'], hs)
        shot(page, f'home-help-{w}x{h}')
        page.keyboard.press('Escape'); page.wait_for_timeout(150)
    page.set_viewport_size({'width': 390, 'height': 844})
    check('流程無頁面錯誤', not errors, errors[:3])

    # 關閉瀏覽器重開
    expect_recent_first = last[0]
    ctx.close()
    ctx = launch(); page = ctx.pages[0]; watch(page)
    page.goto(URL, wait_until='networkidle'); page.wait_for_timeout(300)
    check('重開瀏覽器：預設最近、條列偏好保留、最後開啟的在最前', page.locator('#tab-recent').get_attribute('aria-selected') == 'true' and page.locator('.vv-lrow').count() >= 1 and names(page)[0] == expect_recent_first, names(page)[:2])
    tab(page, 'favorites')
    check('重開瀏覽器：收藏仍在', sorted(names(page)) == ['合成圖-20.dxf', '合成圖-22.dxf'], names(page))
    tab(page, 'library')
    check('重開瀏覽器：資料庫筆數不變', count(page) == 21, count(page))
    check('重開流程無頁面錯誤', not errors, errors[:3])
    ctx.close()
    shutil.rmtree(profile, ignore_errors=True)


def touch(p):
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=['--no-proxy-server'])
    ctx = b.new_context(viewport={'width': 390, 'height': 590}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.goto(URL, wait_until='networkidle')
    page.locator('#file').set_input_files([{'name': f'合成圖-{i:02d}.dxf', 'mimeType': 'application/dxf', 'buffer': ARC + b'\n' * (i + 1)} for i in range(12)])
    page.locator('.drawing-item').nth(11).wait_for()
    page.tap('#viewList'); page.wait_for_timeout(200)
    cdp = ctx.new_cdp_session(page)
    def finger(kind, *pts):
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': 0} for x, y in pts]})
    def swipe(locator, dx, dy):
        bx = locator.bounding_box(); x, y = bx['x'] + bx['width'] - 80, bx['y'] + bx['height'] / 2
        finger('touchStart', (x, y)); page.wait_for_timeout(30)
        for i in range(1, 9):
            finger('touchMove', (x + dx * i / 8, y + dy * i / 8)); page.wait_for_timeout(20)
        finger('touchEnd'); page.wait_for_timeout(400)
    r1 = row(page, '合成圖-10.dxf')
    swipe(r1, -130, 4)
    check('模擬觸控：左滑展開且不開圖', is_open(r1) and page.locator('#viewerLayer').is_hidden())
    swipe(r1, 130, -3)
    check('模擬觸控：右滑收合', not is_open(r1))
    top = page.evaluate("() => document.getElementById('homeScroll').scrollTop")
    swipe(r1, 6, -140)
    now = page.evaluate("() => document.getElementById('homeScroll').scrollTop")
    check('模擬觸控：垂直滑動是捲動清單，不展開也不開圖', now > top + 60 and page.locator('.vv-lrow.is-open').count() == 0 and page.locator('#viewerLayer').is_hidden(), (top, now))
    page.evaluate("() => { document.getElementById('homeScroll').scrollTop = 0 }"); page.wait_for_timeout(150)
    swipe(r1, -130, 0)
    r1.locator('[data-action="delete"]').tap(); page.wait_for_timeout(300)
    check('模擬觸控：滑開後點刪除，出現復原', count(page) == 11 and page.locator('#toastUndo').is_visible())
    page.tap('#toastUndo'); page.wait_for_timeout(300)
    check('模擬觸控：點復原放回', count(page) == 12 and '合成圖-10.dxf' in names(page))
    row(page, '合成圖-09.dxf').locator('.drawing-item').tap()
    page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
    check('模擬觸控：點一下列可開圖', page.locator('#filename').inner_text() == '合成圖-09.dxf')
    b.close()


with sync_playwright() as p:
    main(p)
    touch(p)
failed = [n for n, ok in results if not ok]
print(f'{len(results) - len(failed)}/{len(results)} passed @ {URL}')
sys.exit(1 if failed else 0)
