
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Shield, Radio, AlertTriangle, Bell, Send } from "lucide-react"; // Added Send icon
import { Button } from "@/components/ui/button"; // Added Button component
import LiveMap from "../components/dispatcher/LiveMap";
import AlertPanel from "../components/dispatcher/AlertPanel";
import ActiveGuardsPanel from "../components/dispatcher/ActiveGuardsPanel";
import IncidentQueue from "../components/dispatcher/IncidentQueue";
import DispatchAlarm from "../components/dispatcher/DispatchAlarm"; // Added DispatchAlarm component

export default function ControlRoom() {
  const [user, setUser] = useState(null);
  const [showDispatch, setShowDispatch] = useState(false); // New state for DispatchAlarm modal

  const queryClient = useQueryClient(); // Initialize useQueryClient

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
      return await base44.entities.Alert.filter(
        { status: "active" },
        "-created_date",
        10
      );
    },
    refetchInterval: 10000,
    initialData: []
  });

  const { data: activeGuards } = useQuery({
    queryKey: ["activeGuards"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter(
        { status: "active" },
        "-created_date"
      );
      return shifts;
    },
    refetchInterval: 30000,
    initialData: []
  });

  const { data: pendingIncidents } = useQuery({
    queryKey: ["pendingIncidents"],
    queryFn: async () => {
      return await base44.entities.Incident.filter(
        { status: "reported" },
        "-reported_at",
        20
      );
    },
    refetchInterval: 10000,
    initialData: []
  });

  // New query for active alarm responses
  const { data: activeResponses } = useQuery({
    queryKey: ["activeResponses"],
    queryFn: async () => {
      return await base44.entities.AlarmResponse.filter(
        { status: ["dispatched", "acknowledged", "en_route", "arrived"] },
        "-dispatched_at",
        20
      );
    },
    refetchInterval: 10000,
    initialData: []
  });

  const criticalAlerts = activeAlerts.filter(a => a.priority === "critical").length;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <Radio className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Dispatcher Control Room</h1>
            <p className="text-slate-400">Real-time fleet monitoring and incident management</p>
          </div>
        </div>

        {/* Dispatch Alarm Button */}
        <div className="flex gap-3">
          <Button
            onClick={() => setShowDispatch(true)}
            className="bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
          >
            <Send className="w-5 h-5 mr-2" />
            Dispatch Alarm
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="flex gap-3">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-400" />
            <div>
              <p className="text-xs text-slate-400">Active Guards</p>
              <p className="text-2xl font-bold text-white">{activeGuards.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className={`${criticalAlerts > 0 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-slate-800/50 border-slate-700'}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <Bell className={`w-8 h-8 ${criticalAlerts > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`} />
            <div>
              <p className="text-xs text-slate-400">Active Alerts</p>
              <p className="text-2xl font-bold text-white">{activeAlerts.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-amber-400" />
            <div>
              <p className="text-xs text-slate-400">New Incidents</p>
              <p className="text-2xl font-bold text-white">{pendingIncidents.length}</p>
            </div>
          </CardContent>
        </Card>

        {/* New Card for Active Responses */}
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <Send className="w-8 h-8 text-rose-400" />
            <div>
              <p className="text-xs text-slate-400">Active Responses</p>
              <p className="text-2xl font-bold text-white">{activeResponses.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Map View - Takes 2 columns */}
        <div className="lg:col-span-2">
          <LiveMap guards={activeGuards} />
        </div>

        {/* Right Sidebar */}
        <div className="space-y-6">
          <AlertPanel alerts={activeAlerts} />
          <ActiveGuardsPanel guards={activeGuards} />
        </div>
      </div>

      {/* Incident Queue */}
      <IncidentQueue incidents={pendingIncidents} guards={activeGuards} />

      {/* Dispatch Alarm Modal */}
      {showDispatch && (
        <DispatchAlarm
          onClose={() => setShowDispatch(false)}
          onSuccess={() => {
            setShowDispatch(false);
            queryClient.invalidateQueries(["activeResponses"]);
          }}
        />
      )}
    </div>
  );
}
