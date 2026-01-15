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
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
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
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          // This is a placeholder - you'll need to generate a VAPID key
          'BEl62iUYgUivxIkv69yViEuiBIa-Ib37J8xQmrQhP6RYWQUkUBKpTwSJP8wkD8wz6MqJ7eFCmrXf4tE0nT7nXyk'
        )
      });

      console.log('Push subscription:', subscription);
      
      // Send subscription to backend (implement this endpoint)
      // await base44.functions.invoke('savePushSubscription', {
      //   subscription: subscription.toJSON()
      // });
    } catch (error) {
      console.warn('Push notification subscription failed:', error);
    }
  };

  const handleNotificationClick = (data) => {
    // Handle notification clicks
    if (data.action === 'answer' && data.data?.callId) {
      // Navigate to call screen or trigger call answer
      window.postMessage({
        type: 'ANSWER_CALL',
        callId: data.data.callId
      }, '*');
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