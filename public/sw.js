/**
 * SecureGuard Service Worker
 * - App shell precaching for offline support
 * - Runtime caching: network-first for API, cache-first for static assets
 * - Push notification handling
 * - Background sync for notifications
 */

const APP_SHELL_CACHE = 'secureguard-shell-v1';
const RUNTIME_CACHE = 'secureguard-runtime-v1';

const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/offline.html'
];

// ─── Install: precache app shell ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ──────────────────────────────
self.addEventListener('activate', (event) => {
  const validCaches = [APP_SHELL_CACHE, RUNTIME_CACHE];
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !validCaches.includes(k)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch: routing strategy ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Skip cross-origin API/backend requests (Base44 SDK, OneSignal, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API calls and realtime endpoints
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/v1/')) return;

  // Network-first for navigation requests (HTML pages)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

// ─── Message handler (skip waiting / sync notifications) ────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'SYNC_NOTIFICATIONS') {
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => client.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
    });
  }
});

// ─── Push notifications ──────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'SecureGuard', body: event.data ? event.data.text() : 'New alert' };
  }

  const title = payload.title || (payload.headings ? payload.headings.en : 'USS Guard Alert');
  const body = payload.body || payload.message || (payload.contents ? payload.contents.en : 'You have a new notification');
  const isPanic = payload.type === 'panic' || payload.priority === 'critical';
  const isCall = payload.type === 'call';

  // Build call URL for notification click-through
  let callUrl = payload.url || payload.action_url || '/';
  if (isCall && payload.callId && !callUrl.includes('call_id')) {
    callUrl = `/?call_id=${payload.callId}&caller_name=${encodeURIComponent(payload.callerName || 'Incoming')}`;
  }

  const options = {
    body: body,
    icon: payload.icon || 'https://media.base44.com/images/public/690fd37d10984f1f26cedab8/1f03ecb8e_generated_image.png',
    badge: 'https://media.base44.com/images/public/690fd37d10984f1f26cedab8/1f03ecb8e_generated_image.png',
    vibrate: isPanic ? [200, 100, 200, 100, 200, 100, 400] : isCall ? [500, 200, 500, 200, 500] : [100],
    requireInteraction: isPanic || isCall,
    tag: payload.tag || payload.type || 'ussguard',
    renotify: true,
    data: {
      url: callUrl,
      type: payload.type || 'default',
      callId: payload.callId || '',
      callerName: payload.callerName || '',
      id: payload.id || ''
    }
  };

  if (payload.image) options.image = payload.image;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ─── Notification click ──────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  // Handle action buttons
  if (event.action === 'accept' || event.action === 'view') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        return self.clients.openWindow(targetUrl);
      })
    );
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', url: targetUrl });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ─── Background sync ─────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
      })
    );
  }
});

// ─── Periodic sync ───────────────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-alerts') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
      })
    );
  }
});
