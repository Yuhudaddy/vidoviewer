"""Existing record fields, Blob and old unnumbered marks survive migration."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
url=sys.argv[1];fixture=Path(__file__).resolve().parents[1]/'no-unit.dxf'
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True);page=b.new_page(viewport={'width':390,'height':590});page.goto(url);page.locator('#file').set_input_files(str(fixture));page.locator('.drawing-item').first.wait_for()
 page.evaluate('''() => new Promise((resolve,reject)=>{const o=indexedDB.open('vidoviewer-library',1);o.onsuccess=()=>{const db=o.result,tx=db.transaction('drawings','readwrite'),s=tx.objectStore('drawings'),q=s.getAll();q.onsuccess=()=>{const r=q.result[0];r.extraField={keep:'yes'};r.marks=[{key:'legacy',measurement:{kind:'distance',points:[{x:0,y:0},{x:10,y:0}]},unit:null,label:'距離 10 圖面單位',extra:'keep'}];s.put(r)};tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})''')
 page.locator('.drawing-item').first.click();page.locator('#viewerLayer').wait_for(state='visible');page.wait_for_function("() => document.querySelector('#drawing').dataset.markCount==='1'");page.click('#speedToggle');page.click('#marksOpen');page.wait_for_function("() => document.querySelector('#marksList .vv-mark-row__no')?.textContent==='1' && document.querySelector('#marksList').innerText.includes('距離') && document.querySelector('#marksList').innerText.includes('10 圖面單位')");page.click('#marksClose')
 data=page.evaluate('''() => new Promise((resolve,reject)=>{const o=indexedDB.open('vidoviewer-library',1);o.onsuccess=()=>{const db=o.result,q=db.transaction('drawings').objectStore('drawings').getAll();q.onsuccess=()=>{const r=q.result[0];resolve({extra:r.extraField.keep,markExtra:r.marks[0].extra,number:r.marks[0].number,size:r.blob.size});db.close()};q.onerror=()=>reject(q.error)}})''')
 assert data=={'extra':'yes','markExtra':'keep','number':1,'size':fixture.stat().st_size},data
 print('PASS existing Blob, extra fields and legacy mark number migration:',url);b.close()
