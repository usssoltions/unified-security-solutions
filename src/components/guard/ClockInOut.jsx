import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, MapPin, Shield, Loader2, AlertCircle, Fingerprint, Scan } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ClockInOut({ user, location }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);
  const [nearestSite, setNearestSite] = useState(null);
  const [geofenceValid, setGeofenceValid] = useState(false);
  const [sites, setSites] = useState([]);
  const [biometricSupported, setBiometricSupported] = useState(false);

  useEffect(() => {
    loadSites();
    checkBiometricSupport();
  }, []);

  useEffect(() => {
    if (location && sites.length > 0) {
      validateGeofence();
    }
  }, [location, sites]);

  const checkBiometricSupport = () => {
    if (window.PublicKeyCredential) {
      setBiometricSupported(true);
    }
  };

  const loadSites = async () => {
    const allSites = await base44.entities.Site.list();
    setSites(allSites);
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  };

  const validateGeofence = () => {
    if (!location) return;

    // Find nearest site and check if within geofence
    let nearestDistance = Infinity;
    let nearest = null;
    let isValid = false;

    for (const site of sites) {
      if (site.location) {
        const distance = calculateDistance(
          location.lat,
          location.lng,
          site.location.lat,
          site.location.lng
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = site;
        }

        // Check if within geofence radius
        if (distance <= (site.geofence_radius || 100)) {
          isValid = true;
        }
      }
    }

    setNearestSite(nearest);
    setGeofenceValid(isValid);

    if (!isValid && nearest) {
      setError(
        `You are ${Math.round(nearestDistance)}m from ${nearest.name}. You must be within ${
          nearest.geofence_radius || 100
        }m to clock in.`
      );
    } else {
      setError(null);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      // Web Authentication API for fingerprint/face
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: new Uint8Array(32),
          timeout: 60000,
          userVerification: "required"
        }
      });

      return true;
    } catch (err) {
      console.error("Biometric auth failed:", err);
      return false;
    }
  };

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled");
      }

      if (!geofenceValid) {
        throw new Error("You must be at your assigned site to clock in");
      }

      // Find scheduled shift at this site
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "scheduled",
        site_id: nearestSite.id
      }, "start_time", 1);

      if (!shifts.length) {
        throw new Error(`No scheduled shift found at ${nearestSite.name}`);
      }

      const shift = shifts[0];

      // Update shift to active with clock-in data
      await base44.entities.Shift.update(shift.id, {
        status: "active",
        clock_in: {
          timestamp: new Date().toISOString(),
          location: location,
          verified: true
        }
      });

      // Update user status
      await base44.auth.updateMe({
        is_clocked_in: true,
        current_shift_id: shift.id,
        last_location: {
          ...location,
          timestamp: new Date().toISOString()
        }
      });

      return shift;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["activeShift"]);
      window.location.reload();
    },
    onError: (err) => {
      setError(err.message);
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

  const handleClockIn = async () => {
    if (biometricSupported) {
      const authSuccess = await handleBiometricAuth();
      if (!authSuccess) {
        setError("Biometric authentication failed");
        return;
      }
    }
    clockInMutation.mutate();
  };

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
                {nearestSite && (
                  <p className="text-xs text-slate-500 mt-1">
                    Nearest: {nearestSite.name}
                  </p>
                )}
              </div>
              {geofenceValid && !user.is_clocked_in && (
                <div className="w-3 h-3 bg-emerald-400 rounded-full animate-pulse" />
              )}
            </div>
          </div>

          {!user.is_clocked_in && !geofenceValid && location && nearestSite && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Move closer to {nearestSite.name} to clock in. You must be within{" "}
                {nearestSite.geofence_radius || 100}m of the site.
              </AlertDescription>
            </Alert>
          )}

          <Button
            className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
            onClick={() => user.is_clocked_in ? clockOutMutation.mutate() : handleClockIn()}
            disabled={
              !location || 
              clockInMutation.isPending || 
              clockOutMutation.isPending ||
              (!user.is_clocked_in && !geofenceValid)
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
              <>
                {biometricSupported && <Fingerprint className="w-5 h-5 mr-2" />}
                Clock In {biometricSupported && "(with Biometric)"}
              </>
            )}
          </Button>

          <p className="text-xs text-center text-slate-500">
            {user.is_clocked_in 
              ? "Location and time will be recorded"
              : "Geofence validation required • Biometric authentication enabled"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}