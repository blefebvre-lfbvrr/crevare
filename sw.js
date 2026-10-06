// Crevare — cache hors ligne. Liste et version générées par tools/stamp_sw.py (ne pas modifier à la main).
const VERSION = "795a3aeeb1fc";
const ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/base.css",
  "css/today.css",
  "css/plan.css",
  "css/session.css",
  "css/library.css",
  "css/timer.css",
  "css/progress.css",
  "css/habits.css",
  "css/goals.css",
  "css/settings.css",
  "css/agenda.css",
  "js/version.js",
  "js/core/util.js",
  "js/core/legacy-v1.js",
  "js/core/schema.js",
  "js/core/store.js",
  "js/ui/components.js",
  "js/data/exercises.js",
  "js/data/benchmarks.js",
  "js/data/goals.js",
  "js/data/sessions.js",
  "js/core/planner.js",
  "js/core/sessions.js",
  "js/core/metrics.js",
  "js/core/agenda.js",
  "js/platform/audio.js",
  "js/platform/health.js",
  "js/ui/timer.js",
  "js/ui/today.js",
  "js/ui/plan.js",
  "js/ui/session.js",
  "js/ui/library.js",
  "js/ui/progress.js",
  "js/ui/habits.js",
  "js/ui/goals.js",
  "js/ui/onboarding.js",
  "js/ui/settings.js",
  "js/ui/agenda.js",
  "js/app.js",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png"
];
const CACHE = 'crevare-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('crevare-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache d'abord (version figée par fichier) ; réseau en secours. Les pages renvoient index.html hors ligne.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
      throw err;
    }
  })());
});
