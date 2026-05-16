const CACHE_NAME = 'big-sports-v2';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache root, index, manifest, and offline fallback
      return cache.addAll([
        '/',
        '/index.html',
        '/manifest.json',
        OFFLINE_URL
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }
  
  // Try network first, then cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache GET requests that are successful
        if (event.request.method === 'GET' && response.status === 200 && event.request.url.startsWith('http')) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Background Sync stub
self.addEventListener('sync', (event) => {
  if (event.tag === 'my-sync') {
    // event.waitUntil(doSomeSync());
  }
});

// Push notification stub
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/icon-192x192.png'
  };
  event.waitUntil(self.registration.showNotification('Big Sports', options));
});

// Periodic Background Sync stub
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'update') {
    // event.waitUntil(doSomePeriodicSync());
  }
});
