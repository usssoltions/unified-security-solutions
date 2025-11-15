import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, LogOut, Clock, Loader2 } from "lucide-react";

export default function ShiftEndNotification({ shift, user, location }) {
  const [showNotification, setShowNotification] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!shift || !shift.end_time) return;

    const checkShiftEnd = () => {
      const endTime = new Date(shift.end_time);
      const now = new Date();
      
      // Show notification if shift end time has passed
      if (now >= endTime) {
        setShowNotification(true);
      }
    };

    checkShiftEnd();
    const interval = setInterval(checkShiftEnd, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [shift]);

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

  if (!showNotification) return null;

  return (
    <Card className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-500/50 animate-pulse">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-white animate-bounce" />
          </div>
          <div>
            <CardTitle className="text-white">Shift Time Complete</CardTitle>
            <p className="text-sm text-amber-200">Your scheduled shift has ended</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-slate-900/50 rounded-lg border border-amber-500/30">
          <div className="flex items-center gap-2 text-slate-300 mb-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold">Shift ended at:</span>
          </div>
          <p className="text-white text-lg">
            {new Date(shift.end_time).toLocaleString()}
          </p>
        </div>

        <p className="text-slate-300 text-sm">
          Please clock out to complete your shift and log your final location.
        </p>

        <Button
          onClick={() => clockOutMutation.mutate()}
          disabled={clockOutMutation.isPending || !location}
          className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 h-12 text-lg font-semibold"
        >
          {clockOutMutation.isPending ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Clocking Out...
            </>
          ) : (
            <>
              <LogOut className="w-5 h-5 mr-2" />
              Clock Out Now
            </>
          )}
        </Button>

        {!location && (
          <p className="text-xs text-rose-400 text-center">
            ⚠️ Waiting for GPS location...
          </p>
        )}
      </CardContent>
    </Card>
  );
}