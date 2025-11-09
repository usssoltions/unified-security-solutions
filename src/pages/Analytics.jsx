import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, TrendingUp, Calendar, FileText, Users, MapPin, Wrench } from "lucide-react";
import KPIDashboard from "../components/analytics/KPIDashboard";
import GuardPerformanceMetrics from "../components/analytics/GuardPerformanceMetrics";
import SiteActivityTrends from "../components/analytics/SiteActivityTrends";
import MaintenanceAnalysis from "../components/analytics/MaintenanceAnalysis";
import CustomReportBuilder from "../components/analytics/CustomReportBuilder";
import ReportScheduler from "../components/analytics/ReportScheduler";
import ComparativeAnalytics from "../components/analytics/ComparativeAnalytics";

export default function Analytics() {
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    end: new Date().toISOString()
  });
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);

  const { data: incidents } = useQuery({
    queryKey: ["analytics-incidents", dateRange],
    queryFn: async () => {
      return await base44.entities.Incident.list("-reported_at", 1000);
    },
    initialData: []
  });

  const { data: shifts } = useQuery({
    queryKey: ["analytics-shifts", dateRange],
    queryFn: async () => {
      return await base44.entities.Shift.list("-start_time", 1000);
    },
    initialData: []
  });

  const { data: checklists } = useQuery({
    queryKey: ["analytics-checklists", dateRange],
    queryFn: async () => {
      return await base44.entities.ChecklistCompletion.list("-completed_at", 1000);
    },
    initialData: []
  });

  const { data: stayAwakeLogs } = useQuery({
    queryKey: ["analytics-stayawake", dateRange],
    queryFn: async () => {
      return await base44.entities.StayAwakeLog.list("-alert_time", 1000);
    },
    initialData: []
  });

  const { data: maintenanceRequests } = useQuery({
    queryKey: ["analytics-maintenance", dateRange],
    queryFn: async () => {
      return await base44.entities.MaintenanceRequest.list("-reported_at", 1000);
    },
    initialData: []
  });

  const { data: alarmResponses } = useQuery({
    queryKey: ["analytics-alarms", dateRange],
    queryFn: async () => {
      return await base44.entities.AlarmResponse.list("-dispatched_at", 1000);
    },
    initialData: []
  });

  const { data: guards } = useQuery({
    queryKey: ["analytics-guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const { data: sites } = useQuery({
    queryKey: ["analytics-sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    },
    initialData: []
  });

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-violet-400 to-violet-600 rounded-full flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Advanced Analytics</h1>
            <p className="text-slate-400">Comprehensive reporting and insights</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={() => setShowScheduler(true)}
            variant="outline"
            className="border-slate-600 text-slate-300"
          >
            <Calendar className="w-5 h-5 mr-2" />
            Schedule Reports
          </Button>
          <Button
            onClick={() => setShowReportBuilder(true)}
            className="bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700"
          >
            <FileText className="w-5 h-5 mr-2" />
            Custom Report
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="overview">
            <TrendingUp className="w-4 h-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="guards">
            <Users className="w-4 h-4 mr-2" />
            Guard Performance
          </TabsTrigger>
          <TabsTrigger value="sites">
            <MapPin className="w-4 h-4 mr-2" />
            Site Activity
          </TabsTrigger>
          <TabsTrigger value="maintenance">
            <Wrench className="w-4 h-4 mr-2" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="comparative">
            <BarChart3 className="w-4 h-4 mr-2" />
            Comparative
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <KPIDashboard
            incidents={incidents}
            shifts={shifts}
            checklists={checklists}
            stayAwakeLogs={stayAwakeLogs}
            maintenanceRequests={maintenanceRequests}
            alarmResponses={alarmResponses}
          />
        </TabsContent>

        {/* Guard Performance Tab */}
        <TabsContent value="guards" className="space-y-6">
          <GuardPerformanceMetrics
            guards={guards}
            incidents={incidents}
            shifts={shifts}
            stayAwakeLogs={stayAwakeLogs}
            checklists={checklists}
            alarmResponses={alarmResponses}
          />
        </TabsContent>

        {/* Site Activity Tab */}
        <TabsContent value="sites" className="space-y-6">
          <SiteActivityTrends
            sites={sites}
            incidents={incidents}
            shifts={shifts}
            maintenanceRequests={maintenanceRequests}
          />
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="space-y-6">
          <MaintenanceAnalysis
            maintenanceRequests={maintenanceRequests}
            sites={sites}
          />
        </TabsContent>

        {/* Comparative Tab */}
        <TabsContent value="comparative" className="space-y-6">
          <ComparativeAnalytics
            incidents={incidents}
            shifts={shifts}
            maintenanceRequests={maintenanceRequests}
            dateRange={dateRange}
          />
        </TabsContent>
      </Tabs>

      {/* Custom Report Builder Modal */}
      {showReportBuilder && (
        <CustomReportBuilder
          onClose={() => setShowReportBuilder(false)}
          onSave={() => {
            setShowReportBuilder(false);
          }}
        />
      )}

      {/* Report Scheduler Modal */}
      {showScheduler && (
        <ReportScheduler
          onClose={() => setShowScheduler(false)}
          onSave={() => {
            setShowScheduler(false);
          }}
        />
      )}
    </div>
  );
}