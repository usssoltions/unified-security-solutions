import React, { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, Shield, Clock } from "lucide-react";

export default function ForceSignOutModal({ user }) {
  const audioRef = useRef(null);

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
    try {
      await base44.auth.logout();
    } catch (error) {
      window.location.href = '/';
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
              {new Date().toLocaleString()}
            </p>
          </div>

          <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <p className="text-sm text-sky-200 text-center">
              ℹ️ The next guard cannot sign in until you sign out
            </p>
          </div>

          <Button
            onClick={handleSignOut}
            className="w-full h-16 text-xl font-bold bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600"
          >
            <LogOut className="w-6 h-6 mr-3" />
            Sign Out Now
          </Button>

          <p className="text-xs text-center text-slate-400">
            This is a required step to complete your shift
          </p>
        </CardContent>
      </Card>
    </div>
  );
}