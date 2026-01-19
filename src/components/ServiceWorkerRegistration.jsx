import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      registerServiceWorker();
      requestNotificationPermission();
    }
  }, []);

  const registerServiceWorker = async () => {
    try {
      // Create inline service worker
      const swCode = `
// Service Worker for handling push notifications and background tasks
const CACHE_NAME = 'secureguard-v1';

self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    console.error('[SW] Error parsing push data:', e);
  }

  const title = data.title || 'Notification';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: data.tag || 'notification',
    requireInteraction: data.tag === 'incoming-call',
    vibrate: data.tag === 'incoming-call' ? [500, 200, 500, 200, 500, 200, 500] : [200, 100, 200],
    actions: data.actions || [],
    data: data.data || {},
    silent: false
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  event.notification.close();

  const action = event.action;
  const data = event.notification.data;

  if (action === 'answer' && data.callId) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({
              type: 'incoming-call',
              callId: data.callId,
              callerName: data.callerName,
              autoAnswer: true
            });
            return;
          }
        }
        return clients.openWindow('/?incoming_call=' + data.callId + '&auto_answer=true').then((client) => {
          if (client) {
            setTimeout(() => {
              client.postMessage({
                type: 'incoming-call',
                callId: data.callId,
                callerName: data.callerName,
                autoAnswer: true
              });
            }, 1000);
          }
        });
      })
    );
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        return clients.openWindow('/');
      })
    );
  }
});

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
      `;

      const blob = new Blob([swCode], { type: 'application/javascript' });
      const swUrl = URL.createObjectURL(blob);
      
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: '/'
      });

      console.log('Service Worker registered:', registration);

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        console.log('New Service Worker found');
        
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('New Service Worker installed, reloading...');
            window.location.reload();
          }
        });
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        console.log('Message from Service Worker:', event.data);
        
        if (event.data.type === 'notification-click') {
          handleNotificationClick(event.data);
        }
      });

      // Subscribe to push notifications
      await subscribeToPushNotifications(registration);
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  const requestNotificationPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        console.log('Notification permission:', permission);
        
        if (permission === 'granted') {
          console.log('Notifications enabled');
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
      }
    }
  };

  const subscribeToPushNotifications = async (registration) => {
    try {
      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            'BEB76eqwuJJG7P0YxtnRWvu4hQSC5zVwjWb6hKjnXpM2FCiVlDEp6d2hwwn6TyWy3dgOSI5D8Y6dbkTKaa_2R8A'
          )
        });
      }

      console.log('Push subscription:', subscription);
      
      // Save subscription to user profile
      try {
        const user = await base44.auth.me();
        await base44.auth.updateMe({
          push_subscription: JSON.stringify(subscription.toJSON())
        });
      } catch (error) {
        console.warn('Failed to save push subscription:', error);
      }
    } catch (error) {
      console.warn('Push notification subscription failed:', error);
    }
  };

  const handleNotificationClick = (data) => {
    // Handle notification clicks
    if (data.action === 'answer' && data.data?.callId) {
      window.postMessage({
        type: 'ANSWER_CALL',
        callId: data.data.callId
      }, '*');
    }
  };

  // Listen for messages from main app
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data.type === 'SHOW_CALL_NOTIFICATION') {
        showCallNotification(event.data);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const showCallNotification = async (data) => {
    if ('serviceWorker' in navigator && 'Notification' in window) {
      const registration = await navigator.serviceWorker.ready;
      
      await registration.showNotification('Incoming Call', {
        body: `${data.callerName} is calling you`,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        tag: 'incoming-call-' + data.callId,
        requireInteraction: true,
        vibrate: [300, 200, 300, 200, 300, 200, 300],
        actions: [
          { action: 'answer', title: 'Answer' },
          { action: 'decline', title: 'Decline' }
        ],
        data: {
          callId: data.callId,
          callerId: data.callerId
        }
      });
    }
  };

  const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  };

  return null;
}