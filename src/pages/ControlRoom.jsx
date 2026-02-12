import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield, Users, MapPin, Radio, Sparkles, MessageCircle, Navigation, GraduationCap, FileText } from "lucide-react";
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
import UnifiedMobileNav from "../components/MobileOptimizedGuardNav";

export default function ControlRoom() {
  const [showDispatchAlarm, setShowDispatchAlarm] = useState(false);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showRiskPredictor, setShowRiskPredictor] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showPatrolPlanner, setShowPatrolPlanner] = useState(false);
  const [showTrainingManager, setShowTrainingManager] = useState(false);
  const [showReportTemplates, setShowReportTemplates] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const loadUser = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    };
    loadUser();
  }, []);

  const { data: activeGuards = [] } = useQuery({
    queryKey: ["activeGuardsControl"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      return Array.isArray(shifts) ? shifts : [];
    },
    refetchInterval: 10000
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ["activeAlertsControl"],
    queryFn: async () => {
      const alerts = await base44.entities.Alert.filter({ status: "active" }, "-created_date", 10);
      return Array.isArray(alerts) ? alerts : [];
    },
    refetchInterval: 5000,
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
    refetchInterval: 5000,
    initialData: []
  });

  const { data: unreadMessages = 0 } = useQuery({
    queryKey: ["unreadMessages"],
    queryFn: async () => {
      if (!user) return 0;
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 50);
      const messageArray = Array.isArray(allMessages) ? allMessages : [];
      const myMessages = messageArray.filter(m => 
        m.recipient_id === user.id && !(Array.isArray(m.read_by) && m.read_by.includes(user.id))
      );
      return myMessages.length;
    },
    enabled: !!user,
    refetchInterval: 5000
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <>
      <UnifiedMobileNav user={user} />
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
        <div className="max-w-[1800px] mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center animate-pulse">
              <Radio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Control Room</h1>
              <p className="text-slate-400">Real-time fleet monitoring & dispatch</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setShowReportTemplates(true)} className="bg-purple-600 hover:bg-purple-700">
              <FileText className="w-5 h-5 mr-2" />
              Report Templates
            </Button>
            <Button onClick={() => setShowTrainingManager(true)} className="bg-purple-600 hover:bg-purple-700">
              <GraduationCap className="w-5 h-5 mr-2" />
              Training
            </Button>
            <Button onClick={() => setShowPatrolPlanner(true)} className="bg-purple-600 hover:bg-purple-700">
              <Navigation className="w-5 h-5 mr-2" />
              Patrol Plans
            </Button>
            <Button onClick={() => setShowChat(true)} className="bg-purple-600 hover:bg-purple-700">
              <MessageCircle className="w-5 h-5 mr-2" />
              Chat
              {unreadMessages > 0 && (
                <Badge className="ml-2 bg-rose-500">{unreadMessages}</Badge>
              )}
            </Button>
            <Button onClick={() => setShowRiskPredictor(!showRiskPredictor)} className="bg-purple-600 hover:bg-purple-700">
              <Sparkles className="w-5 h-5 mr-2" />
              AI Risk
            </Button>
            {/* Keeping AI Analysis button as its state and modal are still present in the outline */}
            <Button
              onClick={() => setShowAIAnalysis(true)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              AI Analysis
            </Button>
            <Button onClick={() => setShowDispatchAlarm(true)} className="bg-rose-600 hover:bg-rose-700">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Dispatch
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="bg-emerald-500/10 border-emerald-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-emerald-400">Active Guards</p>
                  <p className="text-3xl font-bold text-white">{activeGuards.length}</p>
                </div>
                <Shield className="w-8 h-8 text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-rose-500/10 border-rose-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-rose-400">Active Alerts</p>
                  <p className="text-3xl font-bold text-white">{activeAlerts.length}</p>
                </div>
                <AlertTriangle className="w-8 h-8 text-rose-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-500/10 border-amber-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-amber-400">Pending Incidents</p>
                  <p className="text-3xl font-bold text-white">{pendingIncidents.length}</p>
                </div>
                <MapPin className="w-8 h-8 text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-sky-500/10 border-sky-500/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-sky-400">Active Alarms</p>
                  <p className="text-3xl font-bold text-white">{alarmResponses.length}</p>
                </div>
                <Radio className="w-8 h-8 text-sky-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {showRiskPredictor && (
          <AIRiskPredictor user={user} />
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white">Live Fleet Map</CardTitle>
              </CardHeader>
              <CardContent>
                <LiveMap activeGuards={activeGuards} />
              </CardContent>
            </Card>

            <IncidentQueue incidents={pendingIncidents} />
          </div>

          <div className="space-y-6">
            <AlertPanel alerts={activeAlerts} />
            <ActiveGuardsPanel guards={activeGuards} />
          </div>
        </div>
      </div>

      {showDispatchAlarm && (
        <DispatchAlarm
          onClose={() => setShowDispatchAlarm(false)}
          onSuccess={() => {
            setShowDispatchAlarm(false);
            alert("Alarm dispatched successfully!");
          }}
        />
      )}

      {showAIAnalysis && (
        <AIIncidentAnalysis
          onClose={() => setShowAIAnalysis(false)}
        />
      )}

      {showChat && (
        <SupervisorChat user={user} onClose={() => setShowChat(false)} />
      )}

      {showPatrolPlanner && (
        <SupervisorPatrolPlanner user={user} onClose={() => setShowPatrolPlanner(false)} />
      )}

      {showTrainingManager && (
        <SupervisorTrainingManager user={user} onClose={() => setShowTrainingManager(false)} />
      )}

      {showReportTemplates && (
        <ReportTemplateManager user={user} onClose={() => setShowReportTemplates(false)} />
      )}
      </div>
    </>
  );
}