import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { X, Download } from "lucide-react";

/**
 * App-install prompt ONLY — never a permissions surface.
 *
 * Notification, camera and location permissions are requested exclusively in
 * the feature or Profile surface that needs them (Profile → Push
 * Notifications, the scanner when scanning, location features when used).
 * Nothing here requests, checks or prompts for any permission, and nothing
 * here shows an alert — ever.
 *
 * The install prompt appears only when the current context actually supports
 * installation (the browser fires beforeinstallprompt) and the app is not
 * already installed. It is fully dismissible and stays dismissed.
 */
export default function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstall, setShowInstall] = useState(false);

  useEffect(() => {
    // Keep the app's service worker alive (background sync / SW-driven flows).
    // Permission is NEVER requested here. Registration itself happens once in
    // ServiceWorkerRegistration.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      const keepAlive = setInterval(() => {
        try {
          const channel = new MessageChannel();
          navigator.serviceWorker.controller.postMessage(
            { type: 'KEEP_ALIVE' },
            [channel.port2]
          );
        } catch (_) {}
      }, 30000);
      return () => clearInterval(keepAlive);
    }
  }, []);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);

      // Only offer installation when not already installed.
      const isInstalled = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone
        || localStorage.getItem('pwa-installed') === 'true';

      if (!isInstalled) setShowInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

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

  const handleDismiss = () => {
    setShowInstall(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  if (!showInstall || !deferredPrompt) return null;
  if (localStorage.getItem('pwa-install-dismissed') === 'true') return null;

  return (
    <Card className="fixed bottom-20 left-4 right-4 z-50 bg-slate-800 border-slate-700 shadow-2xl md:bottom-4 md:left-auto md:right-4 md:w-96">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <Button onClick={handleInstallClick} className="bg-sky-600 hover:bg-sky-700">
            <Download className="w-4 h-4 mr-2" />
            Install App
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}