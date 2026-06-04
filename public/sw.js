const CACHE_NAME = 'burg-v1';

// 1. Install and activate immediately
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
    
    // Clean up old caches if you ever change CACHE_NAME
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
});

// 2. The crucial Fetch listener (Network-First Strategy)
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // If the network fetch is successful, return the fresh live data
                return networkResponse;
            })
            .catch(() => {
                // ONLY if the network fails (offline), try to serve a cached version
                return caches.match(event.request);
            })
    );
});