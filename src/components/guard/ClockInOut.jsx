import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, MapPin, Shield, Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ClockInOut({ user, location }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);

  const clockInMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled");
      }

      // Find scheduled shift
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "scheduled"
      }, "start_time", 1);

      if (!shifts.length) {
        throw new Error("No scheduled shift found");
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
              : "Start your shift and begin patrol"}
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
              <div>
                <p className="text-sm text-slate-400">GPS Location</p>
                <p className="font-semibold text-white">
                  {location 
                    ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
                    : "Acquiring..."}
                </p>
              </div>
            </div>
          </div>

          <Button
            className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
            onClick={() => user.is_clocked_in ? clockOutMutation.mutate() : clockInMutation.mutate()}
            disabled={!location || clockInMutation.isPending || clockOutMutation.isPending}
          >
            {(clockInMutation.isPending || clockOutMutation.isPending) ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : user.is_clocked_in ? (
              "Clock Out"
            ) : (
              "Clock In"
            )}
          </Button>

          <p className="text-xs text-center text-slate-500">
            Location and time will be recorded for compliance
          </p>
        </CardContent>
      </Card>
    </div>
  );
}