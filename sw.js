const CACHE_NAME = 'vidoviewer-shell-v66';
// Files shared in from other Android apps wait here until the page imports them into IndexedDB, then are deleted.
// The name deliberately does not match the shell cache pattern below, so a new shell version never wipes a pending share.
const INBOX = 'vidoviewer-inbox';
const SHELL = ['./', './index.html', './app.js', './bootstrap.js', './home.js', './library.js', './parse-lifecycle.js', './core/parse-client.js', './core/parse-worker.js', './core/format.js', './core/scene.js', './core/geom.js', './core/query.js', './core/pick.js', './core/units.js', './vendor/acad-ts-3.9.0.min.js', './styles/tokens.css', './styles/components.css', './design-bridge.css', './readout-adjustments.css', './renderer.js', './demo.js', './manifest.webmanifest', './icons/icon-32.png', './icons/icon-96.png', './icons/logo-96.png', './icons/logo-192.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './example/mini.dxf'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^vidoviewer-(shell|design|lan)-/.test(k) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const SHARE_LIMIT = 65_000_000; // same hard limit as HARD_LIMIT_BYTES in core/parse-client.js (decimal MB)
async function receiveShared(request) {
  let stored = 0, skipped = 0, failed = 0;
  try {
    const files = (await request.formData()).getAll('drawings').filter(item => typeof item !== 'string');
    const cache = await caches.open(INBOX);
    for (const file of files) {
      if (!/\.(dwg|dxf)$/i.test(file.name) || file.size > SHARE_LIMIT) { skipped++; continue; }
      try {
        await cache.put(`/__inbox/${crypto.randomUUID()}`, new Response(file, {headers: {'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Last-Modified': String(file.lastModified)}}));
        stored++;
      } catch { failed++; }
    }
  } catch { failed++; }
  return Response.redirect(`${self.location.origin}/?shared=${stored}&skipped=${skipped}&failed=${failed}`, 303);
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') { event.respondWith(receiveShared(event.request)); return; }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/status.json' || url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/login')) return;
  event.respondWith((async () => {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        fetch(event.request, {signal: controller.signal}),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('network timeout')); }, 4000); })
      ]);
    } catch {
      // ignoreSearch: the share redirect lands on /?shared=…, which is only cached as /; it must still open offline or after the 4 s timeout.
      return (await caches.match(event.request)) || (await caches.match(event.request, {ignoreSearch: true})) || Response.error();
    } finally { clearTimeout(timer); }
  })());
});
