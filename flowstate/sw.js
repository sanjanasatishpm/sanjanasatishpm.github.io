// Network first, so a pushed update shows on the next load. The cache is only
// used when the device is offline.
const CACHE = 'flowstate-v3';
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'core.js',
  'ui.js',
  'alerts.js',
  'player.js',
  'account.js',
  'backend.js',
  'sync.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// The sign-in library's address includes its version, so a cached copy never goes stale.
// Keeping it means someone signed in can still open the app with no connection.
async function firebaseSdk(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.startsWith(FIREBASE_SDK)) {
    event.respondWith(firebaseSdk(request));
    return;
  }
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const shell = await caches.match('./');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
