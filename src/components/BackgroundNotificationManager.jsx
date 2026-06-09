import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Background Notification Manager
 * - Keeps app aware of new alerts + notifications via real-time subscription
 * - Properly cleans up all subscriptions to prevent memory leaks
 * - Re-syncs when app returns from background
 * - Updates app badge count
 */
export default function BackgroundNotificationManager({ user }) {
  const wakeLockRef = useRef(null);
  const badgeIntervalRef = useRef(null);
  const alertUnsubRef = useRef(null);
  const notifUnsubRef = useRef(null);

  // ── Wake Lock: keep screen/CPU active while app is foregrounded ──────────
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    const acquireWakeLock = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        if (wakeLockRef.current) return; // Already held
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch (_) {}
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
        // Notify SW to sync any queued notifications
        navigator.serviceWorker?.controller?.postMessage({ type: 'SYNC_NOTIFICATIONS' });
      } else {
        // Release so OS can sleep the screen when app is hidden
        if (wakeLockRef.current) {
          wakeLockRef.current.release().catch(() => {});
          wakeLockRef.current = null;
        }
      }
    };

    acquireWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, []);

  // ── App Badge: shows unread count on home screen icon ───────────────────
  useEffect(() => {
    if (!user || !('setAppBadge' in navigator)) return;

    const updateBadge = async () => {
      try {
        const [alerts, notifications] = await Promise.all([
          base44.entities.Alert.filter({ status: 'active' }),
          base44.entities.Notification.filter({ recipient_id: user.id, read: false })
        ]);
        const total = (alerts?.length || 0) + (notifications?.length || 0);
        if (total > 0) {
          navigator.setAppBadge(total);
        } else {
          navigator.clearAppBadge();
        }
      } catch (_) {}
    };

    // Delay first call to avoid race with auth
    const initialTimer = setTimeout(updateBadge, 8000);
    badgeIntervalRef.current = setInterval(updateBadge, 120000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(badgeIntervalRef.current);
      navigator.clearAppBadge?.();
    };
  }, [user]);

  // ── Real-time subscriptions: Alert + Notification entities ───────────────
  useEffect(() => {
    if (!user) return;

    // Subscribe to ALL alert changes (not just critical)
    alertUnsubRef.current = base44.entities.Alert.subscribe((event) => {
      if (event.type === 'create') {
        // Show browser notification if app is backgrounded
        if (document.hidden && Notification.permission === 'granted') {
          try {
            new Notification(`🚨 ${event.data?.title || 'New Alert'}`, {
              body: event.data?.message || '',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: `alert-${event.data?.id}`,
              renotify: true,
              requireInteraction: event.data?.priority === 'critical',
            });
          } catch (_) {}
        }
        // Vibrate for critical
        if (event.data?.priority === 'critical' && 'vibrate' in navigator) {
          navigator.vibrate([300, 100, 300, 100, 300]);
        }
      }
    });

    // Subscribe to notification entity changes for this user
    notifUnsubRef.current = base44.entities.Notification.subscribe((event) => {
      if (
        event.type === 'create' &&
        event.data?.recipient_id === user.id &&
        !event.data?.read
      ) {
        if (document.hidden && Notification.permission === 'granted') {
          try {
            new Notification(event.data?.title || 'New Notification', {
              body: event.data?.message || '',
              icon: '/icon-192.png',
              badge: '/icon-192.png',
              tag: `notif-${event.data?.id}`,
              renotify: true,
            });
          } catch (_) {}
        }
      }
    });

    return () => {
      if (alertUnsubRef.current) { alertUnsubRef.current(); alertUnsubRef.current = null; }
      if (notifUnsubRef.current) { notifUnsubRef.current(); notifUnsubRef.current = null; }
    };
  }, [user]);

  // ── Background Sync via Service Worker ───────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleSWMessage = (event) => {
      if (event.data?.type === 'SYNC_NOTIFICATIONS') {
        // SW detected new push while backgrounded — badge will update on next interval
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    // Register periodic background sync if supported
    navigator.serviceWorker.ready.then(reg => {
      if ('periodicSync' in reg) {
        reg.periodicSync.register('check-alerts', { minInterval: 5 * 60 * 1000 }).catch(() => {});
      }
      if ('sync' in reg) {
        reg.sync.register('sync-notifications').catch(() => {});
      }
    });

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  return null;
}