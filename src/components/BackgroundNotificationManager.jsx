import React, { useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function BackgroundNotificationManager({ user }) {
  useEffect(() => {
    if (!user) return;

    // Request Badge API permission (shows notification count on app icon)
    if ('setAppBadge' in navigator) {
      // Update badge count when alerts change
      const updateBadge = async () => {
        try {
          const unreadAlerts = await base44.entities.Alert.filter({
            status: 'active'
          });
          navigator.setAppBadge(unreadAlerts.length);
        } catch (error) {
          console.error('Failed to update badge:', error);
        }
      };

      updateBadge();
      const badgeInterval = setInterval(updateBadge, 10000);
      return () => clearInterval(badgeInterval);
    }
  }, [user]);

  useEffect(() => {
    // Register for background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(registration => {
        // Periodic sync every 5 minutes for alerts
        if ('periodicSync' in registration) {
          registration.periodicSync.register('check-alerts', {
            minInterval: 5 * 60 * 1000 // 5 minutes
          }).catch(err => {
            console.log('Periodic sync registration failed:', err);
          });
        }

        // One-time background sync for notifications
        registration.sync.register('sync-notifications').catch(err => {
          console.log('Background sync registration failed:', err);
        });
      });
    }

    // Listen for service worker messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_NOTIFICATIONS') {
          // Re-sync notifications when service worker detects new ones
          if (user) {
            base44.entities.Alert.subscribe((alert) => {
              if (alert.priority === 'critical') {
                // Show in-app notification for critical alerts
                console.log('Critical alert received:', alert);
              }
            });
          }
        }
      });
    }

    // Request notification permission on load
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Listen for visibility changes - wake up if in background
    const handleVisibilityChange = () => {
      if (!document.hidden && 'serviceWorker' in navigator) {
        // App came to foreground - sync any pending notifications
        navigator.serviceWorker.controller?.postMessage({
          type: 'SYNC_NOTIFICATIONS'
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user]);

  return null;
}