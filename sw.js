// Service worker – שומר את קבצי האפליקציה כדי שתיפתח מהר גם בקליטה חלשה.
// כשמעדכנים קבצים, להעלות את מספר הגרסה כדי שהטלפונים יקבלו את החדש.
const VERSION = 'ot-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'mock.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// רשת קודם, ואם אין חיבור – מהמטמון. רק קבצים של האפליקציה עצמה.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
