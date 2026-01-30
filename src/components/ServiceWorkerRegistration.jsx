import { useEffect } from 'react';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Register service worker
      navigator.serviceWorker.register('/sw.js')
        .then(registration => {
          console.log('Service Worker registered:', registration);
          
          // Request notification permission
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
              console.log('Notification permission:', permission);
            });
          }
          
          // Request wake lock permission for keeping app active
          if ('wakeLock' in navigator) {
            document.addEventListener('visibilitychange', async () => {
              if (document.visibilityState === 'visible') {
                try {
                  const wakeLock = await navigator.wakeLock.request('screen');
                  console.log('Wake lock acquired');
                } catch (err) {
                  console.log('Wake lock error:', err);
                }
              }
            });
          }
        })
        .catch(error => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  return null;
}