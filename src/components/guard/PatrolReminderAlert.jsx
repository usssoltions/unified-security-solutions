import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navigation, MapPin, Clock, Sparkles, Volume2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PatrolReminderAlert({ user, shift, location, onDismiss }) {
  const navigate = useNavigate();
  const [aiGuidance, setAiGuidance] = useState(null);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef(null);
  const vibrationInterval = useRef(null);

  useEffect(() => {
    loadAIGuidance();
    playPatrolAlarm();
    startVibration();

    return () => {
      stopAlarm();
    };
  }, []);

  const playPatrolAlarm = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.8, audioContext.currentTime);
      
      oscillator.start();
      
      setInterval(() => {
        oscillator.frequency.setValueAtTime(
          oscillator.frequency.value === 660 ? 440 : 660,
          audioContext.currentTime
        );
      }, 800);
      
      audioRef.current = { audioContext, oscillator, gainNode };

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('📍 PATROL REMINDER', {
          body: 'Time to start your checkpoint patrol!',
          requireInteraction: true,
          tag: 'patrol-reminder',
          vibrate: [300, 200, 300]
        });
      }
    } catch (error) {
      console.error("Failed to play alarm:", error);
    }
  };

  const startVibration = () => {
    if ('vibrate' in navigator) {
      vibrationInterval.current = setInterval(() => {
        navigator.vibrate([300, 200, 300]);
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

  const loadAIGuidance = async () => {
    try {
      const site = await base44.entities.Site.get(shift.site_id);
      const recentPatrols = await base44.entities.PatrolLog.filter(
        { shift_id: shift.id },
        "-timestamp",
        10
      );

      const checkpoints = site.checkpoints || [];
      const scannedCheckpointIds = recentPatrols.map(p => p.checkpoint_id);
      const unscannedCheckpoints = checkpoints.filter(c => !scannedCheckpointIds.includes(c.id));

      let nextCheckpoint = null;
      let reason = "";

      if (unscannedCheckpoints.length > 0) {
        // Prioritize unscanned checkpoints
        nextCheckpoint = unscannedCheckpoints[0];
        reason = "This checkpoint hasn't been scanned this shift yet";
      } else if (checkpoints.length > 0) {
        // Get least recently scanned
        const checkpointTimes = {};
        recentPatrols.forEach(p => {
          if (!checkpointTimes[p.checkpoint_id]) {
            checkpointTimes[p.checkpoint_id] = p.timestamp;
          }
        });

        const oldestScanned = checkpoints.sort((a, b) => {
          const timeA = checkpointTimes[a.id] || '1970-01-01';
          const timeB = checkpointTimes[b.id] || '1970-01-01';
          return new Date(timeA) - new Date(timeB);
        })[0];

        nextCheckpoint = oldestScanned;
        reason = "This checkpoint needs to be re-scanned";
      }

      setAiGuidance({
        nextCheckpoint,
        reason,
        totalCheckpoints: checkpoints.length,
        scannedCount: scannedCheckpointIds.length,
        allCheckpoints: checkpoints
      });
    } catch (error) {
      console.error("Failed to load AI guidance:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartPatrol = () => {
    stopAlarm();
    navigate(createPageUrl("QRScanner"));
  };

  const handleDismiss = async () => {
    stopAlarm();
    
    await base44.entities.Alert.create({
      type: "assignment",
      priority: "low",
      title: "Patrol Reminder Dismissed",
      message: `${user.full_name} dismissed patrol reminder`,
      guard_id: user.id,
      guard_name: user.full_name,
      shift_id: shift.id,
      status: "acknowledged"
    });

    onDismiss();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-sky-900/95 z-[9999] flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-sky-800/50 border-2 border-sky-500">
          <CardContent className="pt-12 pb-12 text-center">
            <Sparkles className="w-12 h-12 text-sky-400 mx-auto mb-4 animate-spin" />
            <p className="text-white text-lg">Analyzing patrol route...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-sky-900/98 z-[9999] flex items-center justify-center p-4">
      <Card className="max-w-lg w-full bg-gradient-to-br from-sky-600/50 to-indigo-600/50 border-4 border-sky-400 shadow-2xl">
        <CardHeader className="text-center border-b-4 border-sky-400">
          <div className="w-24 h-24 mx-auto mb-4 bg-sky-500 rounded-full flex items-center justify-center animate-pulse">
            <Navigation className="w-12 h-12 text-white" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <Volume2 className="w-6 h-6 text-sky-200 animate-bounce" />
            <CardTitle className="text-3xl text-white">📍 PATROL REMINDER</CardTitle>
            <Volume2 className="w-6 h-6 text-sky-200 animate-bounce" />
          </div>
          <p className="text-sky-100 text-lg">Time to scan checkpoints</p>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="p-6 bg-sky-950/70 rounded-lg border-2 border-sky-400">
            <div className="flex items-center gap-3 mb-4">
              <Sparkles className="w-6 h-6 text-amber-400" />
              <h3 className="text-xl font-bold text-white">AI Guidance</h3>
            </div>
            
            {aiGuidance?.nextCheckpoint ? (
              <>
                <div className="mb-4">
                  <Badge className="bg-emerald-500 text-white text-sm mb-2">
                    RECOMMENDED NEXT
                  </Badge>
                  <h4 className="text-2xl font-bold text-white mb-2">
                    {aiGuidance.nextCheckpoint.name}
                  </h4>
                  <p className="text-sky-200 text-sm">{aiGuidance.reason}</p>
                </div>

                {aiGuidance.nextCheckpoint.location && location && (
                  <div className="flex items-center gap-2 text-sky-200 text-sm">
                    <MapPin className="w-4 h-4" />
                    <span>Checkpoint location available</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sky-200">No checkpoints configured for this site</p>
            )}

            <div className="mt-4 pt-4 border-t border-sky-600">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-white">
                    {aiGuidance?.scannedCount || 0}
                  </p>
                  <p className="text-xs text-sky-300">Scanned</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">
                    {aiGuidance?.totalCheckpoints || 0}
                  </p>
                  <p className="text-xs text-sky-300">Total</p>
                </div>
              </div>
            </div>
          </div>

          <Button
            className="w-full h-16 text-xl font-bold bg-emerald-500 hover:bg-emerald-600 shadow-lg"
            onClick={handleStartPatrol}
          >
            <Navigation className="w-6 h-6 mr-3" />
            Start Patrol Now
          </Button>

          <Button
            variant="outline"
            className="w-full border-2 border-sky-400 text-white hover:bg-sky-800"
            onClick={handleDismiss}
          >
            <Clock className="w-5 h-5 mr-2" />
            Dismiss (Will remind again later)
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}