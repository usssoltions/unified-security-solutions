import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Shield, Users, MapPin, Radio, Sparkles,
  MessageCircle, Navigation, GraduationCap, FileText, Brain,
  Zap, TrendingUp, Eye, Bell, Activity, ChevronRight
} from "lucide-react";
import LiveMap from "../components/dispatcher/LiveMap";
import AlertPanel from "../components/dispatcher/AlertPanel";
import ActiveGuardsPanel from "../components/dispatcher/ActiveGuardsPanel";
import IncidentQueue from "../components/dispatcher/IncidentQueue";
import DispatchAlarm from "../components/dispatcher/DispatchAlarm";
import AIIncidentAnalysis from "../components/dispatcher/AIIncidentAnalysis";
import AIRiskPredictor from "../components/analytics/AIRiskPredictor";
import SupervisorChat from "../components/chat/SupervisorChat";
import SupervisorPatrolPlanner from "../components/patrol/SupervisorPatrolPlanner";
import SupervisorTrainingManager from "../components/training/SupervisorTrainingManager";
import ReportTemplateManager from "../components/reports/ReportTemplateManager";

export default function ControlRoom() {
  const [showDispatchAlarm, setShowDispatchAlarm] = useState(false);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showRiskPredictor, setShowRiskPredictor] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showPatrolPlanner, setShowPatrolPlanner] = useState(false);
  const [showTrainingManager, setShowTrainingManager] = useState(false);
  const [showReportTemplates, setShowReportTemplates] = useState(false);
  const [user, setUser] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    base44.auth.me().then(setUser);
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { data: activeGuards = [] } = useQuery({
    queryKey: ["activeGuardsControl"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      return Array.isArray(shifts) ? shifts : [];
    },
    refetchInterval: 15000
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ["activeAlertsControl"],
    queryFn: async () => {
      const alerts = await base44.entities.Alert.filter({ status: "active" }, "-created_date", 10);
      return Array.isArray(alerts) ? alerts : [];
    },
    refetchInterval: 8000,
    initialData: []
  });

  const { data: pendingIncidents = [] } = useQuery({
    queryKey: ["pendingIncidentsControl"],
    queryFn: async () => {
      const incidents = await base44.entities.Incident.filter({
        status: { $in: ["reported", "assigned"] }
      }, "-reported_at", 20);
      return Array.isArray(incidents) ? incidents : [];
    },
    refetchInterval: 10000,
    initialData: []
  });

  const { data: alarmResponses = [] } = useQuery({
    queryKey: ["alarmResponsesControl"],
    queryFn: async () => {
      const alarms = await base44.entities.AlarmResponse.filter({
        status: { $in: ["dispatched", "acknowledged", "en_route", "arrived"] }
      }, "-dispatched_at", 10);
      return Array.isArray(alarms) ? alarms : [];
    },
    refetchInterval: 8000,
    initialData: []
  });

  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["unreadMessages"],
    queryFn: async () => {
      if (!user) return 0;
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 50);
      const msgs = Array.isArray(allMessages) ? allMessages : [];
      return msgs.filter(m => m.recipient_id === user.id && !(Array.isArray(m.read_by) && m.read_by.includes(user.id))).length;
    },
    enabled: !!user,
    refetchInterval: 15000
  });

  const isCritical = activeAlerts.some(a => a.priority === "critical");

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading Control Room...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 lg:px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ${isCritical ? "bg-rose-500 animate-pulse shadow-rose-500/40" : "bg-gradient-to-br from-sky-400 to-blue-600 shadow-sky-500/30"}`}>
              <Radio className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Control Room</h1>
              <p className="text-slate-400 text-xs">{currentTime.toLocaleTimeString()} • Real-time monitoring</p>
            </div>
          </div>

          {/* Action Buttons - horizontal scroll on mobile */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <Button
              onClick={() => setShowDispatchAlarm(true)}
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 shrink-0 shadow-lg shadow-rose-500/20"
            >
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">Dispatch</span>
            </Button>
            <Button onClick={() => setShowAIAnalysis(true)} size="sm" className="bg-purple-600 hover:bg-purple-700 shrink-0">
              <Brain className="w-4 h-4 mr-1.5" />
              <span className="hidden sm:inline">AI Analysis</span>
            </Button>
            <Button onClick={() => setShowChat(true)} size="sm" className="bg-slate-700 hover:bg-slate-600 shrink-0 relative">
              <MessageCircle className="w-4 h-4" />
              {unreadMessages > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center">
                  {unreadMessages}
                </span>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="p-4 lg:p-6 max-w-[1800px] mx-auto space-y-4 lg:space-y-6">

        {/* Critical Alert Banner */}
        <AnimatePresence>
          {isCritical && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-rose-500/20 border border-rose-500/50 rounded-2xl p-4 flex items-center gap-3"
            >
              <div className="w-10 h-10 bg-rose-500/30 rounded-full flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div className="flex-1">
                <p className="text-rose-300 font-bold">⚠ CRITICAL ALERT ACTIVE</p>
                <p className="text-rose-400/80 text-sm">{activeAlerts.filter(a => a.priority === "critical").length} critical incident(s) require immediate attention</p>
              </div>
              <Button onClick={() => setShowDispatchAlarm(true)} size="sm" className="bg-rose-600 hover:bg-rose-700 shrink-0">
                Respond
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-emerald-400 font-medium mb-1">Active Guards</p>
                  <p className="text-3xl font-bold text-white">{activeGuards.length}</p>
                </div>
                <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                  <Shield className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/15 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-rose-400 font-medium mb-1">Active Alerts</p>
                  <p className="text-3xl font-bold text-white">{activeAlerts.length}</p>
                  <p className={`text-xs mt-1 ${isCritical ? "text-rose-400 font-bold" : "text-slate-500"}`}>{isCritical ? "⚠ CRITICAL" : "Normal"}</p>
                </div>
                <div className="w-10 h-10 bg-rose-500/20 rounded-xl flex items-center justify-center">
                  <Bell className="w-5 h-5 text-rose-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-amber-400 font-medium mb-1">Pending Incidents</p>
                  <p className="text-3xl font-bold text-white">{pendingIncidents.length}</p>
                </div>
                <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-sky-500/10 border-sky-500/20 hover:bg-sky-500/15 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-sky-400 font-medium mb-1">Active Alarms</p>
                  <p className="text-3xl font-bold text-white">{alarmResponses.length}</p>
                </div>
                <div className="w-10 h-10 bg-sky-500/20 rounded-xl flex items-center justify-center">
                  <Radio className="w-5 h-5 text-sky-400" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Risk Predictor */}
        <AnimatePresence>
          {showRiskPredictor && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <AIRiskPredictor user={user} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button onClick={() => setShowRiskPredictor(!showRiskPredictor)} className="bg-gradient-to-br from-purple-600 to-purple-700 rounded-xl p-4 text-left hover:opacity-90 active:scale-95 transition-all shadow-lg">
            <Brain className="w-6 h-6 text-white mb-2" />
            <p className="text-white text-sm font-semibold">AI Risk Predictor</p>
          </button>
          <button onClick={() => setShowPatrolPlanner(true)} className="bg-gradient-to-br from-sky-600 to-sky-700 rounded-xl p-4 text-left hover:opacity-90 active:scale-95 transition-all shadow-lg">
            <Navigation className="w-6 h-6 text-white mb-2" />
            <p className="text-white text-sm font-semibold">Patrol Plans</p>
          </button>
          <button onClick={() => setShowTrainingManager(true)} className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl p-4 text-left hover:opacity-90 active:scale-95 transition-all shadow-lg">
            <GraduationCap className="w-6 h-6 text-white mb-2" />
            <p className="text-white text-sm font-semibold">Training</p>
          </button>
          <button onClick={() => setShowReportTemplates(true)} className="bg-gradient-to-br from-amber-600 to-amber-700 rounded-xl p-4 text-left hover:opacity-90 active:scale-95 transition-all shadow-lg">
            <FileText className="w-6 h-6 text-white mb-2" />
            <p className="text-white text-sm font-semibold">Report Templates</p>
          </button>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
          <div className="xl:col-span-2 space-y-4 lg:space-y-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="p-4">
                <CardTitle className="text-white flex items-center gap-2 text-base">
                  <Activity className="w-4 h-4 text-sky-400" />
                  Live Fleet Map
                  <div className="ml-auto flex items-center gap-1">
                    <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="text-emerald-400 text-xs">LIVE</span>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-4 px-4">
                <LiveMap activeGuards={activeGuards} />
              </CardContent>
            </Card>
            <IncidentQueue incidents={pendingIncidents} />
          </div>

          <div className="space-y-4 lg:space-y-6">
            <AlertPanel alerts={activeAlerts} />
            <ActiveGuardsPanel guards={activeGuards} />
          </div>
        </div>
      </div>

      {/* Modals */}
      {showDispatchAlarm && (
        <DispatchAlarm
          onClose={() => setShowDispatchAlarm(false)}
          onSuccess={() => setShowDispatchAlarm(false)}
        />
      )}
      {showAIAnalysis && <AIIncidentAnalysis onClose={() => setShowAIAnalysis(false)} />}
      {showChat && <SupervisorChat user={user} onClose={() => setShowChat(false)} />}
      {showPatrolPlanner && <SupervisorPatrolPlanner user={user} onClose={() => setShowPatrolPlanner(false)} />}
      {showTrainingManager && <SupervisorTrainingManager user={user} onClose={() => setShowTrainingManager(false)} />}
      {showReportTemplates && <ReportTemplateManager user={user} onClose={() => setShowReportTemplates(false)} />}
    </div>
  );
}