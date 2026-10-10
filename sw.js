/* Game Hub service worker: network first (always the newest hub), cached copy only when offline. */
const CACHE = 'gamehub-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(function (res) {
    if (res.ok) { var c = res.clone(); caches.open(CACHE).then(function (ca) { ca.put(r, c); }); }
    return res;
  }).catch(function () {
    return caches.match(r, { ignoreSearch: true }).then(function (m) { return m || caches.match('./', { ignoreSearch: true }); });
  }));
});
