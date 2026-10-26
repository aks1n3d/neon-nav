// App-shell cache. App files: network first (always fresh when online),
// falling back to cache offline. Map engine + fonts: stale-while-revalidate.
// Tiles, routing and search are never cached here.
const CACHE = 'neonnav-v2';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/mapstyle.js', 'js/geo.js',
  'js/router.js', 'js/geocode.js', 'js/audio.js', 'icon.svg', 'icon-180.png', 'manifest.webmanifest'];
const CDN = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(fetch(req)
      .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      });
      return hit || net;
    }));
  }
});
