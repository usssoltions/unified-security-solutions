import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, LogOut, Clock, Loader2, Plus } from "lucide-react";

export default function ShiftEndNotification({ shift, user, location }) {
  const [showNotification, setShowNotification] = useState(false);
  const [showExtendForm, setShowExtendForm] = useState(false);
  const [extendHours, setExtendHours] = useState(1);
  const [extendReason, setExtendReason] = useState("");
  const queryClient = useQueryClient();
  const audioRef = React.useRef(null);

  useEffect(() => {
    if (!shift || !shift.end_time) return;

    const checkShiftEnd = () => {
      const endTime = new Date(shift.end_time);
      const now = new Date();
      
      if (now >= endTime && !showNotification) {
        setShowNotification(true);
        playAlertSound();
      }
    };

    checkShiftEnd();
    const interval = setInterval(checkShiftEnd, 30000);

    return () => clearInterval(interval);
  }, [shift, showNotification]);

  const playAlertSound = () => {
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
      audio.loop = true;
      audio.volume = 1.0;
      audio.play();
      audioRef.current = audio;
    } catch (error) {
      console.error("Failed to play alert sound:", error);
    }
  };

  const stopAlertSound = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
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

      stopAlertSound();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      window.location.reload();
    },
    onError: (error) => {
      alert("Clock out failed: " + error.message);
    }
  });

  const extendShiftMutation = useMutation({
    mutationFn: async () => {
      const newEndTime = new Date(shift.end_time);
      newEndTime.setHours(newEndTime.getHours() + extendHours);

      await base44.entities.Shift.update(shift.id, {
        end_time: newEndTime.toISOString(),
        notes: `${shift.notes || ''}\nShift extended by ${extendHours} hour(s). Reason: ${extendReason}`,
        is_overtime: true
      });

      stopAlertSound();
      setShowNotification(false);
      setShowExtendForm(false);
      setExtendReason("");
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["activeShift"]);
      alert("✅ Shift extended successfully");
    },
    onError: (error) => {
      alert("Failed to extend shift: " + error.message);
    }
  });

  if (!showNotification) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/98 z-[9999] flex items-center justify-center p-4 animate-in fade-in">
      <Card className="w-full max-w-lg bg-gradient-to-br from-orange-500/20 to-rose-500/20 border-orange-500 shadow-2xl">
        <CardHeader className="text-center border-b border-orange-500/30">
          <div className="w-20 h-20 mx-auto mb-4 bg-orange-500 rounded-full flex items-center justify-center animate-pulse">
            <AlertCircle className="w-10 h-10 text-white animate-bounce" />
          </div>
          <CardTitle className="text-3xl text-white mb-2">⏰ Shift Time Complete</CardTitle>
          <p className="text-orange-200">Your scheduled shift has ended</p>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="p-5 bg-slate-900/70 rounded-xl border-2 border-orange-500/30">
            <div className="flex items-center gap-3 text-slate-300 mb-3">
              <Clock className="w-6 h-6 text-orange-400" />
              <span className="text-lg font-semibold">Shift ended at:</span>
            </div>
            <p className="text-white text-2xl font-bold">
              {new Date(shift.end_time).toLocaleString()}
            </p>
          </div>

          {!showExtendForm ? (
            <>
              <p className="text-slate-200 text-center text-lg">
                Please clock out to complete your shift or extend if working longer.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  onClick={() => setShowExtendForm(true)}
                  className="h-16 text-lg border-2 border-sky-500 text-sky-400 hover:bg-sky-500/20"
                >
                  <Plus className="w-5 h-5 mr-2" />
                  Extend Shift
                </Button>
                <Button
                  onClick={() => clockOutMutation.mutate()}
                  disabled={clockOutMutation.isPending || !location}
                  className="h-16 text-lg bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 font-bold"
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
              </div>
            </>
          ) : (
            <>
              <div className="space-y-4">
                <div>
                  <label className="text-white font-semibold block mb-2">
                    Extend shift by how many hours?
                  </label>
                  <Input
                    type="number"
                    min="0.5"
                    max="8"
                    step="0.5"
                    value={extendHours}
                    onChange={(e) => setExtendHours(parseFloat(e.target.value))}
                    className="bg-slate-900 border-slate-700 text-white text-lg h-12"
                  />
                </div>

                <div>
                  <label className="text-white font-semibold block mb-2">
                    Reason for extension <span className="text-rose-400">*</span>
                  </label>
                  <Textarea
                    placeholder="Why are you working longer than scheduled?"
                    value={extendReason}
                    onChange={(e) => setExtendReason(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-white min-h-24"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowExtendForm(false);
                    setExtendReason("");
                  }}
                  className="h-14 border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => extendShiftMutation.mutate()}
                  disabled={!extendReason.trim() || extendShiftMutation.isPending}
                  className="h-14 bg-sky-600 hover:bg-sky-700 font-semibold"
                >
                  {extendShiftMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Extending...
                    </>
                  ) : (
                    `Extend ${extendHours}h`
                  )}
                </Button>
              </div>
            </>
          )}

          {!location && (
            <p className="text-rose-400 text-center font-semibold animate-pulse">
              ⚠️ Waiting for GPS location...
            </p>
          )}

          <p className="text-xs text-slate-400 text-center">
            This alert will persist until you take action
          </p>
        </CardContent>
      </Card>
    </div>
  );
}