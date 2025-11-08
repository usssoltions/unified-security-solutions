import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Zap } from "lucide-react";

export default function StayAwakeAlert({ shift, onConfirm, location }) {
  const [timeRemaining, setTimeRemaining] = useState(30);
  const [alertSent, setAlertSent] = useState(false);

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

    return () => clearInterval(timer);
  }, []);

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

    onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-4 animate-in fade-in">
      <Card className="max-w-md w-full bg-gradient-to-br from-amber-500/20 to-rose-500/20 border-amber-500">
        <CardHeader className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-amber-500 rounded-full flex items-center justify-center animate-pulse">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">Stay Awake Check</CardTitle>
          <p className="text-slate-300 mt-2">Please confirm you are alert and on duty</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center">
            <div className="text-6xl font-bold text-white mb-2">{timeRemaining}</div>
            <p className="text-slate-400">seconds remaining</p>
          </div>

          <Button
            className="w-full h-14 text-lg font-bold bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            onClick={handleConfirm}
          >
            I'm Awake - Confirm
          </Button>

          <div className="flex items-start gap-2 p-3 bg-slate-900/50 rounded-lg">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300">
              Failure to respond will trigger an alert to the control room
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}