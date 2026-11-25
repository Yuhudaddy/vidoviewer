"""以合成 DXF 驗證 IDB v1 升級、獨立位元組與交易完整性。"""
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DATA = list((ROOT / 'tests/arc-check.dxf').read_bytes())
server = subprocess.Popen(['python3', 'tools/preview-server.py', '127.0.0.1', '8879', str(ROOT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
        page = browser.new_page()
        page.goto('http://127.0.0.1:8879/login.html')
        result = page.evaluate("""async data => {
          const bytes = new Uint8Array(data), blob = new Blob([bytes], {type:'application/dxf'});
          const v1 = await new Promise((ok, no) => { const q=indexedDB.open('vidoviewer-library',1);
            q.onupgradeneeded=()=>q.result.createObjectStore('drawings',{keyPath:'id',autoIncrement:true}); q.onsuccess=()=>ok(q.result); q.onerror=()=>no(q.error); });
          await new Promise((ok,no)=>{const tx=v1.transaction('drawings','readwrite');tx.objectStore('drawings').add({name:'舊合成圖.dxf',format:'DXF',blob,lastModified:1,extra:'保留'});tx.oncomplete=ok;tx.onabort=()=>no(tx.error)}); v1.close();
          const lib=await import('/library.js');
          const old=(await lib.listDrawings())[0], loaded=await lib.getDrawing(old.id);
          if(old.size!==bytes.length || 'blob' in old || loaded.extra!=='保留' || (await loaded.blob.arrayBuffer()).byteLength!==bytes.length) throw Error('v1 upgrade');
          const duplicate=await lib.importDrawing(new File([bytes],'同內容.dxf'));
          if(!duplicate.duplicate || duplicate.id!==old.id) throw Error('legacy dedup');
          const other=await lib.importDrawing(new File([bytes,new Uint8Array([10])],'舊合成圖.dxf'));
          if(other.id===old.id) throw Error('same-name isolation');
          let tooLarge=false; try {await lib.importDrawing({size:65_000_001,arrayBuffer:()=>{throw Error('should not read')}})} catch(e) {tooLarge=e instanceof RangeError}
          if(!tooLarge) throw Error('size limit');
          let db=await new Promise((ok,no)=>{const q=indexedDB.open('vidoviewer-library');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
          const read=async(id,store)=>new Promise((ok,no)=>{const tx=db.transaction(store);const q=tx.objectStore(store).get(id);q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
          if(!(await read(other.id,'files') instanceof ArrayBuffer)) throw Error('new file bytes');
          await new Promise((ok,no)=>{const tx=db.transaction(['drawings','files'],'readwrite'),s=tx.objectStore('drawings'),q=s.get(other.id);
            q.onsuccess=()=>s.put({...q.result,blob}); tx.objectStore('files').delete(other.id); tx.oncomplete=ok;tx.onabort=()=>no(tx.error)});
          let missing=false;try{await lib.getDrawing(other.id)}catch(e){missing=e.name==='NotFoundError'}
          if(!missing) throw Error('incorrect legacy fallback');
          await new Promise((ok,no)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put(new Uint8Array([...bytes,10]).buffer,other.id);tx.oncomplete=ok;tx.onabort=()=>no(tx.error)});
          await lib.softDelete(other.id); if(!await read(other.id,'files')) throw Error('soft delete lost data');
          await lib.restoreDrawing(other.id); await lib.purgeIfDeleted(other.id);
          if(!await read(other.id,'files') || !await read(other.id,'drawings')) throw Error('restore lost data');
          await lib.softDelete(other.id);
          const oldDelete=IDBObjectStore.prototype.delete;
          IDBObjectStore.prototype.delete=function(...args){const request=oldDelete.apply(this,args);if(this.name==='files') this.transaction.abort();return request};
          let deleteFailed=false;try{await lib.purgeIfDeleted(other.id)}catch{deleteFailed=true}finally{IDBObjectStore.prototype.delete=oldDelete}
          if(!deleteFailed || !await read(other.id,'files') || !await read(other.id,'drawings')) throw Error('aborted deletion');
          await lib.purgeIfDeleted(other.id);
          if(await read(other.id,'files') || await read(other.id,'drawings') || !await read(old.id,'drawings')) throw Error('purge isolation');
          db.close();
          const original=IDBObjectStore.prototype.add;
          IDBObjectStore.prototype.add=function(...args){const request=original.apply(this,args);if(this.name==='files') this.transaction.abort();return request};
          let failed=false; try {await lib.importDrawing(new File([bytes,new Uint8Array([11])],'交易失敗.dxf'))} catch {failed=true} finally {IDBObjectStore.prototype.add=original}
          if(!failed || (await lib.listDrawings()).some(r=>r.name==='交易失敗.dxf')) throw Error('aborted insert persisted');
          db=await new Promise((ok,no)=>{const q=indexedDB.open('vidoviewer-library');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error)});
          const fileCount=await new Promise(ok=>{const q=db.transaction('files').objectStore('files').count();q.onsuccess=()=>ok(q.result)});db.close();
          if(fileCount!==0) throw Error('aborted insert orphan');
          return {version:2, old:old.id, fileCount};
        }""", DATA)
        print('PASS v1 升級、舊 Blob、去重、同名隔離、軟刪復原、永久刪除與交易回滾', result)
        browser.close()
finally:
    server.terminate(); server.wait(timeout=5)
