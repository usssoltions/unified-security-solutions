import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Download, Plus, Calendar } from "lucide-react";
import KPIDashboard from "../components/analytics/KPIDashboard";
import ComparativeAnalytics from "../components/analytics/ComparativeAnalytics";
import CustomReportBuilder from "../components/analytics/CustomReportBuilder";
import ReportScheduler from "../components/analytics/ReportScheduler";

export default function Analytics() {
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [showReportBuilder, setShowReportBuilder] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);

  const { data: incidents } = useQuery({
    queryKey: ["analyticsIncidents", dateRange],
    queryFn: async () => {
      return await base44.entities.Incident.list("-reported_at", 1000);
    },
    initialData: []
  });

  const { data: shifts } = useQuery({
    queryKey: ["analyticsShifts", dateRange],
    queryFn: async () => {
      return await base44.entities.Shift.list("-start_time", 1000);
    },
    initialData: []
  });

  const { data: checklists } = useQuery({
    queryKey: ["analyticsChecklists", dateRange],
    queryFn: async () => {
      return await base44.entities.ChecklistCompletion.list("-completed_at", 1000);
    },
    initialData: []
  });

  const { data: stayAwakeLogs } = useQuery({
    queryKey: ["analyticsStayAwake", dateRange],
    queryFn: async () => {
      return await base44.entities.StayAwakeLog.list("-alert_time", 1000);
    },
    initialData: []
  });

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Analytics & Reports</h1>
            <p className="text-slate-400">Insights, trends, and custom reporting</p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setShowScheduler(true)}
            className="border-slate-600 text-slate-300"
          >
            <Calendar className="w-5 h-5 mr-2" />
            Schedule Reports
          </Button>
          <Button
            onClick={() => setShowReportBuilder(true)}
            className="bg-gradient-to-r from-purple-500 to-purple-600"
          >
            <Plus className="w-5 h-5 mr-2" />
            Custom Report
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="comparative">Comparative</TabsTrigger>
          <TabsTrigger value="guards">Guard Performance</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <KPIDashboard
            incidents={incidents}
            shifts={shifts}
            checklists={checklists}
            stayAwakeLogs={stayAwakeLogs}
            dateRange={dateRange}
          />
        </TabsContent>

        <TabsContent value="comparative" className="mt-6">
          <ComparativeAnalytics
            incidents={incidents}
            shifts={shifts}
            checklists={checklists}
          />
        </TabsContent>

        <TabsContent value="guards" className="mt-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Guard Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-400">Guard-level KPIs and performance tracking</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="mt-6">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Compliance Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-slate-400">SLA adherence, checklist completion, stay-awake compliance</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {showReportBuilder && (
        <CustomReportBuilder onClose={() => setShowReportBuilder(false)} />
      )}

      {showScheduler && (
        <ReportScheduler onClose={() => setShowScheduler(false)} />
      )}
    </div>
  );
}