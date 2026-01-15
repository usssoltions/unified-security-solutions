import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Navigation, CheckCircle2, MapPin, Clock, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function PatrolAssignmentAlert({ user }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showAlert, setShowAlert] = useState(false);
  const [currentPatrol, setCurrentPatrol] = useState(null);
  const audioRef = useRef(null);
  const lastCheckRef = useRef(new Date());

  // Query for newly assigned patrols
  const { data: newPatrols = [] } = useQuery({
    queryKey: ["newPatrolAssignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const patrols = await base44.entities.PatrolPlan.filter({
        assigned_to: user.id,
        status: "pending"
      });
      
      // Only return patrols created in the last 2 minutes
      const recentPatrols = patrols.filter(p => {
        const createdAt = new Date(p.created_date);
        const now = new Date();
        const diffMs = now - createdAt;
        const diffMinutes = diffMs / 1000 / 60;
        return diffMinutes <= 2;
      });
      
      return recentPatrols;
    },
    enabled: !!user,
    refetchInterval: 5000
  });

  // Real-time subscription for patrol assignments
  useEffect(() => {
    if (!user) return;

    const unsubscribe = base44.entities.PatrolPlan.subscribe((event) => {
      if (event.type === 'create' && event.data.assigned_to === user.id) {
        queryClient.invalidateQueries(["newPatrolAssignments"]);
      }
    });

    return () => unsubscribe();
  }, [user?.id, queryClient]);

  // Play alarm sound when new patrol is detected
  useEffect(() => {
    if (newPatrols.length > 0 && !showAlert) {
      const patrol = newPatrols[0];
      setCurrentPatrol(patrol);
      setShowAlert(true);
      
      // Create alarm sound
      if (audioRef.current) {
        audioRef.current.pause();
      }
      
      // Create oscillating alarm tone
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'square';
      gainNode.gain.value = 0.3;
      
      // Start sound
      oscillator.start();
      
      // Oscillate frequency for alarm effect
      let increasing = true;
      const interval = setInterval(() => {
        if (increasing) {
          oscillator.frequency.value += 100;
          if (oscillator.frequency.value >= 1200) increasing = false;
        } else {
          oscillator.frequency.value -= 100;
          if (oscillator.frequency.value <= 800) increasing = true;
        }
      }, 200);
      
      // Stop after 10 seconds
      setTimeout(() => {
        clearInterval(interval);
        oscillator.stop();
        audioContext.close();
      }, 10000);
      
      // Vibrate if supported
      if (navigator.vibrate) {
        navigator.vibrate([500, 250, 500, 250, 500]);
      }
    }
  }, [newPatrols.length, showAlert]);

  const acceptMutation = useMutation({
    mutationFn: async (patrolId) => {
      await base44.entities.PatrolPlan.update(patrolId, {
        status: "active",
        started_at: new Date().toISOString()
      });
      
      await base44.entities.Notification.create({
        recipient_id: currentPatrol.created_by,
        recipient_name: currentPatrol.created_by_name,
        type: "status_change",
        priority: "medium",
        title: "Patrol Route Accepted",
        message: `${user.full_name} has accepted the patrol route: ${currentPatrol.name}`,
        read: false,
        related_entity: "patrol",
        related_id: patrolId,
        sent_via: ["in_app"]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["newPatrolAssignments"]);
      setShowAlert(false);
      setCurrentPatrol(null);
      navigate(createPageUrl("GuardPatrolChecklist"));
    }
  });

  if (!showAlert || !currentPatrol) return null;

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "critical": return "bg-rose-500";
      case "high": return "bg-orange-500";
      case "medium": return "bg-amber-500";
      default: return "bg-sky-500";
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <Card className="w-full max-w-lg border-4 border-rose-500 shadow-2xl animate-pulse">
        <CardHeader className="bg-gradient-to-r from-rose-500 to-orange-500">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
              <Bell className="w-6 h-6 text-rose-500 animate-bounce" />
            </div>
            <div>
              <CardTitle className="text-white text-xl">🚨 NEW PATROL ASSIGNMENT</CardTitle>
              <p className="text-white/90 text-sm">Immediate Action Required</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="space-y-3">
            <div>
              <h3 className="text-xl font-bold text-white mb-1">{currentPatrol.name}</h3>
              <div className="flex items-center gap-2">
                <Badge className={getPriorityColor(currentPatrol.priority)}>
                  {currentPatrol.priority?.toUpperCase()} PRIORITY
                </Badge>
                {currentPatrol.ai_generated && (
                  <Badge variant="outline" className="border-sky-500 text-sky-400">
                    AI Optimized
                  </Badge>
                )}
              </div>
            </div>

            <div className="bg-slate-800/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-slate-300">
                <MapPin className="w-4 h-4 text-sky-400" />
                <span className="text-sm">{currentPatrol.site_name}</span>
              </div>
              
              <div className="flex items-center gap-2 text-slate-300">
                <Navigation className="w-4 h-4 text-emerald-400" />
                <span className="text-sm">{currentPatrol.route_checkpoints?.length || 0} Checkpoints</span>
              </div>
              
              {currentPatrol.estimated_duration_minutes && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span className="text-sm">Est. {currentPatrol.estimated_duration_minutes} minutes</span>
                </div>
              )}
            </div>

            {currentPatrol.ai_recommendations && (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-3">
                <p className="text-sm text-sky-300">
                  <strong>AI Recommendation:</strong> {currentPatrol.ai_recommendations}
                </p>
              </div>
            )}

            {currentPatrol.high_risk_areas?.length > 0 && (
              <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span className="text-sm font-semibold text-rose-300">High Risk Areas:</span>
                </div>
                <ul className="text-sm text-slate-300 list-disc list-inside">
                  {currentPatrol.high_risk_areas.map((area, i) => (
                    <li key={i}>{area}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              onClick={() => acceptMutation.mutate(currentPatrol.id)}
              disabled={acceptMutation.isPending}
              className="flex-1 h-14 bg-emerald-600 hover:bg-emerald-700 text-lg font-semibold"
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              {acceptMutation.isPending ? "Accepting..." : "Accept & Start"}
            </Button>
            
            <Button
              onClick={() => {
                setShowAlert(false);
                setCurrentPatrol(null);
              }}
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              Dismiss
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}