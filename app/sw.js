// Service worker (generated from sw.template.js by tools/build_sw.py — edit the template, not sw.js).
// Network first, so a new deploy is picked up at once; the cache is the offline fallback. Fonts: cache first.
const CACHE = 'nirantar-1.2.1-6f7e2c10e7';
const FILES = [
  './',
  'css/base.css',
  'css/components.css',
  'css/pages/brief.css',
  'css/pages/built.css',
  'css/pages/compare.css',
  'css/pages/copilot.css',
  'css/pages/data.css',
  'css/pages/energy.css',
  'css/pages/help.css',
  'css/pages/home.css',
  'css/pages/judges.css',
  'css/pages/machine.css',
  'css/pages/map.css',
  'css/pages/oee.css',
  'css/pages/orders.css',
  'css/pages/presenter.css',
  'css/pages/reliability.css',
  'css/pages/roi.css',
  'css/pages/rules.css',
  'css/pages/schedule.css',
  'css/pages/spares.css',
  'css/pages/tech.css',
  'css/pages/triage.css',
  'css/pages/trust.css',
  'css/pages/whatif.css',
  'css/tokens.css',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon.svg',
  'icons/maskable-512.png',
  'index.html',
  'js/core/format.js',
  'js/core/generator.js',
  'js/core/rng.js',
  'js/core/scoring.js',
  'js/core/store.js',
  'js/main.js',
  'js/pages/brief.js',
  'js/pages/built.js',
  'js/pages/compare.js',
  'js/pages/copilot.js',
  'js/pages/data.js',
  'js/pages/energy.js',
  'js/pages/help.js',
  'js/pages/home.js',
  'js/pages/judges.js',
  'js/pages/machine.js',
  'js/pages/map.js',
  'js/pages/oee.js',
  'js/pages/orders.js',
  'js/pages/presenter.js',
  'js/pages/reliability.js',
  'js/pages/roi.js',
  'js/pages/rules.js',
  'js/pages/schedule.js',
  'js/pages/spares.js',
  'js/pages/tech.js',
  'js/pages/triage.js',
  'js/pages/trust.js',
  'js/pages/whatif.js',
  'js/routes.js',
  'js/ui/charts.js',
  'js/ui/components.js',
  'js/ui/dom.js',
  'js/ui/mcp.js',
  'manifest.webmanifest'
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
