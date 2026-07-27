import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * OneSignal v16 Web Push Setup
 * - Uses OneSignalDeferred pattern (v16+)
 * - Stores player ID on user record
 * - Handles notification clicks for routing
 * - Never suppresses re-registration with localStorage flags
 */
export default function OneSignalSetup() {
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    // ── Check if running inside native Android WebView ──────────
    // The native app uses the OneSignal Android SDK for push delivery.
    // We skip the web SDK and sync the external user ID instead.
    if (window.AndroidBridge && window.AndroidBridge.isNativeApp && window.AndroidBridge.isNativeApp()) {
      console.log('[OneSignalSetup] 📱 Native Android app detected — using native OneSignal SDK');
      console.log('[OneSignalSetup] Skipping web SDK init (native SDK handles push)');

      // Set external ID so backend can send to all devices via include_external_user_ids
      const syncExternalId = async () => {
        try {
          const user = await base44.auth.me();
          if (user?.id) {
            window.AndroidBridge.setExternalId(user.id);
            console.log('[OneSignalSetup] ✅ Native external ID set:', user.id);
          }
        } catch (e) {
          console.warn('[OneSignalSetup] Could not sync external ID yet, retrying...', e);
          setTimeout(syncExternalId, 3000);
        }
      };
      syncExternalId();
      return; // Skip web SDK init
    }

    // ── Web SDK path (browser / PWA) ────────────────────────────
    console.log('[OneSignalSetup] Web mode — loading OneSignal v16 SDK');
    const script = document.createElement('script');
    script.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    script.defer = true;
    document.head.appendChild(script);

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    window.OneSignalDeferred.push(async function(OneSignal) {
      try {
        await OneSignal.init({
          appId: "526d4393-9f50-4f8e-8379-05ec176dc62d",
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerParam: { scope: '/' },
          serviceWorkerPath: 'OneSignalSDKWorker.js',
          // Always prompt again if user hasn't granted
          promptOptions: {
            slidedown: {
              prompts: [{
                type: 'push',
                autoPrompt: true,
                text: {
                  actionMessage: 'SecureGuard needs push notifications for real-time alerts.',
                  acceptButton: 'Allow',
                  cancelButton: 'Later'
                },
                delay: { timeDelay: 5, pageViews: 1 }
              }]
            }
          },
          welcomeNotification: { disable: true },
          notificationClickHandlerMatch: 'origin',
          notificationClickHandlerAction: 'focus'
        });

        // Persist subscription and save player ID
        await OneSignal.Notifications.requestPermission();

        // Set external user ID so backend can send to all devices
        const currentUser = await base44.auth.me();
        if (currentUser?.id) {
          try {
            await OneSignal.login(currentUser.id);
            console.log('[OneSignalSetup] ✅ Web external ID set:', currentUser.id);
          } catch (_) {}
        }

        const playerId = await OneSignal.User.PushSubscription.id;
        if (playerId) {
          try {
            await base44.auth.updateMe({ onesignal_player_id: playerId });
          } catch (_) {}
        }

        // Also listen for subscription changes (e.g. user grants later)
        OneSignal.User.PushSubscription.addEventListener('change', async (event) => {
          const newId = event.current?.id;
          if (newId) {
            try {
              await base44.auth.updateMe({ onesignal_player_id: newId });
            } catch (_) {}
          }
        });

        // Notification display — vibrate for panic/call
        OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
          event.notification.display(); // Always show even in foreground
          const data = event.notification.additionalData;
          if (data?.type === 'panic' || data?.type === 'call') {
            if ('vibrate' in navigator) {
              navigator.vibrate([1000, 500, 1000, 500, 1000]);
            }
          }
        });

        // Notification click — route to correct page
        OneSignal.Notifications.addEventListener('click', (event) => {
          if (window.focus) window.focus();
          const data = event.notification?.additionalData;
          if (data?.type === 'call' && data?.callId) {
            const callerName = encodeURIComponent(data.callerName || 'Unknown');
            window.location.href = `/?call_id=${data.callId}&caller_name=${callerName}&auto_answer=false`;
          } else if (data?.type === 'panic') {
            window.location.href = '/ControlRoom';
          } else if (data?.url) {
            window.location.href = data.url;
          }
        });

      } catch (err) {
        console.warn('[OneSignal] Init failed:', err.message);
      }
    });

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, []);

  return null;
}