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
        try {
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
            persistNotification: true,
            // Critical settings for background notifications
            notificationClickHandlerMatch: 'origin',
            promptOptions: {
              slidedown: {
                enabled: true,
                autoPrompt: true,
                timeDelay: 5
              }
            }
          });
          
          // Only request on first setup and if not already failed
          const notificationsFailed = localStorage.getItem('notificationsFailed');
          if (!setupAttempted && !notificationsFailed) {
            window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
              if (!isEnabled) {
                window.OneSignal.registerForPushNotifications().catch(err => {
                  // Silently fail and mark as attempted
                  localStorage.setItem('oneSignalSetupAttempted', 'true');
                  localStorage.setItem('notificationsFailed', 'true');
                });
              }
            });
          }
        } catch (error) {
          // Silently fail if OneSignal initialization fails
          localStorage.setItem('oneSignalSetupAttempted', 'true');
          localStorage.setItem('notificationsFailed', 'true');
        }

        // Save player ID to user record
        try {
          window.OneSignal.getUserId(async function(playerId) {
            if (playerId) {
              try {
                const { base44 } = await import('@/api/base44Client');
                await base44.auth.updateMe({ onesignal_player_id: playerId });
                localStorage.setItem('oneSignalSetupAttempted', 'true');
              } catch (error) {
                // Silently fail
              }
            }
          });
        } catch (error) {
          // Silently fail if getUserId not available
        }

        // Handle notification clicks
        try {
          window.OneSignal.on('notificationDisplay', function(event) {
            // Force vibration and sound for critical alerts
            if (event.data?.type === 'panic' || event.data?.type === 'call') {
              if ('vibrate' in navigator) {
                navigator.vibrate([1000, 500, 1000, 500, 1000]);
              }
            }
          });

          window.OneSignal.on('notificationClicked', function(event) {
            // Aggressively bring app to foreground
            if (window.focus) window.focus();
            if (window.parent) window.parent.focus();
            
            // Handle different notification types
            const data = event.data;
            if (data?.type === 'call' && data?.callId) {
              const callerName = encodeURIComponent(data.callerName || 'Unknown');
              window.location.href = `/?call_id=${data.callId}&caller_name=${callerName}&auto_answer=false`;
            } else if (data?.type === 'panic') {
              window.location.href = '/control-room';
            } else if (data?.url) {
              window.location.href = data.url;
            }
          });
        } catch (error) {
          // Silently fail if event handlers can't be attached
        }

        // Only show prompt on first setup and if not already failed
        const notificationsFailed = localStorage.getItem('notificationsFailed');
        if (!setupAttempted && !notificationsFailed) {
          setTimeout(() => {
            try {
              window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
                if (!isEnabled) {
                  window.OneSignal.showSlidedownPrompt().catch(err => {
                    localStorage.setItem('notificationsFailed', 'true');
                  });
                }
              });
            } catch (error) {
              localStorage.setItem('notificationsFailed', 'true');
            }
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