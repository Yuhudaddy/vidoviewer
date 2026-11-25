#!/usr/bin/env python3
"""Static preview server. Usage: preview-server.py HOST PORT ROOT [HOURS]
Serves regular files under ROOT only (no symlinks, no dotfiles, GET/HEAD only)."""
import sys
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Timer
from urllib.parse import unquote, urlsplit

HOST, PORT, ROOT = sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]).resolve()
HOURS = float(sys.argv[4]) if len(sys.argv) > 4 else 0
CSP = "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def allowed(self):
        rel = unquote(urlsplit(self.path).path).lstrip('/') or 'index.html'
        parts = Path(rel).parts
        if any(p.startswith('.') or p == '..' for p in parts):
            return False
        f = ROOT / rel
        return f.is_file() and not f.is_symlink() and f.resolve().is_relative_to(ROOT)

    def do_GET(self):
        super().do_GET() if self.allowed() else self.send_error(404)

    def do_HEAD(self):
        super().do_HEAD() if self.allowed() else self.send_error(404)

    def do_POST(self):
        self.send_error(405)

    do_PUT = do_DELETE = do_PATCH = do_POST

    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


ThreadingHTTPServer.request_queue_size = 128  # a page load opens many connections at once; the default backlog of 5 resets some
server = ThreadingHTTPServer((HOST, PORT), Handler)
note = ''
if HOURS:
    t = Timer(HOURS * 3600, server.shutdown)
    t.daemon = True
    t.start()
    note = ' ; closes at ' + (datetime.now() + timedelta(hours=HOURS)).strftime('%Y-%m-%d %H:%M:%S') + ' local time'
print(f'preview: http://{HOST}:{PORT}/ root={ROOT}{note}', flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
