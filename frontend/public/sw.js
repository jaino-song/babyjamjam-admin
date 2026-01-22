/**
 * Service Worker for PWA Push Notifications
 *
 * Handles:
 * - Push events (receiving notifications)
 * - Notification click events (opening URLs)
 * - Service worker lifecycle
 */

// Cache version - increment to force update
const CACHE_VERSION = 'v2';
const CACHE_NAME = `imirae-back-office-${CACHE_VERSION}`;

// Assets to precache during install
const PRECACHE_ASSETS = [
    '/manifest.json',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/badge-72.png',
    '/apple-touch-icon.png',
    '/splash/splash-1290x2796.png',
    '/splash/splash-1170x2532.png',
    '/splash/splash-1125x2436.png',
];

// Install event - precache static assets
self.addEventListener('install', (event) => {
    console.log('[SW] Installing service worker...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Precaching assets...');
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating service worker...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('imirae-back-office-') && name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        }).then(() => {
            // Take control of all pages immediately
            return self.clients.claim();
        })
    );
});

/**
 * Fetch Event Handler
 *
 * Caches static assets using cache-first strategy.
 * Excludes API requests from caching.
 */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                });
                return networkResponse;
            });
        })
    );
});

/**
 * Push Event Handler
 *
 * Receives push messages from the server and displays notifications.
 * Payload format: { title, body, icon, badge, data: { url } }
 */
self.addEventListener('push', (event) => {
    console.log('[SW] Push event received');

    if (!event.data) {
        console.warn('[SW] Push event has no data');
        return;
    }

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        console.error('[SW] Failed to parse push payload:', e);
        payload = {
            title: 'New Notification',
            body: event.data.text(),
        };
    }

    const options = {
        body: payload.body || '',
        icon: payload.icon || '/assets/icon-192.png',
        badge: payload.badge || '/assets/badge-72.png',
        vibrate: [100, 50, 100], // Vibration pattern
        data: payload.data || {},
        actions: payload.actions || [],
        tag: payload.tag || 'default', // Group notifications
        renotify: true, // Vibrate even if tag matches
        requireInteraction: false, // Auto-dismiss after a while
    };

    event.waitUntil(
        self.registration.showNotification(payload.title || 'Notification', options)
    );
});

/**
 * Notification Click Handler
 *
 * Opens the URL specified in notification data, or focuses existing window.
 */
self.addEventListener('notificationclick', (event) => {
    console.log('[SW] Notification clicked');

    event.notification.close();

    const urlToOpen = event.notification.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Check if there's already a window open
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    // Navigate existing window to the URL
                    client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            // Open new window if none exists
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

/**
 * Notification Close Handler
 *
 * Track when user dismisses notification (for analytics).
 */
self.addEventListener('notificationclose', (event) => {
    console.log('[SW] Notification dismissed');
    // Could send analytics event here
});

/**
 * Message Handler
 *
 * Handles messages from the main thread (e.g., skip waiting).
 */
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
