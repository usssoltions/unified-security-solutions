import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Battery, Wifi, Power, CheckCircle2, XCircle, AlertTriangle, X } from "lucide-react";

export default function PermissionEnforcement() {
  const [permissions, setPermissions] = useState({
    notifications: 'unknown',
    batteryOptimization: 'unknown',
    backgroundData: 'unknown',
    autoLaunch: 'unknown',
    dismissed: false
  });

  useEffect(() => {
    // Check if dismissed permanently
    const isDismissed = localStorage.getItem('permissionEnforcementDismissed');
    if (isDismissed === 'true') {
      setPermissions(prev => ({ ...prev, dismissed: true }));
      return;
    }
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    const perms = {
      notifications: 'unknown',
      batteryOptimization: 'unknown',
      backgroundData: 'unknown',
      autoLaunch: 'unknown'
    };

    // Check notification permission
    if ('Notification' in window) {
      perms.notifications = Notification.permission === 'granted' ? 'granted' : 'denied';
    }

    // Check if service worker is registered (proxy for background data)
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      perms.backgroundData = registration ? 'granted' : 'denied';
    }

    // Battery optimization and auto-launch can't be checked via web APIs
    // These need native app integration or user confirmation
    perms.batteryOptimization = 'requires_manual';
    perms.autoLaunch = 'requires_manual';

    setPermissions(perms);
  };

  const requestNotifications = async () => {
    try {
      const permission = await Notification.requestPermission();
      setPermissions(prev => ({ ...prev, notifications: permission }));
      
      if (permission === 'granted') {
        alert('Notifications enabled! You will now receive critical alerts.');
      }
    } catch (error) {
      console.error('Permission request error:', error);
      alert('Failed to request notification permission');
    }
  };

  const allCriticalGranted = 
    permissions.notifications === 'granted' && 
    (permissions.backgroundData === 'granted' || permissions.backgroundData === 'unknown');

  const getStatusIcon = (status) => {
    if (status === 'granted') return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
    if (status === 'denied') return <XCircle className="w-5 h-5 text-rose-500" />;
    return <AlertTriangle className="w-5 h-5 text-amber-500" />;
  };

  const getStatusBadge = (status) => {
    if (status === 'granted') return <Badge className="bg-emerald-500">Enabled</Badge>;
    if (status === 'denied') return <Badge className="bg-rose-500">Disabled</Badge>;
    if (status === 'requires_manual') return <Badge className="bg-amber-500">Manual Setup</Badge>;
    return <Badge className="bg-slate-500">Unknown</Badge>;
  };

  if (allCriticalGranted || permissions.dismissed) {
    return null; // Don't show if everything is OK or dismissed
  }

  return (
    <div className="fixed top-4 right-4 left-4 md:left-auto md:w-96 z-30">
      <Card className="bg-gradient-to-br from-amber-900/20 to-rose-900/20 border-amber-500/30 shadow-2xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <CardTitle className="text-white text-sm">Permissions Needed</CardTitle>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                localStorage.setItem('permissionEnforcementDismissed', 'true');
                setPermissions({ ...permissions, dismissed: true });
              }}
              className="h-6 w-6 p-0 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
        <Alert className="bg-amber-900/30 border-amber-500/50 py-2">
          <AlertDescription className="text-amber-200 text-xs">
            Enable permissions for emergency alerts
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          {/* Notifications */}
          <div className="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getStatusIcon(permissions.notifications)}
              <div>
                <p className="text-white font-medium text-sm">Push Notifications</p>
                <p className="text-xs text-slate-400">Emergency alerts</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {permissions.notifications !== 'granted' && (
                <Button 
                  onClick={requestNotifications}
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 h-7 text-xs"
                >
                  Enable
                </Button>
              )}
            </div>
          </div>

          <details className="bg-slate-800/50 rounded-lg">
            <summary className="p-3 cursor-pointer text-sm text-white font-medium">
              Setup Instructions (Battery & Auto-Launch)
            </summary>
            <div className="px-3 pb-3 space-y-2 text-xs text-slate-300">
              <div>
                <p className="font-semibold text-amber-400">Battery Optimization:</p>
                <p>Settings → Apps → SecureGuard → Battery → Unrestricted</p>
              </div>
              <div>
                <p className="font-semibold text-amber-400">Auto Launch:</p>
                <p>Settings → Apps → SecureGuard → Enable Auto-start</p>
              </div>
            </div>
          </details>
        </div>

        <Alert className="bg-rose-900/30 border-rose-500/50 py-2">
          <AlertDescription className="text-rose-200 text-xs">
            ⚠️ Critical for emergency alerts
          </AlertDescription>
        </Alert>
      </CardContent>
      </Card>
    </div>
  );
}