import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Navigation, Clock, MapPin, Zap, Phone } from "lucide-react";

export default function AlarmNotification({ user }) {
  const queryClient = useQueryClient();
  const audioRef = useRef(null);
  const [trackingArrival, setTrackingArrival] = useState(null);

  const { data: activeAlarms = [], isLoading } = useQuery({
    queryKey: ["activeAlarms", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const alarms = await base44.entities.AlarmResponse.filter({
        assigned_to: user.id,
        status: { $in: ["dispatched", "acknowledged", "en_route"] }
      });
      
      return alarms || [];
    },
    enabled: !!user,
    refetchInterval: 3000, // Real-time sync every 3 seconds
    retry: 3,
    retryDelay: 1000,
    initialData: [],
    staleTime: 0, // Always fetch fresh data
    cacheTime: 0 // Don't cache old alarms
  });

  useEffect(() => {
    if (activeAlarms.length > 0) {
      const hasUnacknowledged = activeAlarms.some(a => a.status === "dispatched");
      
      if (hasUnacknowledged && !audioRef.current) {
        playAlarmSound();
      } else if (!hasUnacknowledged && audioRef.current) {
        stopAlarmSound();
      }
    } else {
      stopAlarmSound();
    }

    return () => stopAlarmSound();
  }, [activeAlarms]);

  useEffect(() => {
    if (trackingArrival && trackingArrival.location) {
      const interval = setInterval(() => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(async (position) => {
            const currentLocation = {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            };

            const distance = calculateDistance(
              currentLocation.lat,
              currentLocation.lng,
              trackingArrival.location.lat,
              trackingArrival.location.lng
            );

            if (distance <= 100) {
              await acknowledgeMutation.mutateAsync({
                alarmId: trackingArrival.alarmId,
                newStatus: "arrived",
                location: currentLocation
              });

              await base44.entities.Alert.create({
                type: "assignment",
                priority: "high",
                title: "Guard Arrived On Scene",
                message: `${user.full_name} has arrived at ${trackingArrival.address}`,
                guard_id: user.id,
                guard_name: user.full_name,
                status: "active"
              });

              setTrackingArrival(null);
              clearInterval(interval);
            }
          });
        }
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [trackingArrival]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const playAlarmSound = () => {
    try {
      const audio = new Audio();
      audio.src = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwPUKXh8bllHAU2jdXvz3wsDiByw+zglEgLCEyo4+ysbBoELIHA8N2SOQcZaLvt559NEAxPqOPwtmMcBjiP1vHNei0GI3fH8N2RQAoVXrTp66hWFApFnt/yvmwhBSuAzvLZiTYIG2m88OOdTgwPUKXh8bllHAU2jdXvz3wsDiByw+zglEgLCEyo4+ysbBoELH/A8N2SOQcZaLru559NEAxPqOPwtmMcBjiP1vHNei0GI3fH8N2RQAoVXrTp66hWFApFnt/yvmwhBSuAzvLZiTYIG2m88OOdTgwPUKXh8bllHAU2jdXvz3wsDiByw+zglEgLCEyo4+ysbBoELH/A8N2SOQcZaLru559NEAxPqOPwtmMcBjiP1vHNei0GI3fH8N2RQAoVXrTp66hWFApFnt/yvmwhBSuAzvLZiTYIG2m88OOdTgwPUKXh8bllHAU2jdXvz3wsDiByw+zglEgLCEyo4+ysbBoELH/A8N2SOQcZaLru559NEAxPqOPwtmMcBjiP1vHNei0GI3fH8N2RQAoVXrTp66hWFApFnt/yvmwhBSuAzvLZiTYIG2m88OOdTgwPUKXh8bllHAU2jdXvz3wsDiByw+zglEgLCEyo4+ysbBoELH/A8N2SOQcZaLru559NEAxPqOPwtmMcBjiP1vHNei0GI3fH8N2RQAoVXrTp66hWFA==";
      audio.loop = true;
      audio.play();
      audioRef.current = audio;
    } catch (error) {
      console.error("Failed to play alarm sound:", error);
    }
  };

  const stopAlarmSound = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  const acknowledgeMutation = useMutation({
    mutationFn: async ({ alarmId, newStatus, location }) => {
      const updateData = {
        status: newStatus
      };

      if (newStatus === "acknowledged") {
        updateData.acknowledged_at = new Date().toISOString();
        updateData.acknowledged_by = user.id;
      } else if (newStatus === "en_route") {
        updateData.en_route_at = new Date().toISOString();
      } else if (newStatus === "arrived") {
        updateData.arrived_at = new Date().toISOString();
        
        const alarm = activeAlarms.find(a => a.id === alarmId);
        if (alarm && alarm.dispatched_at) {
          const responseTime = (new Date() - new Date(alarm.dispatched_at)) / 1000 / 60;
          updateData.response_time_minutes = responseTime;
        }
      }

      if (location) {
        updateData.responder_location = {
          ...location,
          timestamp: new Date().toISOString()
        };
      }

      await base44.entities.AlarmResponse.update(alarmId, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["activeAlarms"]);
    }
  });

  const handleAcknowledge = async (alarm) => {
    await acknowledgeMutation.mutateAsync({
      alarmId: alarm.id,
      newStatus: "acknowledged"
    });
  };

  const handleNavigate = async (alarm) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (position) => {
        const currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        await acknowledgeMutation.mutateAsync({
          alarmId: alarm.id,
          newStatus: "en_route",
          location: currentLocation
        });

        const distance = calculateDistance(
          currentLocation.lat,
          currentLocation.lng,
          alarm.location.lat,
          alarm.location.lng
        );

        const distanceKm = distance / 1000;
        await base44.entities.AlarmResponse.update(alarm.id, {
          distance_to_scene_km: distanceKm
        });

        setTrackingArrival({
          alarmId: alarm.id,
          location: alarm.location,
          address: alarm.address
        });

        const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${alarm.location.lat},${alarm.location.lng}`;
        window.open(mapsUrl, '_blank');
      });
    }
  };

  const priorityColors = {
    critical: "border-rose-500 bg-rose-500/20",
    high: "border-orange-500 bg-orange-500/20",
    medium: "border-amber-500 bg-amber-500/20",
    low: "border-sky-500 bg-sky-500/20"
  };

  if (isLoading || activeAlarms.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {activeAlarms.map((alarm) => (
        <Card
          key={alarm.id}
          className={`border-2 ${priorityColors[alarm.priority]} animate-pulse`}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center animate-bounce">
                  <AlertCircle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white text-lg">
                    🚨 {alarm.alarm_type.replace(/_/g, ' ').toUpperCase()}
                  </CardTitle>
                  <p className="text-sm text-slate-400">{alarm.address}</p>
                </div>
              </div>
              <Badge className={`${
                alarm.priority === 'critical' ? 'bg-rose-600' :
                alarm.priority === 'high' ? 'bg-orange-600' :
                alarm.priority === 'medium' ? 'bg-amber-600' :
                'bg-sky-600'
              } text-white`}>
                {alarm.priority?.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {alarm.description && (
              <p className="text-slate-300">{alarm.description}</p>
            )}

            <div className="grid grid-cols-2 gap-3 text-sm">
              {alarm.client_name && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-sky-400" />
                  <span className="text-slate-300">{alarm.client_name}</span>
                </div>
              )}
              {alarm.client_phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-emerald-400" />
                  <a href={`tel:${alarm.client_phone}`} className="text-sky-400 hover:underline">
                    {alarm.client_phone}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-slate-300">
                  {new Date(alarm.dispatched_at).toLocaleTimeString()}
                </span>
              </div>
              {alarm.distance_to_scene_km && (
                <div className="flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-purple-400" />
                  <span className="text-slate-300">
                    {alarm.distance_to_scene_km.toFixed(1)} km away
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {alarm.status === "dispatched" && (
                <Button
                  onClick={() => handleAcknowledge(alarm)}
                  className="flex-1 bg-amber-600 hover:bg-amber-700"
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Acknowledge
                </Button>
              )}
              {(alarm.status === "acknowledged" || alarm.status === "dispatched") && (
                <Button
                  onClick={() => handleNavigate(alarm)}
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <Navigation className="w-4 h-4 mr-2" />
                  Navigate
                </Button>
              )}
              {alarm.status === "en_route" && (
                <div className="flex-1 p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-lg">
                  <p className="text-emerald-400 font-semibold text-center">
                    📍 En Route - Tracking Your Arrival...
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}