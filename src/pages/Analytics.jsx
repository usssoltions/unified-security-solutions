import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, Users, AlertTriangle, Calendar, Sparkles } from "lucide-react";
import GuardPerformanceMetrics from "../components/analytics/GuardPerformanceMetrics";
import SiteActivityTrends from "../components/analytics/SiteActivityTrends";
import MaintenanceAnalysis from "../components/analytics/MaintenanceAnalysis";
import KPIDashboard from "../components/analytics/KPIDashboard";
import ComparativeAnalytics from "../components/analytics/ComparativeAnalytics";
import CustomReportBuilder from "../components/analytics/CustomReportBuilder";
import ReportScheduler from "../components/analytics/ReportScheduler";
import AIRiskPredictor from "../components/analytics/AIRiskPredictor";

export default function Analytics() {
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    const loadUser = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    };
    loadUser();
  }, []);

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
            <p className="text-slate-400 mt-1">Comprehensive security insights and metrics</p>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="overview" className="data-[state=active]:bg-sky-600">
              <BarChart3 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="ai-risk" className="data-[state=active]:bg-purple-600">
              <Sparkles className="w-4 h-4 mr-2" />
              AI Risk Predictor
            </TabsTrigger>
            <TabsTrigger value="performance" className="data-[state=active]:bg-sky-600">
              <Users className="w-4 h-4 mr-2" />
              Performance
            </TabsTrigger>
            <TabsTrigger value="sites" className="data-[state=active]:bg-sky-600">
              <TrendingUp className="w-4 h-4 mr-2" />
              Sites
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="data-[state=active]:bg-sky-600">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="comparative" className="data-[state=active]:bg-sky-600">
              <Calendar className="w-4 h-4 mr-2" />
              Comparative
            </TabsTrigger>
            <TabsTrigger value="custom" className="data-[state=active]:bg-sky-600">
              Custom Reports
            </TabsTrigger>
            <TabsTrigger value="scheduler" className="data-[state=active]:bg-sky-600">
              Scheduler
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <KPIDashboard />
          </TabsContent>

          <TabsContent value="ai-risk" className="space-y-6">
            <AIRiskPredictor user={user} />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <GuardPerformanceMetrics />
          </TabsContent>

          <TabsContent value="sites" className="space-y-6">
            <SiteActivityTrends />
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6">
            <MaintenanceAnalysis />
          </TabsContent>

          <TabsContent value="comparative" className="space-y-6">
            <ComparativeAnalytics />
          </TabsContent>

          <TabsContent value="custom" className="space-y-6">
            <CustomReportBuilder />
          </TabsContent>

          <TabsContent value="scheduler" className="space-y-6">
            <ReportScheduler />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}