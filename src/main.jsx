import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Register service worker for PWA support (app shell caching, push notifications, offline)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        // Check for updates every 30 minutes
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);

        // Activate new SW immediately when available
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Register background sync for notifications
        if ('sync' in reg) {
          reg.sync.register('sync-notifications').catch(() => {});
        }

        // Register periodic sync (Chrome/Android)
        if ('periodicSync' in reg) {
          reg.periodicSync.register('check-alerts', { minInterval: 5 * 60 * 1000 }).catch(() => {});
        }
      })
      .catch(() => {
        // SW registration failed — app still works, push via OneSignal SDK
      });

    // Reload when a new service worker takes over
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}