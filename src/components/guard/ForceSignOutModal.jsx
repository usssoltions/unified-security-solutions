import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { signOutCompletedShift } from "@/lib/shiftHandover";
import { appParams } from "@/lib/app-params";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, Shield, Clock } from "lucide-react";

export default function ForceSignOutModal({ user, shift }) {
  const audioRef = useRef(null);
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    playNotificationSound();

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const playNotificationSound = () => {
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
      audio.play();
      audioRef.current = audio;
    } catch (error) {
      console.error("Failed to play sound:", error);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOutCompletedShift(user, shift, () => base44.auth.logout(`${window.location.origin}/`), appParams.token);
      // Remove only this guard's shift caches; other modules are untouched.
      for (const key of ["activeShift", "shiftClockStatus", "clockInSites", "upcomingShifts"]) {
        queryClient.removeQueries({ queryKey: [key, user.id] });
      }
    } catch {
      // Never pretend logout succeeded by navigating back into the same session.
      setSignOutError("Sign-out could not be completed. Please try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/98 z-[9999] flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-gradient-to-br from-orange-500/20 to-rose-500/20 border-2 border-orange-500 shadow-2xl">
        <CardHeader className="text-center border-b border-orange-500/30">
          <div className="w-20 h-20 mx-auto mb-4 bg-orange-500 rounded-full flex items-center justify-center">
            <Shield className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl text-white mb-2">
            Shift Complete - Sign Out Required
          </CardTitle>
          <p className="text-orange-200">
            You have successfully clocked out. Please sign out to allow the next guard to sign in.
          </p>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          <div className="p-5 bg-slate-900/70 rounded-lg border border-orange-500/30">
            <div className="flex items-center gap-3 text-slate-300 mb-3">
              <Clock className="w-5 h-5 text-orange-400" />
              <span className="font-semibold">Clock Out Time:</span>
            </div>
            <p className="text-white text-lg font-bold">
              {new Date(shift.clock_out.timestamp).toLocaleString()}
            </p>
          </div>

          <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <p className="text-sm text-sky-200 text-center">
              ℹ️ The next guard cannot sign in until you sign out
            </p>
          </div>

          {signOutError && <p role="alert" className="text-sm text-center text-rose-300">{signOutError}</p>}
          <Button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full h-16 text-xl font-bold bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600"
          >
            <LogOut className="w-6 h-6 mr-3" />
            {signingOut ? "Signing Out…" : "Sign Out Now"}
          </Button>

          <p className="text-xs text-center text-slate-400">
            This is a required step to complete your shift
          </p>
        </CardContent>
      </Card>
    </div>
  );
}