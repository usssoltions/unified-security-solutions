import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { getSite } from "@/lib/siteApi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Shield, Clock, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { createPageUrl } from "@/utils";
import BrandHeader from "@/components/branding/BrandHeader";
import { getUserDisplayName } from "@/lib/userDisplayName";
import { useNavigate } from "react-router-dom";

// A location object is usable only when it carries real numeric coordinates
// (the (0,0) placeholder is excluded). Missing site or device GPS must NEVER
// crash the guard app — geofence validation is simply skipped instead.
const validCoords = (loc) =>
  !!loc &&
  typeof loc.lat === "number" &&
  typeof loc.lng === "number" &&
  !(loc.lat === 0 && loc.lng === 0);

export default function ClockInOut({ user, location }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [distance, setDistance] = useState(null);
  const [isWithinGeofence, setIsWithinGeofence] = useState(false);

  const { data: assignedShift, isLoading } = useQuery({
    queryKey: ["assignedShift", user?.id],
    queryFn: async () => {
      if (!user) return null;
      
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: { $in: ["scheduled", "accepted"] }
      });
      
      // Find shift for today
      const todayShift = shifts.find(s => {
        const shiftDate = new Date(s.start_time);
        const shiftDay = new Date(shiftDate.getFullYear(), shiftDate.getMonth(), shiftDate.getDate());
        return shiftDay.getTime() === today.getTime();
      });
      
      return todayShift || null;
    },
    enabled: !!user,
  });

  // Realtime subscription for shift updates (replaces 10s polling).
  useEffect(() => {
    if (!user) return;
    const unsub = base44.entities.Shift.subscribe(() => {
      queryClient.invalidateQueries(["assignedShift", user.id]);
    });
    return () => unsub();
  }, [user, queryClient]);

  const { data: assignedSite } = useQuery({
    queryKey: ["assignedSite", assignedShift?.site_id],
    queryFn: async () => {
      if (!assignedShift?.site_id) return null;
      return await getSite(assignedShift.site_id);
    },
    enabled: !!assignedShift?.site_id
  });

  useEffect(() => {
    // NULL-SAFE geofence maths: only runs when BOTH the device GPS and the
    // site's configured coordinates are valid. A site with no GPS (the live
    // "USS LIVE TEST SITE" case) previously crashed the whole app here with
    // "Cannot read properties of null (reading 'lat')".
    if (assignedSite && validCoords(assignedSite.location) && validCoords(location)) {
      const dist = calculateDistance(
        location.lat,
        location.lng,
        assignedSite.location.lat,
        assignedSite.location.lng
      );
      setDistance(dist);
      setIsWithinGeofence(dist <= (assignedSite.geofence_radius || 100));
    } else {
      setDistance(null);
      setIsWithinGeofence(false);
    }
  }, [assignedSite, location]);

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

  const validatePin = (enteredPin) => {
    if (!user.security_pin) return true;
    return enteredPin === user.security_pin;
  };

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled to clock in");
      }

      // Geofence is enforced ONLY when the site has valid coordinates — a
      // site without configured GPS can never be validated and must not block
      // the shift (and previously crashed: assignedSite.location was null).
      if (assignedSite && validCoords(assignedSite.location) && !isWithinGeofence) {
        throw new Error(`You must be within ${assignedSite.geofence_radius || 100}m of the site to clock in`);
      }

      if (!validatePin(pin)) {
        throw new Error("Invalid security PIN");
      }

      // Update shift to active status
      await base44.entities.Shift.update(assignedShift.id, {
        status: "active",
        clock_in: {
          timestamp: new Date().toISOString(),
          location: location,
          verified: true
        }
      });

      // Update user authentication state - mark as needing start of shift report
      await base44.auth.updateMe({
        is_clocked_in: true,
        current_shift_id: assignedShift.id,
        last_clock_in: new Date().toISOString(),
        last_location: {
          ...location,
          timestamp: new Date().toISOString()
        },
        needs_start_of_shift_report: true
      });

    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      // Force reload to ensure page is registered
      window.location.href = createPageUrl("StartOfShift");
    },
    onError: (error) => {
      setPinError(error.message);
    }
  });

  const handleClockIn = () => {
    setPinError("");
    clockInMutation.mutate();
  };

  // Geofence is only enforceable when the site has valid GPS configured.
  const enforceGeofence = !!assignedSite && validCoords(assignedSite.location);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  if (!assignedShift) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full">
          <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
        <Card className="max-w-md w-full bg-slate-800/50 border-slate-700">
          <CardContent className="pt-12 pb-12 text-center">
            <Clock className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-white mb-2">No Shift Assigned</h2>
            <p className="text-slate-400 mb-4">
              You don't have any shifts scheduled for today.
            </p>
            <p className="text-sm text-slate-500">
              Please contact your supervisor if you believe this is an error.
            </p>
          </CardContent>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full">
        <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
      <Card className="max-w-md w-full bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/30">
        <CardHeader className="text-center">
          <div className="w-20 h-20 bg-sky-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">Clock In to Start Shift</CardTitle>
          <p className="text-slate-400 mt-2">{assignedSite?.name || "Loading site..."}</p>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-sky-400 mt-1" />
              <div>
                <p className="text-sm text-slate-400">Shift Time</p>
                <p className="text-white font-semibold">
                  {new Date(assignedShift.start_time).toLocaleTimeString()} - 
                  {new Date(assignedShift.end_time).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-emerald-400 mt-1" />
              <div className="flex-1">
                <p className="text-sm text-slate-400 mb-2">Location Status</p>
                {!location ? (
                  <Badge className="bg-rose-500">GPS Not Available</Badge>
                ) : !assignedSite ? (
                  <Badge className="bg-slate-500">Loading Site...</Badge>
                ) : !enforceGeofence ? (
                  <Badge className="bg-sky-500">Site Location Not Configured</Badge>
                ) : !isWithinGeofence ? (
                  <div>
                    <Badge className="bg-orange-500 mb-2">Outside Geofence</Badge>
                    <p className="text-sm text-slate-400">
                      Distance: {Math.round(distance)}m (must be within {assignedSite?.geofence_radius || 100}m)
                    </p>
                  </div>
                ) : (
                  <div>
                    <Badge className="bg-emerald-500 mb-2">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Within Site Area
                    </Badge>
                    <p className="text-sm text-slate-400">
                      Distance: {Math.round(distance)}m from site
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-white font-medium block mb-2">
              Security PIN {user.security_pin && "*"}
            </label>
            <Input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setPinError("");
              }}
              placeholder="Enter your PIN"
              className="bg-slate-900 border-slate-700 text-white text-center text-2xl tracking-widest"
              maxLength={4}
            />
            {pinError && (
              <div className="flex items-center gap-2 mt-2 text-rose-400 text-sm">
                <AlertTriangle className="w-4 h-4" />
                {pinError}
              </div>
            )}
          </div>

          <Button
            onClick={handleClockIn}
            disabled={clockInMutation.isPending || !location || !assignedSite || (enforceGeofence && !isWithinGeofence) || (user.security_pin && pin.length !== 4)}
            className="w-full h-14 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
          >
            {clockInMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Clocking In...
              </>
            ) : (
              <>
                <Navigation className="w-5 h-5 mr-2" />
                Clock In Now
              </>
            )}
          </Button>

          {!location && (
            <p className="text-sm text-center text-amber-400">
              ⚠️ Please enable location services to clock in
            </p>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}