
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"; // Added useMutation, useQueryClient
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Send, Loader2, AlertOctagon, MapPin } from "lucide-react";

export default function DispatchAlarm({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    alarm_type: "burglary",
    priority: "high",
    address: "",
    location: { lat: 0, lng: 0 },
    client_name: "",
    client_phone: "",
    description: "",
    assigned_to: ""
  });
  // submitting state is replaced by dispatchMutation.isLoading
  // const [submitting, setSubmitting] = useState(false);
  // user state and loadUser effect are removed as user is fetched within the mutationFn
  // const [user, setUser] = useState(null);

  // useEffect(() => {
  //   loadUser();
  // }, []);

  // const loadUser = async () => {
  //   const currentUser = await base44.auth.me();
  //   setUser(currentUser);
  // };

  const queryClient = useQueryClient(); // Initialize query client

  const { data: activeGuards } = useQuery({
    queryKey: ["activeGuardsForDispatch"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      const users = await base44.entities.User.list();
      return shifts.map(shift => {
        const guard = users.find(u => u.id === shift.guard_id);
        return {
          ...shift,
          guard_full_name: guard?.full_name || shift.guard_name,
          last_location: guard?.last_location
        };
      });
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

  const geocodeAddress = async () => {
    if (!formData.address) return;
    
    // Simple geocoding using browser Geolocation API or mock
    // In production, use Google Maps Geocoding API
    setFormData({
      ...formData,
      location: { lat: -33.9249 + Math.random() * 0.1, lng: 18.4241 + Math.random() * 0.1 }
    });
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const findNearestGuard = () => {
    if (!formData.location.lat || activeGuards.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;

    activeGuards.forEach(guard => {
      if (guard.last_location?.lat) {
        const distance = calculateDistance(
          formData.location.lat,
          formData.location.lng,
          guard.last_location.lat,
          guard.last_location.lng
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { guard, distance };
        }
      });

    return nearest;
  };

  const dispatchMutation = useMutation({
    mutationFn: async (alarmPayload) => {
      const currentUser = await base44.auth.me(); // Fetch user within mutation

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
              type: 'alarm_response', // Changed from 'alarm' for clarity
              id: alarm.id,
              alarm_type: alarmPayload.alarm_type
            }
          });
        } catch (error) {
          console.error('Failed to send push notification:', error);
          // Continue even if notification fails
        }
      }

      // Create alert for assigned guard
      await base44.entities.Alert.create({
        type: "system", // Changed from "assignment" to "system" as per typical alert types
        priority: alarmPayload.priority,
        title: `ALARM DISPATCH: ${alarmPayload.alarm_type.replace(/_/g, ' ').toUpperCase()}`, // Updated title format
        message: `You have been assigned to respond to ${alarmPayload.address}. ${alarmPayload.description}`, // Updated message
        guard_id: alarmPayload.assigned_to,
        guard_name: alarmPayload.assigned_to_name,
        status: "active",
        metadata: { 
          alarm_response_id: alarm.id,
          requires_acknowledgment: true 
        }
      });

      return alarm;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["alarmResponses"]);
      alert("Alarm dispatched successfully!"); // Keep alert for now
      onSuccess();
    },
    onError: (error) => {
      console.error("Failed to dispatch alarm:", error);
      alert("Failed to dispatch alarm"); // Keep alert for now
    }
  });

  const handleDispatch = async () => {
    if (!formData.address || !formData.assigned_to) {
      alert("Please fill in required fields");
      return;
    }

    // setSubmitting(true); // Replaced by dispatchMutation.isLoading

    try {
      const assignedGuard = activeGuards.find(g => g.guard_id === formData.assigned_to);
      const distance = assignedGuard?.last_location ? calculateDistance(
        formData.location.lat,
        formData.location.lng,
        assignedGuard.last_location.lat,
        assignedGuard.last_location.lng
      ) : 0;

      const payload = {
        ...formData,
        assigned_to_name: assignedGuard?.guard_full_name,
        distance_to_scene_km: distance
      };

      await dispatchMutation.mutateAsync(payload);

      // alert("Alarm dispatched successfully!"); // Moved to onSuccess
      // onSuccess(); // Moved to onSuccess
    } catch (error) {
      // alert("Failed to dispatch alarm"); // Moved to onError
      // console.error(error); // Moved to onError
    } finally {
      // setSubmitting(false); // Replaced by dispatchMutation.isLoading
    }
  };

  const nearestGuard = findNearestGuard();

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-2xl bg-slate-800 border-rose-500/50">
          <CardHeader>
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
          <CardContent className="space-y-4">
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
                Address <span className="text-rose-400">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  placeholder="Full street address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white flex-1"
                />
                <Button onClick={geocodeAddress} variant="outline" className="border-slate-600">
                  <MapPin className="w-4 h-4" />
                </Button>
              </div>
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
                className="bg-slate-900 border-slate-700 text-white min-h-24"
              />
            </div>

            {nearestGuard && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <p className="text-xs text-emerald-400 font-semibold mb-1">Nearest Available Guard:</p>
                <p className="text-sm text-white">{nearestGuard.guard.guard_full_name}</p>
                <p className="text-xs text-slate-400">{nearestGuard.distance.toFixed(2)} km away</p>
              </div>
            )}

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Assign Responder <span className="text-rose-400">*</span>
              </label>
              <Select
                value={formData.assigned_to}
                onValueChange={(value) => setFormData({ ...formData, assigned_to: value })}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Select guard..." />
                </SelectTrigger>
                <SelectContent>
                  {activeGuards.map((guard) => (
                    <SelectItem key={guard.guard_id} value={guard.guard_id}>
                      {guard.guard_full_name} - {guard.site_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDispatch}
                disabled={dispatchMutation.isLoading} // Use mutation loading state
                className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
              >
                {dispatchMutation.isLoading ? ( // Use mutation loading state
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
