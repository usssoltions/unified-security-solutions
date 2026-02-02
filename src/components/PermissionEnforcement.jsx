import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Battery, Wifi, Power, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

export default function PermissionEnforcement() {
  const [permissions, setPermissions] = useState({
    notifications: 'unknown',
    batteryOptimization: 'unknown',
    backgroundData: 'unknown',
    autoLaunch: 'unknown'
  });

  useEffect(() => {
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

  if (allCriticalGranted) {
    return null; // Don't show if everything is OK
  }

  return (
    <Card className="bg-gradient-to-br from-amber-900/20 to-rose-900/20 border-amber-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-400" />
          Critical Permissions Required
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-amber-900/30 border-amber-500/50">
          <AlertDescription className="text-amber-200">
            For reliable emergency alerts and real-time communication, please enable all required permissions.
          </AlertDescription>
        </Alert>

        <div className="space-y-3">
          {/* Notifications */}
          <div className="bg-slate-800/50 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(permissions.notifications)}
              <div>
                <p className="text-white font-medium">Push Notifications</p>
                <p className="text-xs text-slate-400">Critical for emergency alerts and calls</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(permissions.notifications)}
              {permissions.notifications !== 'granted' && (
                <Button 
                  onClick={requestNotifications}
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600"
                >
                  <Bell className="w-4 h-4 mr-1" />
                  Enable
                </Button>
              )}
            </div>
          </div>

          {/* Background Data */}
          <div className="bg-slate-800/50 rounded-lg p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {getStatusIcon(permissions.backgroundData)}
              <div>
                <p className="text-white font-medium">Background Data</p>
                <p className="text-xs text-slate-400">Required for real-time updates</p>
              </div>
            </div>
            {getStatusBadge(permissions.backgroundData)}
          </div>

          {/* Battery Optimization */}
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              {getStatusIcon(permissions.batteryOptimization)}
              <div className="flex-1">
                <p className="text-white font-medium">Battery Optimization</p>
                <p className="text-xs text-slate-400">Must be disabled for this app</p>
              </div>
              {getStatusBadge(permissions.batteryOptimization)}
            </div>
            <div className="mt-3 p-3 bg-slate-900/50 rounded text-sm text-slate-300">
              <p className="font-semibold mb-1">Manual Setup Required:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Go to device Settings → Apps</li>
                <li>Find "SecureGuard" or this app</li>
                <li>Tap Battery → Unrestricted</li>
                <li>Disable battery optimization</li>
              </ol>
            </div>
          </div>

          {/* Auto Launch */}
          <div className="bg-slate-800/50 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-2">
              {getStatusIcon(permissions.autoLaunch)}
              <div className="flex-1">
                <p className="text-white font-medium">Auto Launch</p>
                <p className="text-xs text-slate-400">Allow app to start automatically</p>
              </div>
              {getStatusBadge(permissions.autoLaunch)}
            </div>
            <div className="mt-3 p-3 bg-slate-900/50 rounded text-sm text-slate-300">
              <p className="font-semibold mb-1">Manual Setup Required:</p>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Go to device Settings → Apps</li>
                <li>Find "SecureGuard" or this app</li>
                <li>Enable "Auto-start" or "Auto-launch"</li>
                <li>Allow app to start in background</li>
              </ol>
            </div>
          </div>
        </div>

        <Alert className="bg-rose-900/30 border-rose-500/50">
          <AlertDescription className="text-rose-200 text-sm">
            ⚠️ Without these permissions, you may miss critical emergency alerts, panic buttons, and incoming calls.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}