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
            enable: false // Disabled to prevent duplicate UI
          },
          welcomeNotification: {
            disable: true // Prevent welcome notification on every page load
          }
        });

        // Only show prompt if not already subscribed
        window.OneSignal.isPushNotificationsEnabled(function(isEnabled) {
          if (!isEnabled) {
            window.OneSignal.showSlidedownPrompt();
          }
        });

        // Log notification display
        window.OneSignal.on('notificationDisplay', function(event) {
          console.log('Push notification displayed:', event);
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