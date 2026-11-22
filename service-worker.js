// Stride service worker — precaches the whole app so it runs fully offline.
// Bump VERSION whenever any file changes so clients pick up the new cache.
const VERSION = 'stride-v2.1.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './css/calendar.css',
  './css/workout.css',
  './assets/fonts/inter-var.woff2',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './js/app.js',
  './js/core/dates.js',
  './js/core/units.js',
  './js/core/db.js',
  './js/core/storage.js',
  './js/core/store.js',
  './js/core/migrate.js',
  './js/engine/vdot.js',
  './js/engine/assessment.js',
  './js/engine/workout-utils.js',
  './js/engine/workouts.js',
  './js/engine/strength.js',
  './js/engine/training-engine.js',
  './js/engine/adjustments.js',
  './js/engine/performance.js',
  './js/engine/scheduler.js',
  './js/engine/treadmill.js',
  './js/services/workout-session.js',
  './js/services/gps.js',
  './js/services/audio-coach.js',
  './js/ui/dom.js',
  './js/ui/format.js',
  './js/ui/charts.js',
  './js/ui/insights.js',
  './js/ui/onboarding.js',
  './js/ui/preview.js',
  './js/ui/actions.js',
  './js/ui/adjust.js',
  './js/ui/today.js',
  './js/ui/plan.js',
  './js/ui/calendar.js',
  './js/ui/progress.js',
  './js/ui/profile.js',
  './js/ui/live.js',
  './js/ui/coach.js',
  './js/ui/dragdrop.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Cache-first for app assets; network fallback, then cache the response.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    }),
  );
});

// Tapping a workout notification focuses the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./index.html#/today');
  }));
});
