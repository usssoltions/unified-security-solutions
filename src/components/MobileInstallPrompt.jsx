import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X, Download, Smartphone } from "lucide-react";

export default function MobileInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      
      const hasInstalled = localStorage.getItem('pwa-installed');
      const hasDismissed = localStorage.getItem('pwa-dismissed');
      
      if (!hasInstalled && !hasDismissed) {
        setTimeout(() => setShowPrompt(true), 3000);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(iOS);
    
    if (iOS) {
      const hasInstalled = localStorage.getItem('pwa-installed');
      const hasDismissed = localStorage.getItem('pwa-dismissed');
      if (!hasInstalled && !hasDismissed && !window.navigator.standalone) {
        setTimeout(() => setShowPrompt(true), 3000);
      }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      localStorage.setItem('pwa-installed', 'true');
    }
    
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-dismissed', 'true');
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] md:left-auto md:right-4 md:max-w-sm">
      <Card className="bg-slate-800 border-sky-500 p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-sky-500 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-semibold mb-1">Install SecureGuard</h3>
            <p className="text-sm text-slate-300 mb-3">
              {isIOS 
                ? "Tap the share button and select 'Add to Home Screen' for quick access"
                : "Install the app for a better mobile experience with offline support"
              }
            </p>
            {!isIOS && (
              <Button 
                onClick={handleInstall}
                className="w-full bg-sky-600 hover:bg-sky-700 mb-2"
                size="sm"
              >
                <Download className="w-4 h-4 mr-2" />
                Install App
              </Button>
            )}
            <Button 
              onClick={handleDismiss}
              variant="ghost"
              className="w-full text-slate-400"
              size="sm"
            >
              Not Now
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="text-slate-400 flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}