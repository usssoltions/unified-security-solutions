import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Shield, Clock, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { createPageUrl } from "@/utils";
import BrandHeader from "@/components/branding/BrandHeader";
import { getUserDisplayName } from "@/lib/userDisplayName";

// A location object is usable only when it carries real numeric coordinates
// (the (0,0) placeholder is excluded).
const validCoords = (loc) =>
  !!loc &&
  typeof loc.lat === "number" && isFinite(loc.lat) &&
  typeof loc.lng === "number" && isFinite(loc.lng) &&
  !(loc.lat === 0 && loc.lng === 0);

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Gateway invocation — surfaces the server's real, actionable error. */
async function invokeShift(payload) {
  let res;
  try {
    res = await base44.functions.invoke("shiftAccess", payload);
  } catch (e) {
    const d = e?.response?.data;
    throw new Error(d?.error || e?.message || "Shift request failed");
  }
  const d = res?.data !== undefined ? res.data : res;
  if (!d || d.error) throw new Error(d?.error || "Shift request failed");
  return d;
}

export default function ClockInOut({ user, location }) {
  const queryClient = useQueryClient();
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");

  // Server-resolved scheduler mode + validated assigned shift for THIS guard.
  const { data: status, isLoading, isError, refetch } = useQuery({
    queryKey: ["shiftClockStatus", user?.id],
    queryFn: async () => await invokeShift({ action: "status" }),
    enabled: !!user,
    retry: false,
    staleTime: 15000,
    refetchOnWindowFocus: false,
  });

  const schedulerOn = status ? status.scheduler_enabled !== false : null;

  // Scheduler OFF: the authorised active sites the guard may start duty at.
  const { data: sitesData, isLoading: sitesLoading } = useQuery({
    queryKey: ["clockInSites", user?.id],
    queryFn: async () => await invokeShift({ action: "clock_in_sites" }),
    enabled: !!user && schedulerOn === false,
    retry: false,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
  const sites = sitesData?.sites || [];
  useEffect(() => {
    if (!selectedSiteId && sites.length === 1) setSelectedSiteId(sites[0].id);
  }, [sites, selectedSiteId]);

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) || null,
    [sites, selectedSiteId]
  );

  // ── SCHEDULED mode: geofence read-out (enforced server-side at clock-in) ──
  const assignedShift = status?.assigned_shift || null;
  const assignedSite = status?.site || null;
  const scheduledGeofence = !!assignedSite && validCoords(assignedSite);
  const scheduledDistance = scheduledGeofence && validCoords(location)
    ? calculateDistance(location.lat, location.lng, assignedSite.lat, assignedSite.lng)
    : null;
  const scheduledWithin = scheduledDistance !== null
    ? scheduledDistance <= (assignedSite.geofence_radius || 100)
    : false;

  // ── UNSCHEDULED mode: geofence read-out (enforced server-side at clock-in) ──
  const unscheduledGeofence = !!selectedSite && selectedSite.geofence_valid;
  const unscheduledDistance = unscheduledGeofence && validCoords(location)
    ? calculateDistance(location.lat, location.lng, selectedSite.lat, selectedSite.lng)
    : null;
  const unscheduledWithin = unscheduledDistance !== null
    ? unscheduledDistance <= (selectedSite.geofence_radius || 100)
    : false;

  const finishClockIn = () => {
    queryClient.invalidateQueries();
    window.location.href = createPageUrl("StartOfShift");
  };

  const scheduledMutation = useMutation({
    mutationFn: async () => {
      await invokeShift({
        action: "clock_in_scheduled",
        shift_id: assignedShift.id,
        lat: location?.lat,
        lng: location?.lng,
        pin: pin || undefined,
      });
    },
    onSuccess: finishClockIn,
    onError: (error) => setPinError(error.message),
  });

  const unscheduledMutation = useMutation({
    mutationFn: async () => {
      await invokeShift({
        action: "clock_in_unscheduled",
        site_id: selectedSite.id,
        lat: location?.lat,
        lng: location?.lng,
        pin: pin || undefined,
      });
    },
    onSuccess: finishClockIn,
    onError: (error) => setPinError(error.message),
  });

  const busy = scheduledMutation.isPending || unscheduledMutation.isPending;

  const handleClockIn = () => {
    setPinError("");
    if (user.security_pin && pin !== user.security_pin) {
      setPinError("Invalid security PIN");
      return;
    }
    if (schedulerOn) {
      scheduledMutation.mutate();
    } else {
      unscheduledMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  if (isError || schedulerOn === null) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full">
          <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto" />
              <p className="text-slate-300 text-sm">Could not load your shift status. Check your connection and try again.</p>
              <Button onClick={() => refetch()} className="bg-sky-600 hover:bg-sky-700">
                <RefreshCw className="w-4 h-4 mr-2" /> Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── SCHEDULED MODE ──────────────────────────────────────────────────────
  if (schedulerOn) {
    if (!assignedShift) {
      return (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="max-w-md w-full">
            <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-12 pb-12 text-center">
                <Clock className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h2 className="text-2xl font-bold text-white mb-2">No Shift Assigned</h2>
                <p className="text-slate-400 mb-4">You don't have any shifts scheduled for today.</p>
                <p className="text-sm text-slate-500">Please contact your supervisor if you believe this is an error.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    const geofenceBlocked = scheduledGeofence && validCoords(location) && !scheduledWithin;

    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full">
          <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
          <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/30">
            <CardHeader className="text-center">
              <div className="w-20 h-20 bg-sky-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <CardTitle className="text-2xl text-white">Clock In to Start Shift</CardTitle>
              <p className="text-slate-400 mt-2">{assignedSite?.name || assignedShift.site_name || "Loading site..."}</p>
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
                    ) : !scheduledGeofence ? (
                      <Badge className="bg-sky-500">Site Location Not Configured</Badge>
                    ) : !scheduledWithin ? (
                      <div>
                        <Badge className="bg-orange-500 mb-2">Outside Geofence</Badge>
                        <p className="text-sm text-slate-400">
                          Distance: {Math.round(scheduledDistance)}m (must be within {assignedSite.geofence_radius || 100}m)
                        </p>
                      </div>
                    ) : (
                      <div>
                        <Badge className="bg-emerald-500 mb-2">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Within Site Area
                        </Badge>
                        <p className="text-sm text-slate-400">Distance: {Math.round(scheduledDistance)}m from site</p>
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
                  onChange={(e) => { setPin(e.target.value); setPinError(""); }}
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
                disabled={busy || !location || !assignedShift || (scheduledGeofence && validCoords(location) && !scheduledWithin) || (user.security_pin && pin.length !== 4)}
                className="w-full h-14 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Clocking In...
                  </>
                ) : (
                  <>
                    <Navigation className="w-5 h-5 mr-2" /> Clock In Now
                  </>
                )}
              </Button>

              {!location && (
                <p className="text-sm text-center text-amber-400">⚠️ Please enable location services to clock in</p>
              )}
              {geofenceBlocked && (
                <p className="text-sm text-center text-amber-400">⚠️ Move within the site's geofence to clock in</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ── UNSCHEDULED MODE (Scheduler OFF) ────────────────────────────────────
  if (sitesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  const unscheduledBlocked =
    !validCoords(location) ||
    !selectedSite ||
    !unscheduledGeofence ||
    (unscheduledDistance !== null && !unscheduledWithin) ||
    (user.security_pin && pin.length !== 4);

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="max-w-md w-full">
        <BrandHeader user={user} title="My Shift" subtitle={getUserDisplayName(user)} icon={Shield} className="mb-5" />
        <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/30">
          <CardHeader className="text-center">
            <div className="w-20 h-20 bg-sky-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-10 h-10 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">Start an Unscheduled Shift</CardTitle>
            <p className="text-slate-400 mt-2">Select your site — your location is verified against its geofence</p>
          </CardHeader>

          <CardContent className="space-y-6">
            <div>
              <label className="text-white font-medium block mb-2">Site *</label>
              {sites.length === 0 ? (
                <p className="text-sm text-slate-400 bg-slate-900/50 border border-slate-700 rounded-lg p-3">
                  No authorised active sites available. Contact your supervisor.
                </p>
              ) : (
                <select
                  value={selectedSiteId}
                  onChange={(e) => { setSelectedSiteId(e.target.value); setPinError(""); }}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg p-3 text-sm"
                >
                  <option value="">Select a site...</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-emerald-400 mt-1" />
                <div className="flex-1">
                  <p className="text-sm text-slate-400 mb-2">Location Status</p>
                  {!validCoords(location) ? (
                    <div>
                      <Badge className="bg-rose-500 mb-2">Valid GPS Required</Badge>
                      <p className="text-sm text-slate-400">Enable location services — your current position is verified against the site geofence.</p>
                    </div>
                  ) : !selectedSite ? (
                    <Badge className="bg-slate-500">Select a site</Badge>
                  ) : !unscheduledGeofence ? (
                    <div>
                      <Badge className="bg-orange-500 mb-2">Site Geofence Not Configured</Badge>
                      <p className="text-sm text-slate-400">This site has no GPS coordinates or geofence radius set — an administrator must configure it before you can start a shift here.</p>
                    </div>
                  ) : !unscheduledWithin ? (
                    <div>
                      <Badge className="bg-orange-500 mb-2">Outside Geofence</Badge>
                      <p className="text-sm text-slate-400">
                        Distance: {Math.round(unscheduledDistance)}m (must be within {Math.round(selectedSite.geofence_radius || 100)}m)
                      </p>
                    </div>
                  ) : (
                    <div>
                      <Badge className="bg-emerald-500 mb-2">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Within Site Area
                      </Badge>
                      <p className="text-sm text-slate-400">Distance: {Math.round(unscheduledDistance)}m from site</p>
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
                onChange={(e) => { setPin(e.target.value); setPinError(""); }}
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
              disabled={busy || unscheduledBlocked || sites.length === 0}
              className="w-full h-14 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            >
              {busy ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Starting Shift...
                </>
              ) : (
                <>
                  <Navigation className="w-5 h-5 mr-2" /> Start Shift Now
                </>
              )}
            </Button>

            {!validCoords(location) && (
              <p className="text-sm text-center text-amber-400">⚠️ A valid current GPS position is required to start an unscheduled shift</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}