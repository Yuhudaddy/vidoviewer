"""合成 DXF 的持久化、讀取失效出口及去重回歸；不讀取客戶檔。"""
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DATA = (ROOT / 'tests/arc-check.dxf').read_bytes()
URL = 'http://127.0.0.1:8876/'
server = subprocess.Popen(['python3', 'tools/preview-server.py', '127.0.0.1', '8876', str(ROOT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with tempfile.TemporaryDirectory(prefix='vv-import-') as profile, sync_playwright() as p:
        def launch():
            ctx = p.chromium.launch_persistent_context(profile, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
            ctx.add_init_script("""(() => { const original = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function() {
              const mode = localStorage.getItem('test-read-failure');
              return mode ? Promise.reject(new DOMException('測試讀取失敗', mode)) : original.call(this);
            }; })()""")
            return ctx
        ctx = launch(); page = ctx.pages[0]
        page.goto(URL, wait_until='networkidle')
        def upload(name, data=DATA):
            page.locator('#file').set_input_files({'name':name, 'mimeType':'application/dxf', 'buffer':data})
            page.locator('.drawing-item', has_text=name).first.wait_for()
        upload('合成圖.dxf')
        info = page.evaluate("""async () => { const lib = await import('/library.js'); const rows = await lib.listDrawings();
          const b = rows[0].blob; return {count:rows.length, blob:b instanceof Blob, file:b instanceof File, bytes:Array.from(new Uint8Array(await b.arrayBuffer()))}; }""")
        assert info['count'] == 1 and info['blob'] and not info['file'] and bytes(info['bytes']) == DATA, info
        upload('合成圖.dxf')
        page.get_by_text('1 個已在資料庫').wait_for()
        assert page.evaluate("async () => (await (await import('/library.js')).listDrawings()).length") == 1
        restored = page.evaluate("""async () => { const lib = await import('/library.js'); const before = (await lib.listDrawings())[0];
          await lib.softDelete(before.id); const result = await lib.importDrawing(new File([before.blob], before.name));
          return result.id === before.id && !result.duplicate && !(await lib.getDrawing(before.id)).deletedAt; }""")
        assert restored
        ctx.close(); ctx = launch(); page = ctx.pages[0]; page.goto(URL, wait_until='networkidle')
        page.locator('.drawing-item', has_text='合成圖.dxf').click()
        page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
        page.wait_for_function('history.state && history.state.drawingId')
        page = ctx.new_page(); page.goto(URL, wait_until='networkidle'); page.locator('#homeScroll').wait_for(state='visible')
        upload('圖二.dxf', DATA + b'\n')
        page.evaluate("localStorage.setItem('test-read-failure', 'NotFoundError')")
        page.locator('.drawing-item', has_text='合成圖.dxf').click()
        page.locator('#dialogText').wait_for(state='visible')
        assert page.locator('#dialogText').inner_text() == '這張圖的資料已失效，請重新匯入。'
        assert page.locator('#dialogConfirm').inner_text() == '刪除這筆'
        page.click('#dialogConfirm')
        page.locator('#toastUndo').wait_for(state='visible')
        assert page.locator('.drawing-item', has_text='合成圖.dxf').count() == 0
        assert page.locator('.drawing-item', has_text='圖二.dxf').count() == 1
        page.click('#toastUndo')
        page.locator('.drawing-item', has_text='合成圖.dxf').wait_for()
        page.evaluate("localStorage.setItem('test-read-failure', 'NotReadableError')")
        page.locator('.drawing-item', has_text='合成圖.dxf').click()
        page.locator('#dialogText').wait_for(state='visible')
        assert page.locator('#dialogConfirm').inner_text() == '重試'
        assert page.locator('#dialogText').inner_text() != '這張圖的資料已失效，請重新匯入。'
        page.evaluate("localStorage.removeItem('test-read-failure')")
        page.click('#dialogConfirm')
        page.locator('#viewerLayer').wait_for(state='visible', timeout=30000)
        stale = page.evaluate("""async () => { const lib = await import('/library.js'); const row = (await lib.listDrawings())[0];
          const input = new File([await row.blob.arrayBuffer()], '重匯合成圖.dxf'); const original = Blob.prototype.slice;
          Blob.prototype.slice = function(...args) { Blob.prototype.slice = original; return {arrayBuffer: () => Promise.reject(new DOMException('missing', 'NotFoundError'))}; };
          try { const result = await lib.importDrawing(input); return !result.duplicate && result.id !== row.id; }
          finally { Blob.prototype.slice = original; } }""")
        assert stale
        ctx.close()
        print('合成 DXF：Blob 位元組、重啟、去重、失效刪除復原、其他錯誤與重試通過')
finally:
    server.terminate(); server.wait(timeout=5)
