import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Zap } from "lucide-react";

export default function StayAwakeAlert({ shift, onConfirm, location }) {
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [alertSent, setAlertSent] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    const alertTime = new Date().toISOString();
    
    if (!alertSent) {
      base44.entities.StayAwakeLog.create({
        guard_id: shift.guard_id,
        guard_name: shift.guard_name,
        shift_id: shift.id,
        alert_time: alertTime,
        status: "sent"
      });
      setAlertSent(true);
      playAlertSound();
    }

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          handleMissed(alertTime);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(timer);
      stopAlertSound();
    };
  }, []);

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

  const handleMissed = async (alertTime) => {
    await base44.entities.Alert.create({
      type: "stay_awake",
      priority: "high",
      title: "Missed Stay Awake Response",
      message: `Guard ${shift.guard_name} did not respond to stay awake alert`,
      guard_id: shift.guard_id,
      guard_name: shift.guard_name,
      shift_id: shift.id,
      status: "active"
    });
  };

  const handleConfirm = async () => {
    const responseTime = new Date().toISOString();
    const alertTime = new Date(Date.now() - (30 - timeRemaining) * 1000).toISOString();

    await base44.entities.StayAwakeLog.create({
      guard_id: shift.guard_id,
      guard_name: shift.guard_name,
      shift_id: shift.id,
      alert_time: alertTime,
      response_time: responseTime,
      response_method: "button",
      location: location,
      status: "acknowledged",
      response_time_seconds: 30 - timeRemaining
    });

    stopAlertSound();
    onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/98 z-[9999] flex items-center justify-center p-4 animate-in fade-in">
      <Card className="max-w-md w-full bg-gradient-to-br from-amber-500/30 to-rose-500/30 border-2 border-amber-500 shadow-2xl">
        <CardHeader className="text-center">
          <div className="w-24 h-24 mx-auto mb-4 bg-amber-500 rounded-full flex items-center justify-center animate-pulse">
            <Zap className="w-12 h-12 text-white" />
          </div>
          <CardTitle className="text-3xl text-white mb-2">⚡ Stay Awake Check</CardTitle>
          <p className="text-amber-100 text-lg">Please confirm you are alert and on duty</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <div className="text-7xl font-bold text-white mb-3 animate-pulse">{timeRemaining}</div>
            <p className="text-slate-300 text-xl">seconds remaining</p>
          </div>

          <Button
            className="w-full h-20 text-2xl font-bold bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 shadow-lg"
            onClick={handleConfirm}
          >
            ✓ I'm Awake - Confirm
          </Button>

          <div className="flex items-start gap-3 p-4 bg-slate-900/70 rounded-lg border border-amber-500/30">
            <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-slate-200">
              <strong>Important:</strong> Failure to respond will trigger an alert to the control room
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}