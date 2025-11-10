import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Clock, MapPin, Shield, Loader2, AlertCircle, Lock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ClockInOut({ user, location }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);
  const [assignedSite, setAssignedSite] = useState(null);
  const [geofenceValid, setGeofenceValid] = useState(false);
  const [distanceToSite, setDistanceToSite] = useState(null);
  const [pin, setPin] = useState("");

  const { data: assignedShift } = useQuery({
    queryKey: ["assignedShift", user?.id],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "scheduled"
      }, "start_time", 1);
      
      return shifts[0] || null;
    },
    enabled: !!user,
    initialData: null
  });

  useEffect(() => {
    if (assignedShift && location) {
      loadAssignedSite();
    }
  }, [assignedShift, location]);

  const loadAssignedSite = async () => {
    if (!assignedShift?.site_id) return;
    
    try {
      const site = await base44.entities.Site.get(assignedShift.site_id);
      setAssignedSite(site);
      
      if (site.location && location) {
        const distance = calculateDistance(
          location.lat,
          location.lng,
          site.location.lat,
          site.location.lng
        );
        
        setDistanceToSite(distance);
        
        const radius = site.geofence_radius || 100;
        const isValid = distance <= radius;
        setGeofenceValid(isValid);
        
        if (!isValid) {
          setError(
            `You are ${Math.round(distance)}m from ${site.name}. You must be within ${radius}m to clock in.`
          );
        } else {
          setError(null);
        }
      }
    } catch (err) {
      console.error("Failed to load assigned site:", err);
      setError("Failed to load your assigned site");
    }
  };

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

  const validatePin = () => {
    const userPin = user.security_pin || "1234";
    return pin === userPin;
  };

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled");
      }

      if (!assignedShift) {
        throw new Error("No scheduled shift found for you");
      }

      if (!geofenceValid) {
        throw new Error(`You must be within ${assignedSite?.geofence_radius || 100}m of ${assignedSite?.name || 'your assigned site'}`);
      }

      if (!validatePin()) {
        throw new Error("Invalid PIN. Please check your PIN and try again.");
      }

      await base44.entities.Shift.update(assignedShift.id, {
        status: "active",
        clock_in: {
          timestamp: new Date().toISOString(),
          location: location,
          verified: true
        }
      });

      await base44.auth.updateMe({
        is_clocked_in: true,
        current_shift_id: assignedShift.id,
        last_location: {
          ...location,
          timestamp: new Date().toISOString()
        }
      });

      return assignedShift;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["activeShift"]);
      window.location.reload();
    },
    onError: (err) => {
      setError(err.message);
      setPin("");
    }
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled");
      }

      const shift = await base44.entities.Shift.get(user.current_shift_id);

      await base44.entities.Shift.update(shift.id, {
        status: "completed",
        clock_out: {
          timestamp: new Date().toISOString(),
          location: location
        }
      });

      await base44.auth.updateMe({
        is_clocked_in: false,
        current_shift_id: null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      window.location.reload();
    }
  });

  if (!assignedShift) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
          <CardContent className="py-12 text-center">
            <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-white text-lg mb-2">No Scheduled Shift</p>
            <p className="text-slate-400">
              You don't have any scheduled shifts at this time. Please contact your dispatcher.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-800/50 border-slate-700">
        <CardHeader className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">
            {user.is_clocked_in ? "Clock Out" : "Clock In"}
          </CardTitle>
          <p className="text-slate-400 mt-2">
            {user.is_clocked_in 
              ? "End your shift and log your final location" 
              : "Start your shift - must be at assigned site"}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {assignedSite && (
            <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
              <p className="text-sm text-slate-400 mb-1">Your Assigned Site</p>
              <p className="text-white font-semibold text-lg">{assignedSite.name}</p>
              <p className="text-xs text-slate-500 mt-1">{assignedSite.address}</p>
            </div>
          )}

          <div className="space-y-3 p-4 bg-slate-900/50 rounded-lg">
            <div className="flex items-center gap-3 text-slate-300">
              <Clock className="w-5 h-5 text-sky-400" />
              <div>
                <p className="text-sm text-slate-400">Current Time</p>
                <p className="font-semibold text-white">
                  {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-slate-300">
              <MapPin className="w-5 h-5 text-emerald-400" />
              <div className="flex-1">
                <p className="text-sm text-slate-400">GPS Location</p>
                <p className="font-semibold text-white">
                  {location 
                    ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
                    : "Acquiring..."}
                </p>
                {assignedSite && distanceToSite !== null && (
                  <p className="text-xs text-slate-500 mt-1">
                    Distance to site: {Math.round(distanceToSite)}m
                  </p>
                )}
              </div>
              {geofenceValid && !user.is_clocked_in && (
                <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
              )}
            </div>
          </div>

          {!user.is_clocked_in && !geofenceValid && location && assignedSite && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Move closer to {assignedSite.name} to clock in. You must be within{" "}
                {assignedSite.geofence_radius || 100}m of the site.
              </AlertDescription>
            </Alert>
          )}

          {!user.is_clocked_in && (
            <div className="space-y-2">
              <label className="text-sm text-slate-400 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Enter your 4-digit PIN
              </label>
              <Input
                type="password"
                placeholder="• • • •"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                className="bg-slate-900 border-slate-700 text-white text-center text-2xl tracking-widest"
                autoFocus
              />
              <p className="text-xs text-slate-500 text-center">
                Default PIN: 1234 (contact admin to change)
              </p>
            </div>
          )}

          <Button
            className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
            onClick={() => user.is_clocked_in ? clockOutMutation.mutate() : clockInMutation.mutate()}
            disabled={
              !location || 
              clockInMutation.isPending || 
              clockOutMutation.isPending ||
              (!user.is_clocked_in && !geofenceValid) ||
              (!user.is_clocked_in && pin.length !== 4)
            }
          >
            {(clockInMutation.isPending || clockOutMutation.isPending) ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : user.is_clocked_in ? (
              "Clock Out"
            ) : (
              "Clock In with PIN"
            )}
          </Button>

          <p className="text-xs text-center text-slate-500">
            {user.is_clocked_in 
              ? "Location and time will be recorded"
              : "Geofence validation required • PIN authentication"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}