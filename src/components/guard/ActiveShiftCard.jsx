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

  return (
    <Card className="bg-gradient-to-r from-sky-500/10 to-sky-600/10 border-sky-500/20">
      <CardHeader className="p-3 sm:p-4 lg:p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-white text-base sm:text-lg lg:text-xl truncate">Active Shift</CardTitle>
              <p className="text-xs sm:text-sm text-sky-300 truncate">{shift.site_name}</p>
            </div>
          </div>
          <Badge className="bg-emerald-500 text-xs sm:text-sm flex-shrink-0">
            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full animate-pulse mr-1 sm:mr-2" />
            On Duty
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4 lg:p-6 pt-0">
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:gap-4">
          <div className="p-2 sm:p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-1 sm:gap-2 text-slate-400 mb-1">
              <Clock className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs">Duration</span>
            </div>
            <p className="text-base sm:text-lg font-bold text-white">{calculateDuration()}</p>
          </div>

          <div className="p-2 sm:p-3 bg-slate-800/50 rounded-lg">
            <div className="flex items-center gap-1 sm:gap-2 text-slate-400 mb-1">
              <MapPin className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
              <span className="text-xs">Location</span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-white">
              {location ? "GPS Active" : "No Signal"}
            </p>
          </div>
        </div>

        <div className="p-3 sm:p-4 bg-slate-900/50 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-400 mb-1 sm:mb-2">Shift Time</p>
          <p className="text-xs sm:text-sm text-white">
            {new Date(shift.start_time).toLocaleTimeString()} - 
            {new Date(shift.end_time).toLocaleTimeString()}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          <Button
            className="bg-sky-600 hover:bg-sky-700 text-xs sm:text-sm py-2 sm:py-3"
            onClick={() => navigate(createPageUrl("QRScanner"))}
          >
            <Navigation className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            Scan
          </Button>
          <Button
            className="bg-rose-600 hover:bg-rose-700 text-xs sm:text-sm py-2 sm:py-3"
            onClick={() => clockOutMutation.mutate()}
            disabled={clockOutMutation.isPending || !location}
          >
            {clockOutMutation.isPending ? (
              <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2 animate-spin" />
            ) : (
              <LogOut className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
            )}
            Clock Out
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}