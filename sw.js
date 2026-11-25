const CACHE_NAME = 'vidoviewer-shell-v61';
const SHELL = ['./', './index.html', './app.js', './bootstrap.js', './home.js', './library.js', './parse-lifecycle.js', './core/parse-client.js', './core/parse-worker.js', './core/format.js', './core/scene.js', './core/geom.js', './core/query.js', './core/pick.js', './core/units.js', './vendor/acad-ts-3.9.0.min.js', './styles/tokens.css', './styles/components.css', './design-bridge.css', './readout-adjustments.css', './renderer.js', './demo.js', './manifest.webmanifest', './icons/icon-32.png', './icons/icon-96.png', './icons/logo-96.png', './icons/logo-192.png', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './example/mini.dxf'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^vidoviewer-(shell|design|lan)-/.test(k) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
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
      return (await caches.match(event.request)) || Response.error();
    } finally { clearTimeout(timer); }
  })());
});
