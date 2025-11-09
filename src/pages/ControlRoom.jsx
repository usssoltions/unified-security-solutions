import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Radio, Users, AlertTriangle, MapPin, TrendingUp, Zap, Sparkles } from "lucide-react";
import LiveMap from "../components/dispatcher/LiveMap";
import AlertPanel from "../components/dispatcher/AlertPanel";
import ActiveGuardsPanel from "../components/dispatcher/ActiveGuardsPanel";
import IncidentQueue from "../components/dispatcher/IncidentQueue";
import DispatchAlarm from "../components/dispatcher/DispatchAlarm";
import AIIncidentAnalysis from "../components/dispatcher/AIIncidentAnalysis";

export default function ControlRoom() {
  const [user, setUser] = useState(null);
  const [showDispatchAlarm, setShowDispatchAlarm] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: activeAlerts } = useQuery({
    queryKey: ["activeAlerts"],
    queryFn: async () => {
      try {
        return await base44.entities.Alert.filter({ status: "active" }, "-created_date", 10);
      } catch (error) {
        if (!error?.message?.includes('WebSocket')) {
          console.error("Failed to load alerts:", error);
        }
        return [];
      }
    },
    refetchInterval: 5000,
    initialData: [],
    retry: 3
  });

  const { data: activeGuards } = useQuery({
    queryKey: ["activeGuards"],
    queryFn: async () => {
      try {
        return await base44.entities.Shift.filter({ status: "active" }, "-start_time", 20);
      } catch (error) {
        if (!error?.message?.includes('WebSocket')) {
          console.error("Failed to load guards:", error);
        }
        return [];
      }
    },
    refetchInterval: 10000,
    initialData: [],
    retry: 3
  });

  const { data: pendingIncidents } = useQuery({
    queryKey: ["pendingIncidents"],
    queryFn: async () => {
      try {
        return await base44.entities.Incident.filter(
          { status: ["reported", "assigned"] },
          "-reported_at",
          15
        );
      } catch (error) {
        if (!error?.message?.includes('WebSocket')) {
          console.error("Failed to load incidents:", error);
        }
        return [];
      }
    },
    refetchInterval: 5000,
    initialData: [],
    retry: 3
  });

  const { data: activeAlarms } = useQuery({
    queryKey: ["activeAlarms"],
    queryFn: async () => {
      try {
        return await base44.entities.AlarmResponse.filter(
          { status: ["dispatched", "acknowledged", "en_route", "arrived"] },
          "-dispatched_at",
          10
        );
      } catch (error) {
        if (!error?.message?.includes('WebSocket')) {
          console.error("Failed to load alarms:", error);
        }
        return [];
      }
    },
    refetchInterval: 5000,
    initialData: [],
    retry: 3
  });

  const criticalAlerts = activeAlerts.filter(a => a.priority === "critical").length;
  const highPriorityIncidents = pendingIncidents.filter(i => i.priority === "high" || i.priority === "critical").length;

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center animate-pulse">
            <Radio className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Control Room</h1>
            <p className="text-slate-400">Real-time fleet monitoring & incident management</p>
          </div>
        </div>

        <Button
          onClick={() => setShowDispatchAlarm(true)}
          className="bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
        >
          <Zap className="w-5 h-5 mr-2" />
          Dispatch Alarm
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Active Guards</p>
                <p className="text-3xl font-bold text-white">{activeGuards.length}</p>
              </div>
              <Users className="w-8 h-8 text-sky-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Active Alerts</p>
                <p className="text-3xl font-bold text-white">{activeAlerts.length}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-500/10 to-rose-600/10 border-rose-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Pending Incidents</p>
                <p className="text-3xl font-bold text-white">{pendingIncidents.length}</p>
              </div>
              <MapPin className="w-8 h-8 text-rose-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Active Alarms</p>
                <p className="text-3xl font-bold text-white">{activeAlarms.length}</p>
              </div>
              <Radio className="w-8 h-8 text-emerald-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Map */}
        <div className="lg:col-span-2 space-y-6">
          <LiveMap 
            guards={activeGuards} 
            incidents={pendingIncidents}
            alarms={activeAlarms}
          />
          
          {/* AI-Powered Incident Analysis */}
          <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/20">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                AI Incident Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pendingIncidents.length > 0 ? (
                <div className="space-y-3">
                  {pendingIncidents.slice(0, 3).map(incident => (
                    <div 
                      key={incident.id}
                      className="p-3 bg-slate-800/50 rounded-lg border border-slate-700 cursor-pointer hover:border-purple-500/50 transition-colors"
                      onClick={() => setSelectedIncident(incident)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h4 className="text-white font-semibold">{incident.title}</h4>
                          <p className="text-xs text-slate-400">{incident.site_name}</p>
                        </div>
                        <Badge className={
                          incident.priority === 'critical' ? 'bg-rose-500' :
                          incident.priority === 'high' ? 'bg-orange-500' :
                          'bg-sky-500'
                        }>
                          {incident.priority}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIncident(incident);
                        }}
                      >
                        <Sparkles className="w-3 h-3 mr-2" />
                        Get AI Analysis
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-400 text-center py-4">No pending incidents to analyze</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Alerts & Guards */}
        <div className="space-y-6">
          <AlertPanel alerts={activeAlerts} />
          <ActiveGuardsPanel guards={activeGuards} />
          <IncidentQueue incidents={pendingIncidents} />
        </div>
      </div>

      {/* Dispatch Alarm Modal */}
      {showDispatchAlarm && (
        <DispatchAlarm
          dispatcher={user}
          onClose={() => setShowDispatchAlarm(false)}
          onSuccess={() => setShowDispatchAlarm(false)}
        />
      )}

      {/* AI Incident Analysis Modal */}
      {selectedIncident && (
        <AIIncidentAnalysis
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    </div>
  );
}