import { useEffect } from 'react';

/**
 * Service Worker Registration
 * - Registers /sw.js once at app boot
 * - Activates updates immediately via SKIP_WAITING
 * - Registers background + periodic sync tags
 * - Requests Notification permission early
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    // Request notification permission as early as possible (before any user interaction required)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    if (!('serviceWorker' in navigator)) return;

    // In dev mode: unregister all service workers and clear caches to prevent
    // stale SW from serving broken/conflicting JS chunks (causes React hook errors)
    if (import.meta.env.DEV) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(r => r.unregister());
      });
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
      }
      return;
    }

    let registration = null;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(reg => {
        registration = reg;

        // Force update check every 30 min
        setInterval(() => reg.update(), 30 * 60 * 1000);

        // When new SW is waiting, activate it immediately
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Register background sync tags
        if ('sync' in reg) {
          reg.sync.register('sync-notifications').catch(() => {});
        }

        // Register periodic sync (supported in Chrome/Android)
        if ('periodicSync' in reg) {
          reg.periodicSync.register('check-alerts', {
            minInterval: 5 * 60 * 1000 // 5 minutes
          }).catch(() => {});
        }
      })
      .catch(() => {
        // SW not available — app still works, push via OneSignal SDK
      });

    // When a new SW takes over, reload to get the fresh app shell
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }, []);

  return null;
}