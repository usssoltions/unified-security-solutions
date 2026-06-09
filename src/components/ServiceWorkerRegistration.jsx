import { useEffect } from 'react';

/**
 * Service Worker Registration
 * - Registers SW once, handles updates silently
 * - Requests notification permission on mount
 */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(registration => {
        // Check for updates every 30 minutes
        setInterval(() => registration.update(), 30 * 60 * 1000);

        // When a new SW is waiting, activate it immediately
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {
        // SW not critical — app works without it
      });

    // Request notification permission as early as possible
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return null;
}