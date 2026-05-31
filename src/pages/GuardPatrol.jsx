import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveOffline, isOnline } from "@/lib/offlineDB";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield, MapPin, CheckCircle2, QrCode, Mic, MicOff, AlertTriangle,
  Navigation, Clock, Play, Pause, Square, Volume2, Camera, Zap
} from "lucide-react";

// ─── Voice helper ──────────────────────────────────────────────────────────
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9; u.pitch = 1; u.volume = 1;
  window.speechSynthesis.speak(u);
}

// ─── GPS helper ────────────────────────────────────────────────────────────
function getGPS() {
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude }),
      e => rej(e),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  );
}

function distMetres(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export default function GuardPatrol() {
  const [user, setUser] = useState(null);
  const [activePatrol, setActivePatrol] = useState(null);
  const [paused, setPaused] = useState(false);
  const [currentCheckpointIdx, setCurrentCheckpointIdx] = useState(0);
  const [gpsTrack, setGpsTrack] = useState([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [emergencyMode, setEmergencyMode] = useState(false);
  const gpsInterval = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: upcomingPatrols = [] } = useQuery({
    queryKey: ["myPatrols", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const all = await base44.entities.ScheduledPatrol.list("-scheduled_start", 100);
      const now = new Date();
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
      return all.filter(p =>
        p.guard_id === user.id &&
        ["upcoming", "due", "overdue"].includes(p.status) &&
        new Date(p.scheduled_start) >= todayStart &&
        new Date(p.scheduled_start) <= todayEnd
      ).sort((a, b) => new Date(a.scheduled_start) - new Date(b.scheduled_start));
    },
    refetchInterval: 60000,
  });

  // ─── Start patrol ───────────────────────────────────────────────────────
  const startPatrol = useCallback(async (patrol) => {
    const gps = await getGPS().catch(() => null);
    const now = new Date().toISOString();

    // Generate AI random route (shuffle by risk desc)
    const checkpoints = [...(patrol.route_checkpoints || [])].sort((a, b) => {
      const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      // Slight randomisation: mix risk weighting with random
      return (riskOrder[b.risk_level] || 2) + Math.random() * 0.5 -
             (riskOrder[a.risk_level] || 2) - Math.random() * 0.5;
    }).map((cp, i) => ({ ...cp, order: i + 1, completed: false }));

    await base44.entities.ScheduledPatrol.update(patrol.id, {
      status: "active",
      actual_start: now,
      route_checkpoints: checkpoints,
      gps_track: gps ? [{ ...gps, timestamp: now }] : [],
    });

    setActivePatrol({ ...patrol, route_checkpoints: checkpoints, actual_start: now });
    setCurrentCheckpointIdx(0);
    setGpsTrack(gps ? [gps] : []);
    setPaused(false);

    speak("Patrol started. Proceed to the first checkpoint.");
    setStatusMsg("Patrol started. Proceed to checkpoint 1.");

    // GPS tracking loop
    gpsInterval.current = setInterval(async () => {
      const pos = await getGPS().catch(() => null);
      if (!pos) return;
      setGpsTrack(prev => [...prev, pos]);
      await base44.entities.ScheduledPatrol.update(patrol.id, {
        gps_track: [...gpsTrack, { ...pos, timestamp: new Date().toISOString() }],
      }).catch(() => {});
    }, 30000);

    queryClient.invalidateQueries(["myPatrols"]);
  }, [gpsTrack, queryClient]);

  // ─── Scan checkpoint ────────────────────────────────────────────────────
  const scanCheckpoint = useCallback(async (checkpointId) => {
    if (!activePatrol) return;
    const gps = await getGPS().catch(() => null);
    const checkpoints = [...activePatrol.route_checkpoints];
    const idx = checkpoints.findIndex(c => c.checkpoint_id === checkpointId);
    if (idx === -1) { setStatusMsg("Unknown checkpoint QR."); return; }

    const gpsVerified = false;
    const patrolLogData = {
      guard_id: user.id,
      guard_name: user.full_name,
      shift_id: activePatrol.shift_id,
      site_id: activePatrol.site_id,
      checkpoint_id: checkpointId,
      checkpoint_name: checkpoints[idx].checkpoint_name,
      qr_code: checkpointId,
      location: gps,
      timestamp: new Date().toISOString(),
      verified: gpsVerified,
      notes: `Patrol #${activePatrol.patrol_number}`,
    };

    // Save patrol log — queue offline if no connection
    if (isOnline()) {
      await base44.entities.PatrolLog.create(patrolLogData).catch(() =>
        saveOffline("pending_patrol", patrolLogData)
      );
    } else {
      await saveOffline("pending_patrol", patrolLogData);
      setStatusMsg("📶 Offline — checkpoint saved locally, will sync when connected.");
    }

    checkpoints[idx] = { ...checkpoints[idx], completed: true, completed_at: new Date().toISOString(), gps_verified: gpsVerified };
    const completed = checkpoints.filter(c => c.completed).length;
    const total = checkpoints.length;

    // Update patrol record — best effort when online, skip silently if offline
    if (isOnline()) {
      await base44.entities.ScheduledPatrol.update(activePatrol.id, {
        route_checkpoints: checkpoints,
        checkpoints_completed: completed,
        checkpoints_total: total,
      }).catch(() => {});
    }

    setActivePatrol(prev => ({ ...prev, route_checkpoints: checkpoints }));

    const remaining = total - completed;
    if (remaining === 0) {
      speak("Patrol successfully completed. All checkpoints verified.");
      await completePatrol(checkpoints);
    } else if (remaining === 1) {
      speak("Checkpoint verified. Final checkpoint remaining.");
      setStatusMsg("Final checkpoint remaining!");
    } else {
      speak(`Checkpoint verified. Proceed to the next checkpoint.`);
      setStatusMsg(`${remaining} checkpoints remaining.`);
    }

    const nextIdx = checkpoints.findIndex(c => !c.completed);
    if (nextIdx !== -1) setCurrentCheckpointIdx(nextIdx);
  }, [activePatrol, user]);

  // ─── Complete patrol ───────────────────────────────────────────────────
  const completePatrol = async (checkpoints) => {
    const cp = checkpoints || activePatrol?.route_checkpoints || [];
    const totalCp = cp.length;
    const completedCp = cp.filter(c => c.completed).length;
    const score = totalCp > 0 ? Math.round((completedCp / totalCp) * 100) : 0;
    const status = score === 100 ? "completed" : "failed";

    await base44.entities.ScheduledPatrol.update(activePatrol.id, {
      status,
      actual_end: new Date().toISOString(),
      completion_score: score,
      gps_track: gpsTrack.map(g => ({ ...g, timestamp: new Date().toISOString() })),
    });

    clearInterval(gpsInterval.current);
    setActivePatrol(null);
    queryClient.invalidateQueries(["myPatrols"]);
    speak(status === "completed" ? "Patrol successfully completed." : "Patrol ended. Some checkpoints were not completed.");
    setStatusMsg(status === "completed" ? "✅ Patrol complete!" : `⚠️ Patrol ended — score: ${score}%`);
  };

  // ─── Emergency ─────────────────────────────────────────────────────────
  const triggerEmergency = async () => {
    setEmergencyMode(true);
    speak("Emergency alert sent. Help is on the way.");
    const gps = await getGPS().catch(() => null);
    await base44.entities.Alert.create({
      type: "panic",
      priority: "critical",
      title: "🚨 PATROL EMERGENCY",
      message: `${user?.full_name} triggered emergency during patrol at ${activePatrol?.site_name || "site"}.`,
      guard_id: user?.id,
      guard_name: user?.full_name,
      site_id: activePatrol?.site_id,
      location: gps,
      status: "active",
    }).catch(() => {});
    setTimeout(() => setEmergencyMode(false), 10000);
  };

  // ─── Voice commands ────────────────────────────────────────────────────
  const startVoice = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert("Voice commands not supported on this browser.");
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false; rec.lang = "en-ZA";
    rec.onresult = (e) => {
      const cmd = e.results[0][0].transcript.toLowerCase();
      if (cmd.includes("emergency")) triggerEmergency();
      else if (cmd.includes("start patrol") && upcomingPatrols.length > 0) startPatrol(upcomingPatrols[0]);
      else if (cmd.includes("repeat")) speak(statusMsg);
      else if (cmd.includes("end patrol") && activePatrol) completePatrol();
      else speak("Command not recognised.");
    };
    rec.onend = () => setVoiceListening(false);
    rec.onerror = () => setVoiceListening(false);
    rec.start();
    setVoiceListening(true);
  };

  // ─── Simulated QR scan input ────────────────────────────────────────────
  const [qrInput, setQrInput] = useState("");

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <p className="text-slate-400">Loading...</p>
    </div>
  );

  const currentCheckpoint = activePatrol?.route_checkpoints?.[currentCheckpointIdx];
  const completedCount = activePatrol?.route_checkpoints?.filter(c => c.completed).length || 0;
  const totalCount = activePatrol?.route_checkpoints?.length || 0;

  return (
    <div className="min-h-screen bg-slate-950 p-4 space-y-4">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-sky-400" /> AI Patrol Assistant
            </h1>
            <p className="text-xs text-slate-400">{user.full_name}</p>
          </div>
          <Button onClick={startVoice} variant="outline" size="sm"
            className={`border-slate-600 ${voiceListening ? "text-emerald-400 border-emerald-600 animate-pulse" : "text-slate-300"}`}>
            {voiceListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
          </Button>
        </div>

        {/* Emergency */}
        {emergencyMode && (
          <Card className="bg-rose-900 border-rose-500 animate-pulse">
            <CardContent className="p-4 text-center">
              <AlertTriangle className="w-10 h-10 text-rose-300 mx-auto mb-2" />
              <p className="text-white font-bold text-lg">🚨 EMERGENCY ALERT SENT</p>
              <p className="text-rose-300 text-sm">Supervisors notified. Help is coming.</p>
            </CardContent>
          </Card>
        )}

        {/* Status message */}
        {statusMsg && !activePatrol && (
          <Card className="bg-emerald-900/30 border-emerald-700">
            <CardContent className="p-3 text-emerald-300 text-sm text-center">{statusMsg}</CardContent>
          </Card>
        )}

        {/* Active Patrol */}
        {activePatrol ? (
          <div className="space-y-4">
            {/* Progress */}
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white font-semibold">{activePatrol.site_name}</span>
                  <Badge className="bg-emerald-600">Active</Badge>
                </div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Progress</span>
                  <span>{completedCount}/{totalCount}</span>
                </div>
                <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : "0%" }} />
                </div>
                <p className="text-slate-300 text-sm mt-2">{statusMsg}</p>
              </CardContent>
            </Card>

            {/* Current checkpoint */}
            {currentCheckpoint && !currentCheckpoint.completed && (
              <Card className="bg-sky-900/40 border-sky-600">
                <CardContent className="p-4">
                  <p className="text-sky-300 text-xs font-semibold uppercase tracking-wide mb-1">Next Checkpoint</p>
                  <p className="text-white font-bold text-lg">{currentCheckpoint.checkpoint_name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge className={currentCheckpoint.risk_level === "critical" ? "bg-rose-700" :
                      currentCheckpoint.risk_level === "high" ? "bg-orange-600" :
                      currentCheckpoint.risk_level === "medium" ? "bg-amber-600" : "bg-slate-600"}>
                      {currentCheckpoint.risk_level}
                    </Badge>
                    {currentCheckpoint.required && <Badge className="bg-slate-700 text-xs">Required</Badge>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Checkpoint list */}
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-3">
                <p className="text-slate-400 text-xs font-semibold uppercase mb-2">Route</p>
                <div className="space-y-1.5">
                  {activePatrol.route_checkpoints.map((cp, i) => (
                    <div key={cp.checkpoint_id} className={`flex items-center gap-2 p-2 rounded text-sm ${cp.completed ? "text-emerald-400 bg-emerald-900/20" : i === currentCheckpointIdx ? "text-sky-300 bg-sky-900/20" : "text-slate-400"}`}>
                      {cp.completed ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${i === currentCheckpointIdx ? "border-sky-400" : "border-slate-600"}`} />}
                      <span>{cp.order}. {cp.checkpoint_name}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Manual QR input (for when camera not available) */}
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="p-3">
                <p className="text-slate-400 text-xs mb-2">Scan QR / Enter Checkpoint Code</p>
                <div className="flex gap-2">
                  <input value={qrInput} onChange={e => setQrInput(e.target.value)}
                    placeholder="QR code or checkpoint ID"
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm"
                    onKeyDown={e => { if (e.key === "Enter" && qrInput) { scanCheckpoint(qrInput); setQrInput(""); } }} />
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700" onClick={() => { if (qrInput) { scanCheckpoint(qrInput); setQrInput(""); } }}>
                    <QrCode className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-slate-500 text-xs mt-1">Or tap a checkpoint below to simulate scan:</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {activePatrol.route_checkpoints.filter(c => !c.completed).map(cp => (
                    <button key={cp.checkpoint_id} onClick={() => scanCheckpoint(cp.checkpoint_id)}
                      className="px-2 py-1 bg-slate-700 hover:bg-sky-700 text-slate-300 text-xs rounded transition-colors">
                      {cp.checkpoint_name}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Controls */}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => { setPaused(!paused); speak(paused ? "Patrol resumed." : "Patrol paused."); }}
                variant="outline" className="border-slate-600 text-slate-300">
                {paused ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
                {paused ? "Resume" : "Pause"}
              </Button>
              <Button onClick={() => completePatrol()} variant="outline" className="border-amber-600 text-amber-400">
                <Square className="w-4 h-4 mr-1" /> End Patrol
              </Button>
            </div>

            <Button onClick={triggerEmergency} className="w-full bg-rose-700 hover:bg-rose-800 h-14 text-lg font-bold">
              🚨 EMERGENCY
            </Button>
          </div>
        ) : (
          /* Upcoming patrols */
          <div className="space-y-3">
            <p className="text-slate-400 text-sm font-semibold">Today's Patrols</p>
            {upcomingPatrols.length === 0 ? (
              <Card className="bg-slate-800 border-slate-700">
                <CardContent className="py-10 text-center">
                  <Shield className="w-10 h-10 text-slate-500 mx-auto mb-2" />
                  <p className="text-slate-400">No patrols scheduled</p>
                </CardContent>
              </Card>
            ) : (
              upcomingPatrols.map(patrol => (
                <Card key={patrol.id} className={`bg-slate-800 border-slate-700 ${patrol.status === "overdue" ? "border-rose-600/60" : patrol.status === "due" ? "border-amber-600/60" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-white font-semibold">{patrol.site_name}</p>
                        <p className="text-slate-400 text-xs flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {new Date(patrol.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          {" — "}Patrol #{patrol.patrol_number}
                        </p>
                        <p className="text-slate-500 text-xs">{patrol.checkpoints_total || 0} checkpoints</p>
                      </div>
                      <div className="flex flex-col gap-2 items-end">
                        <Badge className={patrol.status === "overdue" ? "bg-rose-700" : patrol.status === "due" ? "bg-amber-600" : "bg-slate-600"}>
                          {patrol.status}
                        </Badge>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => startPatrol(patrol)}>
                          <Play className="w-3 h-3 mr-1" /> Start
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}

            {/* Voice commands hint */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Volume2 className="w-4 h-4 text-sky-400" />
                  <p className="text-slate-300 text-sm font-semibold">Voice Commands</p>
                </div>
                <div className="grid grid-cols-2 gap-1 text-xs text-slate-500">
                  {["Start Patrol", "End Patrol", "Emergency", "Repeat Instructions"].map(cmd => (
                    <span key={cmd}>• {cmd}</span>
                  ))}
                </div>
                <Button onClick={startVoice} size="sm" className="mt-2 bg-sky-700 hover:bg-sky-600 w-full">
                  <Mic className="w-3 h-3 mr-1" /> Activate Voice
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}