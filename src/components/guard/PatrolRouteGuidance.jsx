import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navigation, MapPin, CheckCircle2, AlertCircle, Clock, Zap, Volume2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PatrolRouteGuidance({ user, shift, location, onDismiss }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentCheckpointIndex, setCurrentCheckpointIndex] = useState(0);
  const audioRef = useRef(null);
  const vibrationInterval = useRef(null);

  const { data: assignedRoute } = useQuery({
    queryKey: ["assignedRoute", user?.id, shift?.id],
    queryFn: async () => {
      if (!user || !shift) return null;
      
      const plans = await base44.entities.PatrolPlan.filter({
        assigned_to: user.id,
        shift_id: shift.id,
        status: { $in: ["pending", "active"] }
      });
      
      return plans[0] || null;
    },
    enabled: !!user && !!shift,
    refetchInterval: 5000
  });

  const { data: patrolLogs = [] } = useQuery({
    queryKey: ["patrolLogs", shift?.id],
    queryFn: async () => {
      if (!shift) return [];
      return await base44.entities.PatrolLog.filter(
        { shift_id: shift.id },
        "-timestamp",
        50
      );
    },
    enabled: !!shift,
    initialData: []
  });

  useEffect(() => {
    if (assignedRoute) {
      playLoudAlarm();
      startVibration();
      
      // Find current checkpoint based on completed ones
      const completedCount = assignedRoute.route_checkpoints?.filter(cp => cp.completed).length || 0;
      setCurrentCheckpointIndex(completedCount);
    }

    return () => {
      stopAlarm();
    };
  }, [assignedRoute]);

  const playLoudAlarm = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(1.0, audioContext.currentTime);
      
      oscillator.start();
      
      setInterval(() => {
        oscillator.frequency.setValueAtTime(
          oscillator.frequency.value === 880 ? 440 : 880,
          audioContext.currentTime
        );
      }, 500);
      
      audioRef.current = { audioContext, oscillator, gainNode };

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('🚨 PATROL ROUTE REMINDER', {
          body: 'TIME TO START YOUR CHECKPOINT PATROL!',
          requireInteraction: true,
          tag: 'patrol-route',
          vibrate: [500, 200, 500, 200, 500]
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

  const handleStartScanning = () => {
    stopAlarm();
    navigate(createPageUrl("QRScanner"));
  };

  const handleDismiss = () => {
    stopAlarm();
    onDismiss();
  };

  if (!assignedRoute) {
    return null;
  }

  const currentCheckpoint = assignedRoute.route_checkpoints?.[currentCheckpointIndex];
  const totalCheckpoints = assignedRoute.route_checkpoints?.length || 0;
  const completedCount = assignedRoute.route_checkpoints?.filter(cp => cp.completed).length || 0;
  const progress = totalCheckpoints > 0 ? (completedCount / totalCheckpoints) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-rose-900/98 z-[9999] flex items-center justify-center p-4 animate-pulse">
      <Card className="max-w-lg w-full bg-gradient-to-br from-rose-600/50 to-orange-600/50 border-4 border-rose-500 shadow-2xl">
        <CardHeader className="text-center border-b-4 border-rose-500">
          <div className="w-32 h-32 mx-auto mb-4 bg-rose-500 rounded-full flex items-center justify-center animate-bounce">
            <Navigation className="w-16 h-16 text-white" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Volume2 className="w-8 h-8 text-rose-100 animate-bounce" />
            <CardTitle className="text-4xl text-white animate-pulse">
              🚨 PATROL ROUTE ALERT 🚨
            </CardTitle>
            <Volume2 className="w-8 h-8 text-rose-100 animate-bounce" />
          </div>
          <p className="text-rose-100 text-2xl font-bold animate-pulse">
            START CHECKPOINT SCANNING NOW!
          </p>
        </CardHeader>

        <CardContent className="space-y-6 pt-6">
          <div className="p-6 bg-rose-950/90 rounded-lg border-4 border-rose-500">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">Route Progress</h3>
              <Badge className="bg-amber-500 text-lg px-4 py-2">
                {completedCount} / {totalCheckpoints}
              </Badge>
            </div>
            
            <div className="h-4 bg-rose-900 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {currentCheckpoint ? (
              <div className="p-4 bg-rose-900/70 rounded-lg border-2 border-amber-400 animate-pulse">
                <Badge className="bg-emerald-500 text-white mb-3 text-sm">
                  ⬇️ SCAN THIS CHECKPOINT NEXT ⬇️
                </Badge>
                <h4 className="text-3xl font-bold text-white mb-2 drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
                  {currentCheckpoint.checkpoint_name}
                </h4>
                <p className="text-rose-200 text-lg">{currentCheckpoint.notes || "No additional notes"}</p>
                <Badge className={`mt-3 ${
                  currentCheckpoint.risk_level === 'critical' ? 'bg-rose-600' :
                  currentCheckpoint.risk_level === 'high' ? 'bg-orange-600' :
                  currentCheckpoint.risk_level === 'medium' ? 'bg-amber-600' :
                  'bg-slate-600'
                }`}>
                  {currentCheckpoint.risk_level?.toUpperCase()} RISK
                </Badge>
              </div>
            ) : (
              <div className="p-4 bg-emerald-600/20 rounded-lg border-2 border-emerald-500">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2" />
                <p className="text-emerald-200 text-center text-lg font-bold">
                  🎉 ALL CHECKPOINTS COMPLETED!
                </p>
              </div>
            )}
          </div>

          {assignedRoute.route_checkpoints && assignedRoute.route_checkpoints.length > 0 && (
            <div className="p-4 bg-rose-950/70 rounded-lg border-2 border-rose-600 max-h-48 overflow-y-auto">
              <h4 className="text-white font-bold mb-3 flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Full Route
              </h4>
              {assignedRoute.route_checkpoints.map((cp, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-2 rounded mb-2 ${
                    cp.completed ? 'bg-emerald-600/20' : idx === currentCheckpointIndex ? 'bg-amber-500/30 border-2 border-amber-400' : 'bg-slate-800/30'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    cp.completed ? 'bg-emerald-600' : idx === currentCheckpointIndex ? 'bg-amber-500' : 'bg-slate-600'
                  }`}>
                    {cp.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    ) : (
                      <span className="text-white font-bold">{idx + 1}</span>
                    )}
                  </div>
                  <span className={`flex-1 ${cp.completed ? 'text-emerald-300 line-through' : 'text-white font-semibold'}`}>
                    {cp.checkpoint_name}
                  </span>
                  {idx === currentCheckpointIndex && !cp.completed && (
                    <ChevronRight className="w-6 h-6 text-amber-400 animate-pulse" />
                  )}
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full h-20 text-2xl font-bold bg-emerald-500 hover:bg-emerald-600 shadow-2xl animate-pulse border-4 border-white"
            onClick={handleStartScanning}
          >
            <Navigation className="w-8 h-8 mr-3" />
            START SCANNING NOW!
          </Button>

          <Button
            variant="outline"
            className="w-full h-12 border-4 border-rose-400 text-white hover:bg-rose-800 text-lg"
            onClick={handleDismiss}
          >
            <Clock className="w-6 h-6 mr-2" />
            Snooze (Will Alert Again Soon)
          </Button>

          <div className="flex items-start gap-3 p-6 bg-rose-950/90 rounded-lg border-4 border-rose-500 animate-pulse">
            <AlertCircle className="w-8 h-8 text-rose-300 flex-shrink-0 mt-1 animate-bounce" />
            <p className="text-lg text-rose-100 font-bold leading-relaxed">
              ⚠️ IMPORTANT: Scan all checkpoints in the correct order! Missing scans will be reported to control room.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}