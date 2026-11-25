"""Render deterministic 30 fps frames with local Chromium and FFmpeg; no network or media assets."""
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True, args=['--allow-file-access-from-files'])
 page=browser.new_page(viewport={'width':1080,'height':1350},device_scale_factor=1)
 page.goto((root/'index.html').as_uri()+'?render=1'); page.wait_for_load_state('load')
 ff=subprocess.Popen(['ffmpeg','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','png','-i','-','-an','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(root/'navigation-loop.mp4')],stdin=subprocess.PIPE)
 try:
  for frame in range(120):
   page.evaluate('(t)=>window.seek(t)',frame/30)
   ff.stdin.write(page.screenshot(type='png'))
 finally:
  ff.stdin.close(); code=ff.wait(); browser.close()
 if code: raise SystemExit(code)
