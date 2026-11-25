"""Synthetic 65 MB import: sample Chrome process-tree RSS on this Mac, not iOS peak RAM."""
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
server = subprocess.Popen(['python3', 'tools/preview-server.py', '127.0.0.1', '8880', str(ROOT)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    with tempfile.TemporaryDirectory(prefix='vv-memory-') as profile, sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(profile, executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
        page=ctx.pages[0]; page.goto('http://127.0.0.1:8880/', wait_until='networkidle')
        samples=[]; stop=threading.Event()
        def sample():
            while not stop.is_set():
                lines=subprocess.check_output(['ps','-axo','pid=,ppid=,rss=,command='],text=True).splitlines()
                procs=[]
                for line in lines:
                    parts=line.strip().split(None,3)
                    if len(parts)==4:
                        try: procs.append((int(parts[0]),int(parts[1]),int(parts[2]),parts[3]))
                        except ValueError: pass
                roots={pid for pid,_,_,cmd in procs if '--user-data-dir='+profile in cmd and 'Google Chrome' in cmd}
                all_ids=set(roots)
                while True:
                    new=all_ids | {pid for pid,ppid,_,_ in procs if ppid in all_ids}
                    if new==all_ids: break
                    all_ids=new
                if roots: samples.append(sum(rss for pid,_,rss,_ in procs if pid in all_ids))
                stop.wait(.05)
        thread=threading.Thread(target=sample);thread.start()
        time.sleep(.4); baseline=max(samples)
        result=page.evaluate("""async () => { const lib=await import('/library.js');
          const block=new Uint8Array(1_000_000); block[0]=123;
          const file=new File(Array(65).fill(block),'合成大圖.dxf');
          const result=await lib.importDrawing(file); const record=await lib.getDrawing(result.id);
          return {size:record.blob.size, first:new Uint8Array(await record.blob.slice(0,1).arrayBuffer())[0]}; }""")
        time.sleep(.2);stop.set();thread.join();ctx.close()
        assert result == {'size':65_000_000,'first':123}, result
        print(f'65,000,000 bytes: Chrome process-tree RSS baseline {baseline/1024:.1f} MiB, sampled peak {max(samples)/1024:.1f} MiB, difference {(max(samples)-baseline)/1024:.1f} MiB, samples {len(samples)}')
        print('RSS sum sampled by ps approximately every 50 ms; includes shared pages and synthetic fixture creation; transient peaks and iPhone RAM not measured.')
finally:
    server.terminate(); server.wait(timeout=5)
