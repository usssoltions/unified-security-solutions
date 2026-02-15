import { useEffect } from 'react';

export default function OneSignalSetup() {
  useEffect(() => {
    // Check if OneSignal setup was attempted
    const setupAttempted = localStorage.getItem('oneSignalSetupAttempted');
    
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
          autoResubscribe: true,
          requiresUserPrivacyConsent: false,
          notifyButton: {
            enable: false
          },
          welcomeNotification: {
            disable: true
          },
          serviceWorkerParam: {
            scope: '/'
          },
          serviceWorkerPath: 'OneSignalSDKWorker.js',
          persistNotification: false
        });
        
        // Only request on first setup
        if (!setupAttempted) {
          window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
            if (!isEnabled) {
              window.OneSignal.registerForPushNotifications().catch(err => {
                console.log('OneSignal registration failed:', err);
                localStorage.setItem('oneSignalSetupAttempted', 'true');
              });
            }
          });
        }

        // Save player ID to user record
        window.OneSignal.getUserId(async function(playerId) {
          if (playerId) {
            try {
              const { base44 } = await import('@/api/base44Client');
              await base44.auth.updateMe({ onesignal_player_id: playerId });
              localStorage.setItem('oneSignalSetupAttempted', 'true');
            } catch (error) {
              console.error('Failed to save player ID:', error);
            }
          }
        });

        // Handle notification clicks
        window.OneSignal.on('notificationDisplay', function(event) {
          console.log('OneSignal notification displayed:', event);
          
          // Force vibration and sound for critical alerts
          if (event.data?.type === 'panic' || event.data?.type === 'call') {
            if ('vibrate' in navigator) {
              navigator.vibrate([1000, 500, 1000, 500, 1000]);
            }
            
            // Try to bring app to foreground
            if (document.visibilityState === 'hidden') {
              try {
                // Request to show notification with requireInteraction
                if ('Notification' in window && Notification.permission === 'granted') {
                  // Notification will appear on top due to high priority from server
                }
              } catch (err) {
                console.log('Foreground request failed:', err);
              }
            }
          }
        });

        window.OneSignal.on('notificationClicked', function(event) {
          console.log('OneSignal notification clicked:', event);
          
          // Aggressively bring app to foreground
          if (window.focus) window.focus();
          if (window.parent) window.parent.focus();
          
          // Handle different notification types
          const data = event.data;
          if (data?.type === 'call' && data?.callId) {
            // Navigate directly to call with deep link
            const callerName = encodeURIComponent(data.callerName || 'Unknown');
            window.location.href = `/?call_id=${data.callId}&caller_name=${callerName}&auto_answer=false`;
          } else if (data?.type === 'panic') {
            window.location.href = '/control-room';
          } else if (data?.url) {
            window.location.href = data.url;
          }
        });

        // Only show prompt on first setup
        if (!setupAttempted) {
          setTimeout(() => {
            window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
              if (!isEnabled) {
                window.OneSignal.showSlidedownPrompt().catch(err => {
                  console.log('Slidedown prompt failed:', err);
                });
              }
            });
          }, 2000);
        }
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