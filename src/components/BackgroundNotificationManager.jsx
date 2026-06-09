import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Background Notification Manager
 * - Holds a Wake Lock while app is foregrounded (prevents OS from suspending JS)
 * - Subscribes to real-time Alert + Notification entity streams
 * - Shows native browser Notification when app is backgrounded
 * - Reacts to Service Worker SYNC_NOTIFICATIONS messages to invalidate query cache
 * - Updates PWA app badge with combined unread count
 */
export default function BackgroundNotificationManager({ user }) {
  const wakeLockRef = useRef(null);
  const alertUnsubRef = useRef(null);
  const notifUnsubRef = useRef(null);
  const queryClient = useQueryClient();

  // ── Wake Lock ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || wakeLockRef.current) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
      } catch (_) {}
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquire();
        // Tell SW to flush any queued push payloads
        navigator.serviceWorker?.controller?.postMessage({ type: 'SYNC_NOTIFICATIONS' });
      } else {
        wakeLockRef.current?.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };

    acquire();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  // ── Service Worker message → invalidate query cache ───────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleSWMessage = (event) => {
      if (event.data?.type === 'SYNC_NOTIFICATIONS') {
        // Re-fetch all live queries so UI updates immediately
        queryClient.invalidateQueries({ queryKey: ['notifications'] });
        queryClient.invalidateQueries({ queryKey: ['criticalAlerts'] });
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleSWMessage);
  }, [queryClient]);

  // ── Real-time entity subscriptions ───────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Alert subscription — all priorities
    alertUnsubRef.current = base44.entities.Alert.subscribe((event) => {
      if (event.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ['criticalAlerts'] });
        queryClient.invalidateQueries({ queryKey: ['alerts'] });

        // Show native notification when app is hidden
        if (document.hidden && Notification.permission === 'granted') {
          try {
            new Notification(`🚨 ${event.data?.title || 'New Alert'}`, {
              body: event.data?.message || '',
              icon: '/icon-192.png',
              tag: `alert-${event.data?.id}`,
              renotify: true,
              requireInteraction: event.data?.priority === 'critical',
            });
          } catch (_) {}
        }

        if (event.data?.priority === 'critical' && 'vibrate' in navigator) {
          navigator.vibrate([300, 100, 300, 100, 300]);
        }
      }
    });

    // Notification subscription — this user's notifications only
    notifUnsubRef.current = base44.entities.Notification.subscribe((event) => {
      if (event.type === 'create' && event.data?.recipient_id === user.id) {
        queryClient.invalidateQueries({ queryKey: ['notifications'] });

        if (document.hidden && Notification.permission === 'granted' && !event.data?.read) {
          try {
            new Notification(event.data?.title || 'SecureGuard', {
              body: event.data?.message || '',
              icon: '/icon-192.png',
              tag: `notif-${event.data?.id}`,
              renotify: true,
            });
          } catch (_) {}
        }
      }
    });

    return () => {
      alertUnsubRef.current?.();
      alertUnsubRef.current = null;
      notifUnsubRef.current?.();
      notifUnsubRef.current = null;
    };
  }, [user, queryClient]);

  // ── App Badge (home screen icon count) ────────────────────────────────────
  useEffect(() => {
    if (!user || !('setAppBadge' in navigator)) return;

    const updateBadge = async () => {
      try {
        const [alerts, notifs] = await Promise.all([
          base44.entities.Alert.filter({ status: 'active' }),
          base44.entities.Notification.filter({ recipient_id: user.id, read: false })
        ]);
        const total = (alerts?.length || 0) + (notifs?.length || 0);
        total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge();
      } catch (_) {}
    };

    const t = setTimeout(updateBadge, 8000);
    const interval = setInterval(updateBadge, 120000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
      navigator.clearAppBadge?.();
    };
  }, [user]);

  return null;
}