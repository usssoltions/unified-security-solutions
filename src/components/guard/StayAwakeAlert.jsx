import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Zap, Volume2 } from "lucide-react";

export default function StayAwakeAlert({ shift, onConfirm, location, user }) {
  const [timeRemaining, setTimeRemaining] = useState(60);
  const [alertSent, setAlertSent] = useState(false);
  const audioRef = useRef(null);
  const vibrationInterval = useRef(null);

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
      playLoudAlarm();
      startVibration();
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
      stopAlarm();
    };
  }, []);

  const playLoudAlarm = () => {
    try {
      // Create a loud, continuous alarm sound
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // High pitched alarm
      gainNode.gain.setValueAtTime(1.0, audioContext.currentTime); // Max volume
      
      oscillator.start();
      
      // Alternate frequency for siren effect
      setInterval(() => {
        oscillator.frequency.setValueAtTime(
          oscillator.frequency.value === 880 ? 440 : 880,
          audioContext.currentTime
        );
      }, 500);
      
      audioRef.current = { audioContext, oscillator, gainNode };

      // Also try to play notification sound if available
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⚡ STAY AWAKE CHECK!', {
          body: 'Confirm you are alert immediately!',
          requireInteraction: true,
          tag: 'stay-awake',
          vibrate: [200, 100, 200, 100, 200]
        });
      }
    } catch (error) {
      console.error("Failed to play alarm:", error);
    }
  };

  const startVibration = () => {
    if ('vibrate' in navigator) {
      vibrationInterval.current = setInterval(() => {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }, 2000);
    }
  };

  const stopAlarm = () => {
    if (audioRef.current) {
      try {
        audioRef.current.oscillator.stop();
        audioRef.current.audioContext.close();
      } catch (e) {}
      audioRef.current = null;
    }
    
    if (vibrationInterval.current) {
      clearInterval(vibrationInterval.current);
      navigator.vibrate(0);
    }
  };

  const handleMissed = async (alertTime) => {
    await base44.entities.Alert.create({
      type: "stay_awake",
      priority: "critical",
      title: "⚠️ MISSED STAY AWAKE RESPONSE",
      message: `Guard ${shift.guard_name} did not respond to stay awake alert - IMMEDIATE ACTION REQUIRED`,
      guard_id: shift.guard_id,
      guard_name: shift.guard_name,
      shift_id: shift.id,
      status: "active"
    });

    // Send to all supervisors/admins
    const admins = await base44.entities.User.filter({
      role_type: { $in: ['admin', 'dispatcher', 'supervisor'] }
    });

    for (const admin of admins) {
      await base44.functions.invoke('sendNotification', {
        recipient_id: admin.id,
        type: 'incident_critical',
        priority: 'critical',
        title: '⚠️ GUARD NOT RESPONDING',
        message: `${shift.guard_name} missed stay awake check - verify immediately!`,
        related_entity: 'alert',
        related_id: shift.id
      });
    }
  };

  const handleConfirm = async () => {
    const responseTime = new Date().toISOString();
    const alertTime = new Date(Date.now() - (60 - timeRemaining) * 1000).toISOString();

    await base44.entities.StayAwakeLog.create({
      guard_id: shift.guard_id,
      guard_name: shift.guard_name,
      shift_id: shift.id,
      alert_time: alertTime,
      response_time: responseTime,
      response_method: "button",
      location: location,
      status: "acknowledged",
      response_time_seconds: 60 - timeRemaining
    });

    stopAlarm();
    onConfirm();
  };

  return (
    <div className="fixed inset-0 bg-rose-900/98 z-[9999] flex items-center justify-center p-4 animate-pulse">
      <Card className="max-w-md w-full bg-gradient-to-br from-rose-600/50 to-orange-600/50 border-4 border-rose-500 shadow-2xl animate-bounce">
        <CardHeader className="text-center border-b-4 border-rose-500">
          <div className="w-32 h-32 mx-auto mb-4 bg-rose-500 rounded-full flex items-center justify-center animate-ping">
            <Zap className="w-16 h-16 text-white" />
          </div>
          <CardTitle className="text-4xl text-white mb-3 animate-pulse">
            🚨 STAY AWAKE CHECK 🚨
          </CardTitle>
          <div className="flex items-center justify-center gap-2 text-rose-100 text-xl">
            <Volume2 className="w-6 h-6 animate-bounce" />
            <p>CONFIRM YOU ARE ALERT!</p>
            <Volume2 className="w-6 h-6 animate-bounce" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="text-center">
            <div className="text-9xl font-bold text-white mb-4 animate-pulse drop-shadow-[0_0_30px_rgba(255,255,255,0.8)]">
              {timeRemaining}
            </div>
            <p className="text-white text-2xl font-bold animate-pulse">SECONDS TO RESPOND!</p>
          </div>

          <Button
            className="w-full h-24 text-3xl font-bold bg-emerald-500 hover:bg-emerald-600 shadow-2xl animate-pulse border-4 border-white"
            onClick={handleConfirm}
          >
            ✓ I AM AWAKE - CONFIRM NOW!
          </Button>

          <div className="flex items-start gap-3 p-6 bg-rose-950/90 rounded-lg border-4 border-rose-500 animate-pulse">
            <AlertCircle className="w-8 h-8 text-rose-300 flex-shrink-0 mt-1 animate-bounce" />
            <p className="text-lg text-rose-100 font-bold leading-relaxed">
              ⚠️ CRITICAL: No response will trigger IMMEDIATE ALERT to control room and supervisors!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}