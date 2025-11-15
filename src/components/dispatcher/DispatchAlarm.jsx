import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Send, Loader2, AlertOctagon, MapPin } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export default function DispatchAlarm({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    alarm_type: "burglary",
    priority: "high",
    address: "",
    location: null,
    client_name: "",
    client_phone: "",
    description: "",
    assigned_to: ""
  });
  const [showMap, setShowMap] = useState(false);

  const queryClient = useQueryClient();

  const { data: activeGuards } = useQuery({
    queryKey: ["activeGuardsForDispatch"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      const users = await base44.entities.User.list();
      return shifts.map(shift => {
        const guard = users.find(u => u.id === shift.guard_id);
        return {
          ...shift,
          guard_id: shift.guard_id,
          guard_full_name: guard?.full_name || shift.guard_name,
          guard_location: guard?.last_location
        };
      }).filter(g => g.guard_location?.lat && g.guard_location?.lng);
    },
    initialData: []
  });

  const alarmTypes = [
    { value: "burglary", label: "Burglary" },
    { value: "panic", label: "Panic Alarm" },
    { value: "medical", label: "Medical Emergency" },
    { value: "fire", label: "Fire Alarm" },
    { value: "armed_robbery", label: "Armed Robbery" },
    { value: "suspicious_activity", label: "Suspicious Activity" },
    { value: "false_alarm", label: "False Alarm" },
    { value: "general", label: "General Alarm" }
  ];

  const priorities = [
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" }
  ];

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFormData({
            ...formData,
            location: {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
          });
          setShowMap(true);
        },
        (error) => {
          alert("Unable to get current location. Please enable location services.");
          console.error("Geolocation error:", error);
        }
      );
    } else {
      alert("Geolocation is not supported by this browser.");
    }
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of Earth in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distance in km
  };

  const findNearestGuard = () => {
    if (!formData.location?.lat || activeGuards.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;

    activeGuards.forEach(guard => {
      if (guard.guard_location?.lat && guard.guard_location?.lng) {
        const distance = calculateDistance(
          formData.location.lat,
          formData.location.lng,
          guard.guard_location.lat,
          guard.guard_location.lng
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { guard, distance };
        }
      }
    });

    return nearest;
  };

  const dispatchMutation = useMutation({
    mutationFn: async (alarmPayload) => {
      const currentUser = await base44.auth.me();

      const alarm = await base44.entities.AlarmResponse.create({
        ...alarmPayload,
        dispatched_by: currentUser.id,
        dispatched_by_name: currentUser.full_name,
        dispatched_at: new Date().toISOString(),
        status: "dispatched"
      });

      // Send push notification to assigned guard for critical/high priority alarms
      if ((alarmPayload.priority === 'critical' || alarmPayload.priority === 'high') && alarmPayload.assigned_to) {
        try {
          await base44.functions.invoke('sendPushNotification', {
            user_ids: [alarmPayload.assigned_to],
            title: '🚨 Emergency Alarm Response',
            body: `${alarmPayload.alarm_type.replace(/_/g, ' ').toUpperCase()} at ${alarmPayload.address}`,
            priority: alarmPayload.priority,
            data: {
              type: 'alarm',
              id: alarm.id,
              alarm_type: alarmPayload.alarm_type
            }
          });
        } catch (error) {
          console.error('Failed to send push notification:', error);
        }
      }

      // Create alert for assigned guard
      await base44.entities.Alert.create({
        type: "assignment",
        priority: alarmPayload.priority,
        title: "🚨 Alarm Response Assigned",
        message: `You have been dispatched to respond to ${alarmPayload.alarm_type.replace(/_/g, ' ')} at ${alarmPayload.address}. ${alarmPayload.client_name ? `Client: ${alarmPayload.client_name}` : ''}`,
        guard_id: alarmPayload.assigned_to,
        guard_name: alarmPayload.assigned_to_name,
        status: "active",
        metadata: { alarm_id: alarm.id, address: alarmPayload.address }
      });

      return alarm;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["alarmResponses"]);
      onSuccess();
    }
  });

  const handleDispatch = async () => {
    if (!formData.address || !formData.assigned_to) {
      alert("Please fill in required fields");
      return;
    }

    if (!formData.location) {
      alert("Please set location using the GPS button");
      return;
    }

    const assignedGuard = activeGuards.find(g => g.guard_id === formData.assigned_to);
    const distance = assignedGuard?.guard_location?.lat && assignedGuard?.guard_location?.lng ? calculateDistance(
      formData.location.lat,
      formData.location.lng,
      assignedGuard.guard_location.lat,
      assignedGuard.guard_location.lng
    ) : 0;

    const payload = {
      ...formData,
      assigned_to_name: assignedGuard?.guard_full_name,
      distance_to_scene_km: distance,
      responder_location: assignedGuard?.guard_location
    };

    dispatchMutation.mutate(payload);
  };

  const nearestGuard = findNearestGuard();

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl bg-slate-800 border-rose-500/50 max-h-[90vh] flex flex-col">
        <CardHeader className="border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center animate-pulse">
                <AlertOctagon className="w-6 h-6 text-white" />
              </div>
              <CardTitle className="text-white text-xl">Dispatch Alarm Response</CardTitle>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
              <X />
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="overflow-y-auto flex-1 p-6">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Alarm Type <span className="text-rose-400">*</span>
                </label>
                <Select
                  value={formData.alarm_type}
                  onValueChange={(value) => setFormData({ ...formData, alarm_type: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {alarmTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Priority <span className="text-rose-400">*</span>
                </label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => setFormData({ ...formData, priority: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((priority) => (
                      <SelectItem key={priority.value} value={priority.value}>
                        {priority.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Incident Address <span className="text-rose-400">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="Full street address where guard must respond"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white flex-1"
                />
                <Button 
                  onClick={getCurrentLocation} 
                  variant="outline" 
                  className="border-slate-600"
                  type="button"
                >
                  <MapPin className="w-4 h-4" />
                </Button>
              </div>
              {formData.location && (
                <p className="text-xs text-emerald-400 mt-1">
                  ✓ Incident location set: {formData.location.lat.toFixed(6)}, {formData.location.lng.toFixed(6)}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Client Name</label>
                <Input
                  placeholder="Client name"
                  value={formData.client_name}
                  onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Client Phone</label>
                <Input
                  placeholder="Contact number"
                  value={formData.client_phone}
                  onChange={(e) => setFormData({ ...formData, client_phone: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Description</label>
              <Textarea
                placeholder="Additional details about the alarm..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-20"
              />
            </div>

            {nearestGuard && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <p className="text-xs text-emerald-400 font-semibold mb-1">📍 Nearest Available Guard:</p>
                <p className="text-sm text-white">{nearestGuard.guard.guard_full_name}</p>
                <p className="text-xs text-slate-400">{nearestGuard.distance.toFixed(2)} km from incident location</p>
              </div>
            )}

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Assign Responder <span className="text-rose-400">*</span>
              </label>
              <Select
                value={formData.assigned_to}
                onValueChange={(value) => {
                  const guard = activeGuards.find(g => g.guard_id === value);
                  setFormData({ ...formData, assigned_to: value });
                  
                  // Show guard location on map if available
                  if (guard?.guard_location?.lat && guard?.guard_location?.lng && formData.location) {
                    setShowMap(true);
                  }
                }}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Select guard..." />
                </SelectTrigger>
                <SelectContent>
                  {activeGuards.map((guard) => (
                    <SelectItem key={guard.guard_id} value={guard.guard_id}>
                      {guard.guard_full_name} - {guard.site_name}
                      {formData.location && guard.guard_location && ` (${calculateDistance(
                        formData.location.lat,
                        formData.location.lng,
                        guard.guard_location.lat,
                        guard.guard_location.lng
                      ).toFixed(1)}km away)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showMap && formData.location && (
              <div className="h-48 rounded-lg overflow-hidden border border-slate-700">
                <MapContainer
                  center={[formData.location.lat, formData.location.lng]}
                  zoom={13}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; OpenStreetMap contributors'
                  />
                  <Marker position={[formData.location.lat, formData.location.lng]}>
                    <Popup>Incident Location (Where Guard Responds)</Popup>
                  </Marker>
                  {formData.assigned_to && activeGuards.find(g => g.guard_id === formData.assigned_to)?.guard_location && (
                    <Marker 
                      position={[
                        activeGuards.find(g => g.guard_id === formData.assigned_to).guard_location.lat,
                        activeGuards.find(g => g.guard_id === formData.assigned_to).guard_location.lng
                      ]}
                    >
                      <Popup>Guard's Current Location</Popup>
                    </Marker>
                  )}
                </MapContainer>
              </div>
            )}
          </div>
        </CardContent>

        <div className="border-t border-slate-700 p-4 flex-shrink-0">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDispatch}
              disabled={dispatchMutation.isPending}
              className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
            >
              {dispatchMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5 mr-2" />
                  Dispatch Now
                </>
              )}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}