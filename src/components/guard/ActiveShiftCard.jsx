import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, Shield, Navigation, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function ActiveShiftCard({ shift, user, location }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showClockOut, setShowClockOut] = useState(false);
  
  const calculateDuration = () => {
    if (!shift.clock_in?.timestamp) return "0h 0m";
    const start = new Date(shift.clock_in.timestamp);
    const now = new Date();
    const diff = now - start;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      if (!location) {
        throw new Error("Location services must be enabled");
      }

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
    },
    onError: (error) => {
      alert("Clock out failed: " + error.message);
    }
  });

  if (showClockOut) {
    return (
      <Card className="bg-gradient-to-r from-rose-500/10 to-rose-600/10 border-rose-500/20">
        <CardHeader>
          <CardTitle className="text-white text-center">Confirm Clock Out</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-slate-300 text-center">
            Are you sure you want to clock out of your shift at {shift.site_name}?
          </p>
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-sm text-slate-400">Duration</p>
            <p className="text-lg font-bold text-white">{calculateDuration()}</p>
          </div>
          {location && (
            <div className="p-3 bg-slate-900/50 rounded-lg">
              <p className="text-sm text-slate-400">Clock Out Location</p>
              <p className="text-xs text-white">{location.lat.toFixed(6)}, {location.lng.toFixed(6)}</p>
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowClockOut(false)}
              className="flex-1 border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={() => clockOutMutation.mutate()}
              disabled={clockOutMutation.isPending || !location}
              className="flex-1 bg-rose-600 hover:bg-rose-700"
            >
              {clockOutMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Clocking Out...
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4 mr-2" />
                  Confirm Clock Out
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-r from-sky-500/10 to-sky-600/10 border-sky-500/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-white">Active Shift</CardTitle>
              <p className="text-sm text-sky-300">{shift.site_name}</p>
            </div>
          </div>
          <Badge className="bg-emerald-500">
            <div className="w-2 h-2 bg-white rounded-full animate-pulse mr-2" />
            On Duty
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Clock className="w-4 h-4" />
              <span className="text-xs">Duration</span>
            </div>
            <p className="text-lg font-bold text-white">{calculateDuration()}</p>
          </div>

          <div className="p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <MapPin className="w-4 h-4" />
              <span className="text-xs">Location</span>
            </div>
            <p className="text-sm font-semibold text-white">
              {location ? "GPS Active" : "No Signal"}
            </p>
          </div>
        </div>

        <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 mb-2">Shift Time</p>
          <p className="text-sm text-white">
            {new Date(shift.start_time).toLocaleTimeString()} - 
            {new Date(shift.end_time).toLocaleTimeString()}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Button
            className="bg-sky-600 hover:bg-sky-700"
            onClick={() => navigate(createPageUrl("QRScanner"))}
          >
            <Navigation className="w-4 h-4 mr-2" />
            Scan Checkpoint
          </Button>
          <Button
            variant="outline"
            className="border-rose-500 text-rose-400 hover:bg-rose-500/10"
            onClick={() => setShowClockOut(true)}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Clock Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}