import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { 
  AlertTriangle, 
  Clock, 
  Battery, 
  MapPin, 
  X, 
  Bell,
  Zap
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RealTimeAlertMonitor({ user }) {
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());
  const [soundPlayed, setSoundPlayed] = useState(new Set());
  const queryClient = useQueryClient();

  // Fetch active critical alerts
  const { data: criticalAlerts = [] } = useQuery({
    queryKey: ["criticalAlerts"],
    queryFn: async () => {
      const alerts = await base44.entities.Alert.filter({ 
        status: "active",
        priority: "critical"
      }, "-created_date", 50);
      return alerts;
    },
    refetchInterval: 5000, // Check every 5 seconds
    initialData: []
  });

  // Subscribe to real-time alert updates
  useEffect(() => {
    const unsubscribe = base44.entities.Alert.subscribe((event) => {
      if (event.type === "create" && event.data?.priority === "critical") {
        queryClient.invalidateQueries(["criticalAlerts"]);
        
        // Only play sound once per alert
        if (!soundPlayed.has(event.data.id)) {
          playAlertSound();
          setSoundPlayed(prev => new Set(prev).add(event.data.id));
          
          // Vibrate if supported
          if (navigator.vibrate) {
            navigator.vibrate([200, 100, 200]);
          }
        }
      }
    });

    return unsubscribe;
  }, [queryClient, soundPlayed]);

  const playAlertSound = () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = "sine";
    gainNode.gain.value = 0.3;

    oscillator.start();
    setTimeout(() => oscillator.stop(), 200);
  };

  const handleDismiss = async (alertId) => {
    setDismissedAlerts(prev => new Set(prev).add(alertId));
    
    try {
      await base44.entities.Alert.update(alertId, {
        status: "acknowledged",
        acknowledged_by: user.id,
        acknowledged_at: new Date().toISOString()
      });
      queryClient.invalidateQueries(["criticalAlerts"]);
    } catch (error) {
      console.error("Failed to acknowledge alert:", error);
    }
  };

  const handleDismissAll = async () => {
    const alertIds = visibleAlerts.map(a => a.id);
    setDismissedAlerts(prev => {
      const newSet = new Set(prev);
      alertIds.forEach(id => newSet.add(id));
      return newSet;
    });
    
    try {
      for (const alertId of alertIds) {
        await base44.entities.Alert.update(alertId, {
          status: "acknowledged",
          acknowledged_by: user.id,
          acknowledged_at: new Date().toISOString()
        });
      }
      queryClient.invalidateQueries(["criticalAlerts"]);
    } catch (error) {
      console.error("Failed to acknowledge alerts:", error);
    }
  };

  const getAlertIcon = (type) => {
    switch (type) {
      case "missed_checkin":
        return <Clock className="w-5 h-5" />;
      case "low_battery":
        return <Battery className="w-5 h-5" />;
      case "panic":
        return <AlertTriangle className="w-5 h-5" />;
      case "geofence_breach":
        return <MapPin className="w-5 h-5" />;
      default:
        return <Bell className="w-5 h-5" />;
    }
  };

  const visibleAlerts = criticalAlerts.filter(
    alert => !dismissedAlerts.has(alert.id)
  );

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 w-full max-w-md space-y-2">
      {visibleAlerts.length > 1 && (
        <div className="flex justify-end">
          <Button
            onClick={handleDismissAll}
            size="sm"
            className="bg-slate-800 hover:bg-slate-700 text-white shadow-lg"
          >
            Dismiss All ({visibleAlerts.length})
          </Button>
        </div>
      )}
      <AnimatePresence>
        {visibleAlerts.map((alert) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: 300, scale: 0.8 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 300, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
          >
            <Card className="bg-rose-500 border-rose-600 shadow-2xl">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                    {getAlertIcon(alert.type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="font-bold text-white text-sm">
                        {alert.title}
                      </h4>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-white hover:bg-white/20 flex-shrink-0"
                        onClick={() => handleDismiss(alert.id)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <p className="text-white/90 text-sm mb-2">
                      {alert.message}
                    </p>
                    
                    <div className="flex items-center gap-2 text-xs text-white/80">
                      {alert.guard_name && (
                        <Badge variant="outline" className="border-white/30 text-white">
                          {alert.guard_name}
                        </Badge>
                      )}
                      {alert.site_id && (
                        <Badge variant="outline" className="border-white/30 text-white">
                          <MapPin className="w-3 h-3 mr-1" />
                          Site
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}