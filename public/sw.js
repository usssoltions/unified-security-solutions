/**
 * SecureGuard Service Worker
 * Handles:
 *  - Push notifications (background + foreground)
 *  - Notification click routing
 *  - Background sync
 *  - App keep-alive via periodic sync
 *  - Cache-first for app shell, network-first for API
 *  - Immediate activation (no waiting)
 */

const SW_VERSION = 'secureguard-sw-v3';
const APP_SHELL_CACHE = `${SW_VERSION}-shell`;

// Assets to pre-cache for offline shell
const PRECACHE_URLS = ['/', '/index.html'];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(cache => cache.addAll(PRECACHE_URLS))
  );
  // Take control immediately — do not wait for old SW to die
  self.skipWaiting();
});

// ── Activate: claim all clients, purge old caches ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== APP_SHELL_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Skip waiting message from app ────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'SYNC_NOTIFICATIONS') {
    // Broadcast to all open windows to re-fetch notifications
    self.clients.matchAll({ type: 'window' }).then(clients => {
      clients.forEach(client => client.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
    });
  }
});

// ── Fetch: network-first for API, cache-first for shell assets ───────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, chrome-extension, and OneSignal requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('onesignal')) return;

  // API / real-time: always network — never cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/functions/')) {
    return; // Let browser handle natively
  }

  // App shell: cache-first with network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const clone = response.clone();
        caches.open(APP_SHELL_CACHE).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // If both cache and network fail, return cached index.html for SPA routing
        if (url.pathname.startsWith('/')) return caches.match('/index.html');
      });
    })
  );
});

// ── Push: show notification from server push ──────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch (_) {
    payload = { title: 'SecureGuard Alert', body: event.data?.text() || 'You have a new notification.' };
  }

  const title = payload.title || payload.headings?.en || 'SecureGuard';
  const body = payload.body || payload.contents?.en || '';
  const data = payload.data || {};
  const isPanic = data.type === 'panic';
  const isCall = data.type === 'call';

  const options = {
    body,
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    tag: data.tag || `secureguard-${Date.now()}`,
    // renotify: replace existing tag notification but still trigger sound/vibrate
    renotify: true,
    // requireInteraction: notification stays until user acts (critical/panic/call only)
    requireInteraction: isPanic || isCall || data.priority === 'critical',
    silent: false,
    vibrate: isPanic || isCall ? [500, 200, 500, 200, 500] : [200, 100, 200],
    data: { ...data, url: data.url || '/' },
    actions: isPanic
      ? [{ action: 'view', title: '🚨 Open Control Room' }]
      : isCall
        ? [{ action: 'answer', title: '📞 Answer' }, { action: 'decline', title: '❌ Decline' }]
        : [{ action: 'view', title: 'View' }]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: focus or open correct page ───────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let targetUrl = '/';

  if (event.action === 'answer' && data.callId) {
    const caller = encodeURIComponent(data.callerName || 'Unknown');
    targetUrl = `/?call_id=${data.callId}&caller_name=${caller}&auto_answer=true`;
  } else if (data.type === 'panic' || event.action === 'view' && data.type === 'panic') {
    targetUrl = '/ControlRoom';
  } else if (data.type === 'call' && data.callId) {
    const caller = encodeURIComponent(data.callerName || 'Unknown');
    targetUrl = `/?call_id=${data.callId}&caller_name=${caller}&auto_answer=false`;
  } else if (data.url) {
    targetUrl = data.url;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app is already open, focus it and navigate
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Notification close: track dismissals ─────────────────────────────────────
self.addEventListener('notificationclose', (event) => {
  // Future: could send analytics or update a "dismissed" flag
});

// ── Background Sync: replay queued notification fetches ──────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-notifications') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
      })
    );
  }
});

// ── Periodic Background Sync: keep app data fresh ────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-alerts') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(clients => {
        if (clients.length > 0) {
          // App is open — tell it to re-fetch
          clients.forEach(c => c.postMessage({ type: 'SYNC_NOTIFICATIONS' }));
        } else {
          // App is fully closed — show a silent "check-in" notification if needed
          // (no-op: OneSignal handles background push when app is fully closed)
        }
      })
    );
  }
});
