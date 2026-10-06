// Service worker (generated from sw.template.js by tools/build_sw.py — edit the template, not sw.js).
// Network first, so a new deploy is picked up at once; the cache is the offline fallback. Fonts: cache first.
const CACHE = '__CACHE__';
const FILES = [
  __FILES__
];
self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('nirantar-') && k !== CACHE && k !== 'nirantar-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    ev.respondWith(caches.open('nirantar-fonts').then(c => c.match(req).then(hit => hit || fetch(req).then(res => { c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return;
  ev.respondWith(fetch(req).then(res => {
    if (res.ok && url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))));
});
