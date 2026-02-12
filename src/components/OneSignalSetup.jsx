import { useEffect } from 'react';

export default function OneSignalSetup() {
  useEffect(() => {
    // Load OneSignal SDK
    const script = document.createElement('script');
    script.src = 'https://cdn.onesignal.com/sdks/OneSignalSDK.js';
    script.async = true;
    document.head.appendChild(script);

    script.onload = () => {
      window.OneSignal = window.OneSignal || [];
      window.OneSignal.push(function() {
        window.OneSignal.init({
          appId: "efd5b25f-e103-4aca-bc00-2b010194fdb9",
          allowLocalhostAsSecureOrigin: true,
          notifyButton: {
            enable: false
          },
          welcomeNotification: {
            disable: true
          },
          serviceWorkerParam: {
            scope: '/'
          },
          serviceWorkerPath: 'OneSignalSDKWorker.js'
        });

        // Save player ID to user record
        window.OneSignal.getUserId(async function(playerId) {
          if (playerId) {
            try {
              // Import base44 client
              const { base44 } = await import('@/api/base44Client');
              await base44.auth.updateMe({ onesignal_player_id: playerId });
            } catch (error) {
              console.error('Failed to save player ID:', error);
            }
          }
        });

        // Handle notification clicks
        window.OneSignal.on('notificationDisplay', function(event) {
          console.log('OneSignal notification displayed:', event);
        });

        window.OneSignal.on('notificationClicked', function(event) {
          console.log('OneSignal notification clicked:', event);
          
          // Handle different notification types
          const data = event.data;
          if (data?.type === 'call') {
            // Bring app to foreground and navigate to call
            window.focus();
          } else if (data?.type === 'panic') {
            window.focus();
            window.location.href = '/control-room';
          }
        });

        // Prompt for subscription if not subscribed
        window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
          if (!isEnabled) {
            setTimeout(() => {
              window.OneSignal.showSlidedownPrompt();
            }, 3000);
          }
        });
      });
    };

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  return null;
}