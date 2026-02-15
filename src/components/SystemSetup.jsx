import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle2, X } from "lucide-react";

export default function SystemSetup() {
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [isDismissed, setIsDismissed] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    // Check if setup was previously completed
    const setupCompleted = localStorage.getItem("systemSetupCompleted");
    if (setupCompleted === "true") {
      setIsDismissed(true);
      return;
    }

    // Check notification permission
    if ("Notification" in window) {
      setNotificationPermission(Notification.permission);
      setIsEnabled(Notification.permission !== "granted");
    }
  }, []);

  const handleEnableNotifications = async () => {
    if ("Notification" in window) {
      try {
        const permission = await Notification.requestPermission();
        setNotificationPermission(permission);
        
        if (permission === "granted") {
          localStorage.setItem("systemSetupCompleted", "true");
          setIsEnabled(false);
          setTimeout(() => {
            setIsDismissed(true);
          }, 2000);
        } else if (permission === "denied") {
          // Mark as attempted even if denied to prevent repeated prompts
          localStorage.setItem("systemSetupCompleted", "true");
          localStorage.setItem("notificationsFailed", "true");
        }
      } catch (error) {
        // Silently fail and mark as attempted
        localStorage.setItem("systemSetupCompleted", "true");
        localStorage.setItem("notificationsFailed", "true");
        setIsDismissed(true);
      }
    }
  };

  const handleDismiss = () => {
    // Mark as dismissed even if not fully set up
    localStorage.setItem("systemSetupCompleted", "true");
    setIsDismissed(true);
  };

  // Don't show if dismissed or already granted
  if (isDismissed || notificationPermission === "granted") {
    return null;
  }

  return (
    <Card className="bg-slate-800/50 border-slate-700 relative mb-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDismiss}
        className="absolute top-2 right-2 h-6 w-6 text-slate-400 hover:text-white z-10"
      >
        <X className="h-4 w-4" />
      </Button>

      <CardHeader className="pb-3 pr-10">
        <CardTitle className="text-white text-sm flex items-center gap-2">
          Setup Required
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-white">Enable Notifications</span>
          </div>
          <Button
            size="sm"
            onClick={handleEnableNotifications}
            className="bg-amber-500 hover:bg-amber-600 text-white text-xs flex-shrink-0"
          >
            Enable
          </Button>
        </div>

        {notificationPermission === "denied" && (
          <p className="text-xs text-slate-400 px-3">
            Notifications blocked. Enable in device settings if needed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}