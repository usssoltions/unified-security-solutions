
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Send, Loader2, AlertOctagon, MapPin } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import AIDispatchRecommendation from "./AIDispatchRecommendation";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const incidentIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#ef4444" stroke="white" stroke-width="2"/>
      <text x="16" y="22" font-size="20" text-anchor="middle" fill="white">!</text>
    </svg>
  `),
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const guardIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="14" fill="#10b981" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="16" r="4" fill="white"/>
    </svg>
  `),
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
});

const nearestGuardIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,' + btoa(`
    <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="18" fill="#3b82f6" stroke="white" stroke-width="3"/>
      <circle cx="20" cy="20" r="12" fill="white" opacity="0.3"/>
      <circle cx="20" cy="20" r="5" fill="white"/>
    </svg>
  `),
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -40]
});

function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom);
    }
  }, [center, zoom, map]);
  return null;
}

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
  const [mapCenter, setMapCenter] = useState([-33.9249, 18.4241]);
  const [mapZoom, setMapZoom] = useState(10);
  const [routeCoordinates, setRouteCoordinates] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState(null);
  const [showAIRecommendations, setShowAIRecommendations] = useState(true);

  const queryClient = useQueryClient();

  const { data: activeGuards = [], isLoading: guardsLoading } = useQuery({
    queryKey: ["activeGuardsForDispatch"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      const guardsList = [];
      
      for (const shift of shifts) {
        try {
          const user = await base44.entities.User.get(shift.guard_id);
          if (user?.last_location?.lat && user?.last_location?.lng) {
            guardsList.push({
              ...shift,
              guard_id: shift.guard_id,
              guard_full_name: user.full_name || shift.guard_name,
              guard_location: {
                lat: parseFloat(user.last_location.lat),
                lng: parseFloat(user.last_location.lng)
              }
            });
          }
        } catch (error) {
          console.error(`Failed to fetch user for shift ${shift.id}:`, error);
        }
      }
      
      return guardsList;
    },
    retry: 2
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
          const newLocation = {
            lat: parseFloat(position.coords.latitude),
            lng: parseFloat(position.coords.longitude)
          };
          
          setFormData(prev => ({
            ...prev,
            location: newLocation
          }));
          setMapCenter([newLocation.lat, newLocation.lng]);
          setMapZoom(15);
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
    const lat1Num = parseFloat(lat1);
    const lon1Num = parseFloat(lon1);
    const lat2Num = parseFloat(lat2);
    const lon2Num = parseFloat(lon2);
    
    if (isNaN(lat1Num) || isNaN(lon1Num) || isNaN(lat2Num) || isNaN(lon2Num)) {
      console.error('Invalid coordinates:', { lat1, lon1, lat2, lon2 });
      return 0;
    }
    
    const R = 6371; // Earth's radius in km
    const dLat = (lat2Num - lat1Num) * (Math.PI / 180);
    const dLon = (lon2Num - lon1Num) * (Math.PI / 180);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1Num * (Math.PI / 180)) * Math.cos(lat2Num * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return Math.round(distance * 10) / 10;
  };

  const calculateETA = (distanceKm) => {
    const avgSpeed = 40;
    const hours = distanceKm / avgSpeed;
    const minutes = Math.round(hours * 60);
    return minutes;
  };

  const findNearestGuard = () => {
    if (!formData.location?.lat || !formData.location?.lng || activeGuards.length === 0) {
      return null;
    }

    let nearest = null;
    let minDistance = Infinity;

    activeGuards.forEach(guard => {
      if (guard.guard_location?.lat && guard.guard_location?.lng) {
        const distance = calculateDistance(
          guard.guard_location.lat,
          guard.guard_location.lng,
          formData.location.lat,
          formData.location.lng
        );
        
        if (distance < minDistance && distance > 0) {
          minDistance = distance;
          nearest = { guard, distance };
        }
      }
    });

    return nearest;
  };

  const nearestGuard = findNearestGuard();

  useEffect(() => {
    if (nearestGuard && formData.location) {
      const coords = [
        [nearestGuard.guard.guard_location.lat, nearestGuard.guard.guard_location.lng],
        [formData.location.lat, formData.location.lng]
      ];
      setRouteCoordinates(coords);
      
      const eta = calculateETA(nearestGuard.distance);
      setEstimatedTime(eta);

      const bounds = L.latLngBounds(coords);
      const center = bounds.getCenter();
      setMapCenter([center.lat, center.lng]);
      setMapZoom(12);
    } else {
      setRouteCoordinates(null);
      setEstimatedTime(null);
    }
  }, [nearestGuard, formData.location]);

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

      if ((alarmPayload.priority === 'critical' || alarmPayload.priority === 'high') && alarmPayload.assigned_to) {
        try {
          await base44.functions.invoke('sendPushNotification', {
            user_ids: [alarmPayload.assigned_to],
            title: 'Emergency Alarm Response',
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

      await base44.entities.Alert.create({
        type: "assignment",
        priority: alarmPayload.priority,
        title: "Alarm Response Assigned",
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
    
    let distance = 0;
    if (assignedGuard?.guard_location?.lat && assignedGuard?.guard_location?.lng) {
      distance = calculateDistance(
        assignedGuard.guard_location.lat,
        assignedGuard.guard_location.lng,
        formData.location.lat,
        formData.location.lng
      );
    }

    const payload = {
      ...formData,
      assigned_to_name: assignedGuard?.guard_full_name,
      distance_to_scene_km: distance,
      responder_location: assignedGuard?.guard_location
    };

    dispatchMutation.mutate(payload);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <Card className="w-full max-w-6xl bg-slate-800 border-rose-500/50 max-h-[95vh] flex flex-col">
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">
                    Alarm Type <span className="text-rose-400">*</span>
                  </label>
                  <Select
                    value={formData.alarm_type}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, alarm_type: value }))}
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
                    onValueChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}
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
                    onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
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
                    Location set: {formData.location.lat.toFixed(6)}, {formData.location.lng.toFixed(6)}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Client Name</label>
                  <Input
                    placeholder="Client name"
                    value={formData.client_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, client_name: e.target.value }))}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>

                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Client Phone</label>
                  <Input
                    placeholder="Contact number"
                    value={formData.client_phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, client_phone: e.target.value }))}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Description</label>
                <Textarea
                  placeholder="Additional details about the alarm..."
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="bg-slate-900 border-slate-700 text-white min-h-20"
                />
              </div>

              {formData.location && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showAIRecommendations}
                    onChange={(e) => setShowAIRecommendations(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <label className="text-sm text-slate-300">Show AI recommendations</label>
                </div>
              )}

              {formData.location && showAIRecommendations && (
                <AIDispatchRecommendation
                  incident={formData}
                  onSelectGuard={(guardId, guardName) => setFormData(prev => ({ ...prev, assigned_to: guardId }))}
                  selectedGuard={formData.assigned_to}
                />
              )}

              {!showAIRecommendations && (
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">
                    Manual Guard Selection <span className="text-rose-400">*</span>
                  </label>
                  {guardsLoading ? (
                    <div className="text-slate-400 text-sm">Loading guards...</div>
                  ) : activeGuards.length === 0 ? (
                    <div className="text-amber-400 text-sm p-3 bg-amber-500/10 border border-amber-500/20 rounded">
                      No active guards available
                    </div>
                  ) : (
                    <select
                      value={formData.assigned_to}
                      onChange={(e) => setFormData(prev => ({ ...prev, assigned_to: e.target.value }))}
                      className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2"
                    >
                      <option value="">Select guard...</option>
                      {activeGuards.map((guard) => {
                        const dist = formData.location?.lat && guard.guard_location?.lat 
                          ? calculateDistance(
                              guard.guard_location.lat,
                              guard.guard_location.lng,
                              formData.location.lat,
                              formData.location.lng
                            )
                          : null;
                        
                        return (
                          <option key={guard.guard_id} value={guard.guard_id}>
                            {guard.guard_full_name} - {guard.site_name}
                            {dist !== null && dist > 0 ? ` (${dist.toFixed(1)}km)` : ''}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="h-[500px] rounded-lg overflow-hidden border-2 border-slate-700">
                {formData.location ? (
                  <MapContainer
                    center={mapCenter}
                    zoom={mapZoom}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom={true}
                  >
                    <MapController center={mapCenter} zoom={mapZoom} />
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'
                    />
                    
                    <Marker 
                      position={[formData.location.lat, formData.location.lng]}
                      icon={incidentIcon}
                    >
                      <Popup>
                        <div className="text-center">
                          <p className="font-bold text-rose-600">Incident Location</p>
                          <p className="text-sm">{formData.address}</p>
                        </div>
                      </Popup>
                    </Marker>
                    
                    <Circle
                      center={[formData.location.lat, formData.location.lng]}
                      radius={500}
                      pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.1 }}
                    />
                    
                    {activeGuards.map((guard) => {
                      if (!guard.guard_location?.lat || !guard.guard_location?.lng) return null;
                      
                      const isSelected = formData.assigned_to === guard.guard_id;
                      const dist = calculateDistance(
                        guard.guard_location.lat,
                        guard.guard_location.lng,
                        formData.location.lat,
                        formData.location.lng
                      );
                      
                      return (
                        <Marker 
                          key={guard.guard_id}
                          position={[guard.guard_location.lat, guard.guard_location.lng]}
                          icon={isSelected ? nearestGuardIcon : guardIcon}
                        >
                          <Popup>
                            <div className="text-center">
                              <p className="font-bold text-emerald-600">{guard.guard_full_name}</p>
                              {isSelected && <p className="text-xs text-sky-500 font-bold">SELECTED</p>}
                              <p className="text-sm">{guard.site_name}</p>
                              <p className="text-xs text-gray-600">{dist.toFixed(1)} km away</p>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                    
                    {routeCoordinates && formData.assigned_to && (
                      <Polyline
                        positions={routeCoordinates}
                        pathOptions={{ 
                          color: '#3b82f6', 
                          weight: 4, 
                          opacity: 0.7,
                          dashArray: '10, 10'
                        }}
                      />
                    )}
                  </MapContainer>
                ) : (
                  <div className="h-full flex items-center justify-center bg-slate-900">
                    <div className="text-center">
                      <MapPin className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400">Set incident location to view map</p>
                      <Button
                        onClick={getCurrentLocation}
                        className="mt-4 bg-sky-600 hover:bg-sky-700"
                      >
                        <MapPin className="w-4 h-4 mr-2" />
                        Get Current Location
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
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
