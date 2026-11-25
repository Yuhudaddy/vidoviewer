"""登入、離線外殼與遠端停用測試；使用本機模擬 Pages Functions。"""
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[2]
server = subprocess.Popen(['node', 'tests/auth-server.mjs'], cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
        page = browser.new_page()
        for _ in range(50):
            try:
                page.goto('http://localhost:8766/', timeout=1000)
                break
            except Exception:
                page.wait_for_timeout(100)
        assert page.url.split('?')[0] == 'http://localhost:8766/login', (page.url, page.locator('body').inner_text())
        page.goto('http://localhost:8766/login.html?next=%2F')
        assert page.url == 'http://localhost:8766/login?next=%2F'
        page.fill('[name=username]', 'test')
        page.fill('[name=password]', 'bad')
        page.click('button[type=submit]')
        page.locator('#error').wait_for(state='visible')
        page.fill('[name=username]', 'test')
        page.fill('[name=password]', 'test-password')
        page.click('button[type=submit]')
        page.locator('#helpOpen').wait_for(state='visible')
        page.wait_for_function("() => navigator.serviceWorker.controller !== null", timeout=15000)
        page.evaluate("() => fetch('/__test/slow')")
        result = page.evaluate("""async () => { const start = performance.now(); const r = await fetch('/app.js'); return {status:r.status, text:await r.text(), elapsed:performance.now()-start}; }""")
        assert result['status'] == 200 and 'Renderer' in result['text'] and 3800 <= result['elapsed'] < 5800, result['elapsed']
        page.context.clear_cookies()
        assert page.evaluate("() => fetch('/app.js').then(r => r.status)") == 401
        page.goto('http://localhost:8766/')
        page.fill('[name=username]', 'test')
        page.fill('[name=password]', 'test-password')
        page.click('button[type=submit]')
        page.locator('#helpOpen').wait_for(state='visible')
        page.context.set_offline(True)
        page.reload()
        page.locator('#helpOpen').wait_for(state='visible')
        page.context.set_offline(False)
        page.evaluate("""async () => { const r = indexedDB.open('status-test', 1); await new Promise((resolve,reject) => {r.onupgradeneeded = () => r.result.createObjectStore('data'); r.onsuccess=resolve; r.onerror=reject}); r.result.close(); }""")
        page.route('**/status.json', lambda route: route.fulfill(status=200, content_type='application/json', body='{"enabled":false,"message":"暫停使用"}'))
        page.reload()
        page.get_by_role('alert').wait_for()
        assert page.get_by_role('alert').inner_text() == '暫停使用'
        page.wait_for_function("() => Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()]).then(([r,k]) => !r.length && !k.some(x => x.startsWith('vidoviewer-')))")
        assert page.evaluate("indexedDB.databases().then(d => d.some(x => x.name === 'status-test'))")
        page.unroute('**/status.json')
        page.goto('http://localhost:8766/')
        page.click('#helpOpen')
        page.get_by_role('button', name='登出').click()
        assert page.url.split('?')[0] == 'http://localhost:8766/login', (page.url, page.locator('body').inner_text())
        page.goto('http://localhost:8766/')
        assert page.url.split('?')[0] == 'http://localhost:8766/login', (page.url, page.locator('body').inner_text())
        page.fill('[name=username]', 'second')
        page.fill('[name=password]', 'second-password')
        page.click('button[type=submit]')
        page.locator('#helpOpen').wait_for(state='visible')
        page.click('#helpOpen')
        page.get_by_role('button', name='登出').click()
        assert page.url.split('?')[0] == 'http://localhost:8766/login'
        page.goto('http://localhost:8766/')
        assert page.url.split('?')[0] == 'http://localhost:8766/login'
        browser.close()
        print('登入、離線、登出、停用、快取清除與 IndexedDB 保留測試通過')
finally:
    server.terminate()
    server.wait(timeout=5)
