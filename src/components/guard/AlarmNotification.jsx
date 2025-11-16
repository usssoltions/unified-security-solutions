
import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertOctagon, Navigation, CheckCircle2, MapPin, Phone, Clock } from "lucide-react";

export default function AlarmNotification({ user }) {
  const queryClient = useQueryClient();
  const [acknowledging, setAcknowledging] = useState(false);
  const [trackingIntervals, setTrackingIntervals] = useState({});
  const audioRef = useRef(null);

  const playAlertSound = () => {
    try {
      if (!audioRef.current) { // Only play if not already playing or reference is null
        // Base64 encoded WAV audio for a short alert sound
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmGMgjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
        audio.loop = true;
        audio.volume = 0.8; // Set desired volume
        audio.play();
        audioRef.current = audio;
      }
    } catch (error) {
      console.error("Failed to play alert sound:", error);
    }
  };

  const stopAlertSound = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0; // Reset playback to the beginning
      audioRef.current = null;
    }
  };

  const { data: activeAlarms } = useQuery({
    queryKey: ["activeAlarms", user.id],
    queryFn: async () => {
      try {
        const alarms = await base44.entities.AlarmResponse.filter({
          assigned_to: user.id,
          status: ["dispatched", "acknowledged", "en_route"]
        }, "-dispatched_at");

        // Play sound if new alarms are fetched and sound is not already playing
        if (alarms.length > 0 && (!audioRef.current || audioRef.current.paused)) {
          playAlertSound();
        } else if (alarms.length === 0 && audioRef.current) {
          // Stop sound if no active alarms and sound is playing
          stopAlertSound();
        }

        return alarms;
      } catch (error) {
        if (!error?.message?.includes('WebSocket')) {
          console.error("Failed to load alarms:", error);
        }
        return [];
      }
    },
    refetchInterval: 5000,
    initialData: [],
    retry: 3,
    retryDelay: 1000
  });

  useEffect(() => {
    // Cleanup tracking intervals and audio on unmount
    return () => {
      Object.values(trackingIntervals).forEach(interval => clearInterval(interval));
      stopAlertSound(); // Ensure sound stops when component unmounts
    };
  }, [trackingIntervals]);

  const handleAcknowledge = async (alarm) => {
    setAcknowledging(true);
    try {
      await base44.entities.AlarmResponse.update(alarm.id, {
        status: "acknowledged",
        acknowledged_at: new Date().toISOString()
      });

      // Update user location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          try {
            await base44.auth.updateMe({
              last_location: {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                timestamp: new Date().toISOString()
              }
            });
          } catch (error) {
            console.error("Failed to update location:", error);
          }
        });
      }

      queryClient.invalidateQueries(["activeAlarms"]);
    } catch (error) {
      alert("Failed to acknowledge alarm");
    } finally {
      setAcknowledging(false);
    }
  };

  const handleNavigate = async (alarm) => {
    try {
      // Update status to en_route
      await base44.entities.AlarmResponse.update(alarm.id, {
        status: "en_route",
        en_route_at: new Date().toISOString()
      });

      // Open navigation (Google Maps on mobile, browser otherwise)
      const destination = `${alarm.location.lat},${alarm.location.lng}`;
      const url = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
        ? `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
        : `https://www.google.com/maps/search/?api=1&query=${destination}`;
      
      window.open(url, '_blank');

      // Start tracking arrival
      startArrivalTracking(alarm);
    } catch (error) {
      alert("Failed to start navigation");
    }
  };

  const startArrivalTracking = (alarm) => {
    // Clear existing interval if any
    if (trackingIntervals[alarm.id]) {
      clearInterval(trackingIntervals[alarm.id]);
    }

    const interval = setInterval(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          try {
            const distance = calculateDistance(
              position.coords.latitude,
              position.coords.longitude,
              alarm.location.lat,
              alarm.location.lng
            );

            // If within 100m, mark as arrived
            if (distance < 0.1) { // 0.1 km = 100 meters
              await base44.entities.AlarmResponse.update(alarm.id, {
                status: "arrived",
                arrived_at: new Date().toISOString(),
                response_time_minutes: Math.round(
                  (new Date() - new Date(alarm.dispatched_at)) / 60000
                )
              });

              // Notify control room
              await base44.entities.Alert.create({
                type: "system",
                priority: "medium",
                title: "Responder Arrived",
                message: `${user.full_name} has arrived at ${alarm.address || 'the incident location'}`,
                status: "active"
              });

              clearInterval(interval);
              setTrackingIntervals(prev => {
                const newIntervals = { ...prev };
                delete newIntervals[alarm.id];
                return newIntervals;
              });
              queryClient.invalidateQueries(["activeAlarms"]);
            }
          } catch (error) {
            console.error("Arrival tracking error:", error);
          }
        }, (error) => {
          console.error("Geolocation error:", error);
        }, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        });
      }
    }, 10000); // Check every 10 seconds

    setTrackingIntervals(prev => ({ ...prev, [alarm.id]: interval }));
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in kilometers
  };

  if (activeAlarms.length === 0) {
    stopAlertSound(); // Ensure sound stops if all alarms are gone or initially none
    return null;
  }

  const priorityColors = {
    critical: "from-rose-500 to-rose-600",
    high: "from-orange-500 to-orange-600",
    medium: "from-amber-500 to-amber-600",
    low: "from-sky-500 to-sky-600"
  };

  return (
    <div className="space-y-4">
      {activeAlarms.map((alarm) => (
        <Card
          key={alarm.id}
          className={`bg-gradient-to-r ${priorityColors[alarm.priority || 'medium']}/20 border-${alarm.priority === 'critical' ? 'rose' : alarm.priority === 'high' ? 'orange' : 'amber'}-500/50`}
        >
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 bg-gradient-to-br ${priorityColors[alarm.priority || 'medium']} rounded-full flex items-center justify-center animate-pulse`}>
                  <AlertOctagon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white text-lg">
                    {alarm.alarm_type ? alarm.alarm_type.replace(/_/g, ' ').toUpperCase() : 'ALARM'}
                  </CardTitle>
                  <p className="text-sm text-slate-300">{alarm.address || 'Location not specified'}</p>
                </div>
              </div>
              <Badge className={`bg-${alarm.status === 'dispatched' ? 'rose' : alarm.status === 'acknowledged' ? 'amber' : 'emerald'}-500`}>
                {alarm.status || 'pending'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {alarm.description && (
              <p className="text-sm text-white">{alarm.description}</p>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {alarm.client_name && (
                <div className="flex items-center gap-2 text-slate-300">
                  <MapPin className="w-4 h-4" />
                  <span>{alarm.client_name}</span>
                </div>
              )}
              {alarm.client_phone && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Phone className="w-4 h-4" />
                  <a href={`tel:${alarm.client_phone}`} className="hover:text-white">
                    {alarm.client_phone}
                  </a>
                </div>
              )}
              {alarm.dispatched_at && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock className="w-4 h-4" />
                  <span>{new Date(alarm.dispatched_at).toLocaleTimeString()}</span>
                </div>
              )}
              {alarm.distance_to_scene_km && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Navigation className="w-4 h-4" />
                  <span>{alarm.distance_to_scene_km.toFixed(1)} km away</span>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              {alarm.status === "dispatched" && (
                <Button
                  onClick={() => handleAcknowledge(alarm)}
                  disabled={acknowledging}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Acknowledge
                </Button>
              )}
              {(alarm.status === "acknowledged" || alarm.status === "en_route") && alarm.location && (
                <Button
                  onClick={() => handleNavigate(alarm)}
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  {alarm.status === "acknowledged" ? "Start Navigation" : "Continue Navigation"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
