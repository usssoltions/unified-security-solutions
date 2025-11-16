import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Shield, Users, MapPin, Radio, Sparkles } from "lucide-react";
import LiveMap from "../components/dispatcher/LiveMap";
import AlertPanel from "../components/dispatcher/AlertPanel";
import ActiveGuardsPanel from "../components/dispatcher/ActiveGuardsPanel";
import IncidentQueue from "../components/dispatcher/IncidentQueue";
import DispatchAlarm from "../components/dispatcher/DispatchAlarm";
import AIIncidentAnalysis from "../components/dispatcher/AIIncidentAnalysis";
import AIRiskPredictor from "../components/analytics/AIRiskPredictor";

export default function ControlRoom() {
  const [showDispatchAlarm, setShowDispatchAlarm] = useState(false);
  const [showAIAnalysis, setShowAIAnalysis] = useState(false);
  const [showRiskPredictor, setShowRiskPredictor] = useState(false);
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
      return shifts;
    },
    refetchInterval: 10000
  });

  const { data: activeAlerts = [] } = useQuery({
    queryKey: ["activeAlertsControl"],
    queryFn: async () => {
      return await base44.entities.Alert.filter({ status: "active" }, "-created_date", 10);
    },
    refetchInterval: 5000,
    initialData: []
  });

  const { data: pendingIncidents = [] } = useQuery({
    queryKey: ["pendingIncidentsControl"],
    queryFn: async () => {
      return await base44.entities.Incident.filter({ 
        status: { $in: ["reported", "assigned"] }
      }, "-reported_at", 20);
    },
    refetchInterval: 10000,
    initialData: []
  });

  const { data: alarmResponses = [] } = useQuery({
    queryKey: ["alarmResponsesControl"],
    queryFn: async () => {
      return await base44.entities.AlarmResponse.filter({
        status: { $in: ["dispatched", "acknowledged", "en_route", "arrived"] }
      }, "-dispatched_at", 10);
    },
    refetchInterval: 5000,
    initialData: []
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
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
          <div className="flex gap-3">
            <Button
              onClick={() => setShowRiskPredictor(!showRiskPredictor)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              {showRiskPredictor ? "Hide" : "Show"} AI Risk Predictor
            </Button>
            <Button
              onClick={() => setShowAIAnalysis(true)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              <Sparkles className="w-5 h-5 mr-2" />
              AI Incident Analysis
            </Button>
            <Button
              onClick={() => setShowDispatchAlarm(true)}
              className="bg-rose-600 hover:bg-rose-700"
            >
              <AlertTriangle className="w-5 h-5 mr-2" />
              Dispatch Alarm
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
    </div>
  );
}