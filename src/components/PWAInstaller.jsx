import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Download, Bell, Camera, MapPin, Wifi } from "lucide-react";

export default function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);
  const [permissions, setPermissions] = useState({
    notifications: 'prompt',
    camera: 'prompt',
    geolocation: 'prompt'
  });
  const [serviceWorkerReady, setServiceWorkerReady] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    // Register service worker (production only — in dev, skip to avoid caching stale JS chunks)
    if ('serviceWorker' in navigator && !import.meta.env.DEV) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((registration) => {
          setServiceWorkerReady(true);
          setInterval(() => { registration.update(); }, 60000);
        })
        .catch(() => {});
    } else {
      setServiceWorkerReady(true);
    }

    // Check push notification support
    if ('PushManager' in window) {
      setPushSupported(true);
    }

    // PWA install prompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      const isInstalled = window.matchMedia('(display-mode: standalone)').matches 
        || window.navigator.standalone 
        || localStorage.getItem('pwa-installed') === 'true';
      
      if (!isInstalled) {
        setShowInstall(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Check current permissions
    checkPermissions();

    // Keep service worker alive
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const keepAlive = setInterval(() => {
        const channel = new MessageChannel();
        navigator.serviceWorker.controller.postMessage(
          { type: 'KEEP_ALIVE' },
          [channel.port2]
        );
      }, 30000); // Every 30 seconds

      return () => {
        clearInterval(keepAlive);
        window.removeEventListener('beforeinstallprompt', handler);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const checkPermissions = async () => {
    const newPermissions = { ...permissions };

    // Check notification permission
    if ('Notification' in window) {
      newPermissions.notifications = Notification.permission;
    }

    // Check camera permission
    if (navigator.permissions) {
      try {
        const cameraStatus = await navigator.permissions.query({ name: 'camera' });
        newPermissions.camera = cameraStatus.state;
        cameraStatus.addEventListener('change', () => {
          setPermissions(prev => ({ ...prev, camera: cameraStatus.state }));
        });
      } catch (e) {
        // Camera permission query not supported
      }

      try {
        const geoStatus = await navigator.permissions.query({ name: 'geolocation' });
        newPermissions.geolocation = geoStatus.state;
        geoStatus.addEventListener('change', () => {
          setPermissions(prev => ({ ...prev, geolocation: geoStatus.state }));
        });
      } catch (e) {
        // Geolocation permission query not supported
      }
    }

    setPermissions(newPermissions);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      localStorage.setItem('pwa-installed', 'true');
      setShowInstall(false);
    }
    
    setDeferredPrompt(null);
  };

  const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
      alert('Notifications not supported on this device');
      return;
    }

    const permission = await Notification.requestPermission();
    setPermissions(prev => ({ ...prev, notifications: permission }));

    if (permission === 'granted' && pushSupported) {
      // Subscribe to push notifications
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            'YOUR_VAPID_PUBLIC_KEY' // TODO: Replace with actual VAPID key
          )
        });
        
        // Send subscription to backend
        console.log('Push subscription:', subscription);
        // await base44.functions.invoke('savePushSubscription', { subscription });
      } catch (error) {
        console.error('Push subscription failed:', error);
      }
    }
  };

  const requestCameraPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      setPermissions(prev => ({ ...prev, camera: 'granted' }));
    } catch (error) {
      setPermissions(prev => ({ ...prev, camera: 'denied' }));
      alert('Camera permission denied. Please enable it in your browser settings.');
    }
  };

  const requestLocationPermission = async () => {
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });
      setPermissions(prev => ({ ...prev, geolocation: 'granted' }));
    } catch (error) {
      setPermissions(prev => ({ ...prev, geolocation: 'denied' }));
      alert('Location permission denied. Please enable it in your browser settings.');
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

  // Check if user dismissed the setup
  const isDismissed = localStorage.getItem('pwa-setup-dismissed') === 'true';
  
  const needsPermissions = permissions.notifications !== 'granted' 
    || permissions.camera !== 'granted' 
    || permissions.geolocation !== 'granted';

  if (isDismissed || (!showInstall && !needsPermissions)) return null;

  return (
    <Card className="fixed bottom-20 left-4 right-4 z-50 bg-slate-800 border-slate-700 shadow-2xl md:bottom-4 md:left-auto md:right-4 md:w-96">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white text-lg">Setup Required</CardTitle>
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => {
              setShowInstall(false);
              localStorage.setItem('pwa-setup-dismissed', 'true');
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!serviceWorkerReady && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-amber-400 text-sm">⚙️ Setting up background services...</p>
          </div>
        )}

        {showInstall && deferredPrompt && (
          <Button 
            onClick={handleInstallClick}
            className="w-full bg-sky-600 hover:bg-sky-700"
          >
            <Download className="w-4 h-4 mr-2" />
            Install App
          </Button>
        )}

        {permissions.notifications !== 'granted' && (
          <Button 
            onClick={requestNotificationPermission}
            variant="outline"
            className="w-full border-slate-600 justify-start"
          >
            <Bell className="w-4 h-4 mr-2" />
            Enable Notifications
            {permissions.notifications === 'denied' && (
              <span className="ml-auto text-xs text-rose-400">Denied</span>
            )}
          </Button>
        )}

        {permissions.camera !== 'granted' && (
          <Button 
            onClick={requestCameraPermission}
            variant="outline"
            className="w-full border-slate-600 justify-start"
          >
            <Camera className="w-4 h-4 mr-2" />
            Enable Camera
            {permissions.camera === 'denied' && (
              <span className="ml-auto text-xs text-rose-400">Denied</span>
            )}
          </Button>
        )}

        {permissions.geolocation !== 'granted' && (
          <Button 
            onClick={requestLocationPermission}
            variant="outline"
            className="w-full border-slate-600 justify-start"
          >
            <MapPin className="w-4 h-4 mr-2" />
            Enable Location
            {permissions.geolocation === 'denied' && (
              <span className="ml-auto text-xs text-rose-400">Denied</span>
            )}
          </Button>
        )}

        <div className="pt-2 border-t border-slate-700">
          <div className="flex items-center gap-2 text-xs">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span className="text-slate-400">
              {serviceWorkerReady ? 'Background sync enabled' : 'Setting up...'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}