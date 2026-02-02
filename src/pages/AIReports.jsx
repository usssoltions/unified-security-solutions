import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, FileText, Loader2, Download, TrendingUp, AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import ReportDisplay from "../components/reports/ReportDisplay";
import ReportHistory from "../components/reports/ReportHistory";
import AutomatedReportScheduler from "../components/reports/AutomatedReportScheduler";

export default function AIReports() {
  const [reportType, setReportType] = useState("guard"); // guard, site, overall, monthly_incidents, monthly_maintenance
  const [reportPeriod, setReportPeriod] = useState("daily"); // daily, weekly, monthly
  const [selectedEntity, setSelectedEntity] = useState(null); // guard ID or site ID
  const [generatedReport, setGeneratedReport] = useState(null);
  const [generating, setGenerating] = useState(false);

  const { data: guards } = useQuery({
    queryKey: ["allGuards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const { data: sites } = useQuery({
    queryKey: ["allSites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    },
    initialData: []
  });

  const getDateRange = () => {
    const now = new Date();
    let startDate, endDate = now;

    switch (reportPeriod) {
      case "daily":
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case "weekly":
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case "monthly":
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
    }

    return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  };

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const fetchReportData = async () => {
    const { startDate, endDate } = getDateRange();

    try {
      // Fetch all relevant data in parallel
      const [shifts, incidents, maintenance, patrolLogs, locationHistory, stayAwakeLogs, checklistCompletions] = await Promise.all([
        base44.entities.Shift.list("-start_time", 500),
        base44.entities.Incident.list("-reported_at", 500),
        base44.entities.MaintenanceRequest.list("-reported_at", 500),
        base44.entities.PatrolLog.list("-timestamp", 500),
        base44.entities.LocationTracking.list("-timestamp", 500),
        base44.entities.StayAwakeLog.list("-alert_time", 500),
        base44.entities.ChecklistCompletion.list("-completed_at", 500)
      ]);

      // Filter by date range
      const filterByDate = (items, dateField) => 
        items.filter(item => {
          const itemDate = new Date(item[dateField]);
          return itemDate >= new Date(startDate) && itemDate <= new Date(endDate);
        });

      const filteredShifts = filterByDate(shifts, "start_time");
      const filteredIncidents = filterByDate(incidents, "reported_at");
      const filteredMaintenance = filterByDate(maintenance, "reported_at");
      const filteredPatrolLogs = filterByDate(patrolLogs, "timestamp");
      const filteredLocationHistory = filterByDate(locationHistory, "timestamp");
      const filteredStayAwakeLogs = filterByDate(stayAwakeLogs, "alert_time");
      const filteredChecklistCompletions = filterByDate(checklistCompletions, "completed_at");

      // Apply entity filter
      if (reportType === "guard" && selectedEntity) {
        return {
          shifts: filteredShifts.filter(s => s.guard_id === selectedEntity),
          incidents: filteredIncidents.filter(i => i.guard_id === selectedEntity),
          maintenance: filteredMaintenance.filter(m => m.guard_id === selectedEntity),
          patrolLogs: filteredPatrolLogs.filter(p => p.guard_id === selectedEntity),
          locationHistory: filteredLocationHistory.filter(l => l.guard_id === selectedEntity),
          stayAwakeLogs: filteredStayAwakeLogs.filter(s => s.guard_id === selectedEntity),
          checklistCompletions: filteredChecklistCompletions.filter(c => c.guard_id === selectedEntity)
        };
      }

      if (reportType === "site" && selectedEntity) {
        return {
          shifts: filteredShifts.filter(s => s.site_id === selectedEntity),
          incidents: filteredIncidents.filter(i => i.site_id === selectedEntity),
          maintenance: filteredMaintenance.filter(m => m.site_id === selectedEntity),
          patrolLogs: filteredPatrolLogs.filter(p => p.site_id === selectedEntity),
          locationHistory: filteredLocationHistory,
          stayAwakeLogs: filteredStayAwakeLogs,
          checklistCompletions: filteredChecklistCompletions.filter(c => c.site_id === selectedEntity)
        };
      }

      // Overall report - all data
      return {
        shifts: filteredShifts,
        incidents: filteredIncidents,
        maintenance: filteredMaintenance,
        patrolLogs: filteredPatrolLogs,
        locationHistory: filteredLocationHistory,
        stayAwakeLogs: filteredStayAwakeLogs,
        checklistCompletions: filteredChecklistCompletions
      };
    } catch (error) {
      console.error("Failed to fetch report data:", error);
      throw error;
    }
  };

  const generateReport = async () => {
    // Monthly reports don't need entity selection
    if (reportType === "monthly_incidents" || reportType === "monthly_maintenance") {
      setGenerating(true);
      try {
        const functionName = reportType === "monthly_incidents" 
          ? 'generateMonthlyIncidentReport' 
          : 'generateMonthlyMaintenanceReport';
        
        const { data } = await base44.functions.invoke(functionName);
        
        if (data.success) {
          window.open(data.pdfUrl, '_blank');
          alert('Monthly report generated successfully! Check your downloads.');
        } else {
          alert('Failed to generate report: ' + data.error);
        }
      } catch (error) {
        alert("Failed to generate report: " + error.message);
      } finally {
        setGenerating(false);
      }
      return;
    }
    
    if (reportType !== "overall" && !selectedEntity) {
      alert("Please select a guard or site");
      return;
    }

    setGenerating(true);
    try {
      const data = await fetchReportData();

      // Calculate clock in/out metrics
      const clockedInShifts = data.shifts.filter(s => s.clock_in?.timestamp);
      const clockedOutShifts = data.shifts.filter(s => s.clock_out?.timestamp);
      const onTimeClockIns = clockedInShifts.filter(s => {
        const clockIn = new Date(s.clock_in.timestamp);
        const scheduled = new Date(s.start_time);
        return clockIn <= new Date(scheduled.getTime() + 15 * 60000); // 15 min grace
      }).length;
      
      const avgShiftDuration = clockedOutShifts.reduce((acc, s) => {
        const duration = (new Date(s.clock_out.timestamp) - new Date(s.clock_in.timestamp)) / 3600000;
        return acc + duration;
      }, 0) / (clockedOutShifts.length || 1);

      // Calculate checkpoint metrics
      const totalCheckpoints = data.checklistCompletions.reduce((acc, c) => 
        acc + (c.completed_items?.length || 0), 0
      );
      const completedCheckpoints = data.checklistCompletions.filter(c => 
        c.status === "completed"
      ).length;

      // Calculate metrics
      const metrics = {
        totalShifts: data.shifts.length,
        completedShifts: data.shifts.filter(s => s.status === "completed").length,
        clockedInShifts: clockedInShifts.length,
        clockedOutShifts: clockedOutShifts.length,
        onTimeClockIns: onTimeClockIns,
        onTimeRate: ((onTimeClockIns / clockedInShifts.length) * 100).toFixed(1),
        avgShiftDuration: avgShiftDuration.toFixed(2),
        totalIncidents: data.incidents.length,
        criticalIncidents: data.incidents.filter(i => i.priority === "critical").length,
        resolvedIncidents: data.incidents.filter(i => i.status === "resolved" || i.status === "closed").length,
        maintenanceRequests: data.maintenance.length,
        completedMaintenance: data.maintenance.filter(m => m.status === "completed").length,
        patrolCheckpoints: data.patrolLogs.length,
        verifiedCheckpoints: data.patrolLogs.filter(p => p.verified).length,
        checklistsCompleted: completedCheckpoints,
        totalCheckpointItems: totalCheckpoints,
        stayAwakeAlerts: data.stayAwakeLogs.length,
        missedStayAwake: data.stayAwakeLogs.filter(s => s.status === "missed").length,
        locationDataPoints: data.locationHistory.length
      };

      // Calculate distance traveled from location history
      let totalDistance = 0;
      for (let i = 1; i < data.locationHistory.length; i++) {
        const prev = data.locationHistory[i - 1];
        const curr = data.locationHistory[i];
        totalDistance += calculateDistance(
          prev.location.lat, prev.location.lng,
          curr.location.lat, curr.location.lng
        );
      }

      // Generate AI report
      const entityName = reportType === "guard" 
        ? guards.find(g => g.id === selectedEntity)?.full_name
        : reportType === "site"
        ? sites.find(s => s.id === selectedEntity)?.name
        : "All Operations";

      const aiReport = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a comprehensive ${reportPeriod} activity report for ${reportType === "overall" ? "all security operations" : `${reportType}: ${entityName}`}.

Period: ${reportPeriod} (${getDateRange().startDate.split('T')[0]} to ${getDateRange().endDate.split('T')[0]})

METRICS SUMMARY:
- Total Shifts: ${metrics.totalShifts} (${metrics.completedShifts} completed)
- Clock In/Out: ${metrics.clockedInShifts} clocked in, ${metrics.clockedOutShifts} clocked out
- On-Time Clock-Ins: ${metrics.onTimeClockIns} (${metrics.onTimeRate}%)
- Avg Shift Duration: ${metrics.avgShiftDuration} hours
- Incidents: ${metrics.totalIncidents} total (${metrics.criticalIncidents} critical, ${metrics.resolvedIncidents} resolved)
- Maintenance: ${metrics.maintenanceRequests} requests (${metrics.completedMaintenance} completed)
- Patrol Checkpoints: ${metrics.patrolCheckpoints} scanned (${metrics.verifiedCheckpoints} verified)
- Tour Stop Checklists: ${metrics.checklistsCompleted} completed (${metrics.totalCheckpointItems} checkpoint items)
- Stay Awake: ${metrics.stayAwakeAlerts} alerts (${metrics.missedStayAwake} missed responses)
- Distance Traveled: ${totalDistance.toFixed(2)} km
- Location Tracking: ${metrics.locationDataPoints} data points

CLOCK IN/OUT DETAILS:
${data.shifts.filter(s => s.clock_in).map(s => {
  const clockIn = new Date(s.clock_in.timestamp);
  const scheduled = new Date(s.start_time);
  const onTime = clockIn <= new Date(scheduled.getTime() + 15 * 60000);
  return `- ${s.guard_name}: Clocked in ${clockIn.toLocaleTimeString()} ${onTime ? '(On Time)' : '(Late)'} at ${s.site_name}`;
}).slice(0, 10).join('\n')}

TOUR STOP CHECKPOINT DETAILS:
${data.checklistCompletions.map(c => 
  `- ${c.guard_name} at ${c.checkpoint_id || 'checkpoint'}: ${c.completed_items?.length || 0} items completed, Status: ${c.status}`
).slice(0, 10).join('\n')}

INCIDENT BREAKDOWN:
${data.incidents.map(i => `- ${i.category}: ${i.title} (${i.priority})`).slice(0, 10).join('\n')}

MAINTENANCE BREAKDOWN:
${data.maintenance.map(m => `- ${m.category}: ${m.title} (${m.urgency})`).slice(0, 10).join('\n')}

Generate a professional report including:
1. Executive Summary (2-3 paragraphs)
2. Performance Highlights (5-7 key achievements)
3. Areas of Concern (3-5 issues if any)
4. Key Performance Indicators (with % comparisons where relevant)
5. Attendance & Punctuality Analysis (clock in/out patterns, on-time rate)
6. Tour Stop & Checkpoint Coverage (completion rates, patterns)
7. Incident Analysis (trends, patterns, severity breakdown)
8. Patrol Coverage Assessment
9. Response Time Analysis
10. Recommendations for Improvement (5-7 specific actions)
11. Resource Allocation Insights
12. Compliance and Safety Notes

Be specific, data-driven, and professional. Include percentages, trends, and actionable insights.`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            performance_highlights: {
              type: "array",
              items: { type: "string" }
            },
            areas_of_concern: {
              type: "array",
              items: { type: "string" }
            },
            kpi_analysis: {
              type: "object",
              properties: {
                shift_completion_rate: { type: "string" },
                on_time_clock_in_rate: { type: "string" },
                incident_resolution_rate: { type: "string" },
                maintenance_completion_rate: { type: "string" },
                checkpoint_verification_rate: { type: "string" },
                checklist_completion_rate: { type: "string" },
                stay_awake_response_rate: { type: "string" }
              }
            },
            attendance_analysis: { type: "string" },
            checkpoint_analysis: { type: "string" },
            incident_analysis: { type: "string" },
            patrol_assessment: { type: "string" },
            response_time_analysis: { type: "string" },
            recommendations: {
              type: "array",
              items: { type: "string" }
            },
            resource_insights: { type: "string" },
            compliance_notes: { type: "string" },
            overall_rating: {
              type: "string",
              enum: ["excellent", "good", "fair", "needs_improvement"]
            }
          }
        }
      });

      const report = {
        id: Date.now().toString(),
        type: reportType,
        period: reportPeriod,
        entity_name: entityName,
        entity_id: selectedEntity,
        generated_at: new Date().toISOString(),
        metrics: metrics,
        distance_traveled: totalDistance.toFixed(2),
        ai_analysis: aiReport,
        raw_data: data
      };

      setGeneratedReport(report);

      // Save report to storage (optional)
      // Could create a Reports entity to store these

      // Notify admins about the submitted report
      try {
        const currentUser = await base44.auth.me();
        if (currentUser?.role_type === 'guard') {
          await base44.functions.invoke('notifyAdminsDailyReport', {
            guardId: currentUser.id,
            guardName: currentUser.full_name,
            reportData: {
              id: report.id,
              summary: report.ai_analysis?.executive_summary || 'Daily activity report generated'
            },
            reportType: reportType,
            period: reportPeriod
          });
        }
      } catch (notifyError) {
        console.error('Failed to send admin notifications:', notifyError);
      }
      
    } catch (error) {
      alert("Failed to generate report: " + error.message);
      console.error("Report generation error:", error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 w-full overflow-x-hidden">
      {/* Header */}
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-white">AI-Powered Reports</h1>
          <p className="text-xs sm:text-sm text-slate-400">Automated activity analysis and insights</p>
        </div>
      </div>

      {/* Report Configuration */}
      <Card className="bg-slate-800/50 border-slate-700 w-full">
        <CardHeader className="p-3 sm:p-4 lg:p-6">
          <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
            Generate Report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4 lg:p-6 pt-0">
          <div className="grid grid-cols-1 gap-3 sm:gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Report Type</label>
              <Select value={reportType} onValueChange={(value) => {
                setReportType(value);
                setSelectedEntity(null);
              }}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="guard">Guard Performance</SelectItem>
                  <SelectItem value="site">Site Activity</SelectItem>
                  <SelectItem value="overall">Overall Operations</SelectItem>
                  <SelectItem value="monthly_incidents">Monthly Incidents Report (PDF)</SelectItem>
                  <SelectItem value="monthly_maintenance">Monthly Maintenance Report (PDF)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Time Period</label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily (Last 24 Hours)</SelectItem>
                  <SelectItem value="weekly">Weekly (Last 7 Days)</SelectItem>
                  <SelectItem value="monthly">Monthly (Last 30 Days)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {reportType === "guard" && (
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Select Guard</label>
                <Select value={selectedEntity} onValueChange={setSelectedEntity}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Choose guard..." />
                  </SelectTrigger>
                  <SelectContent>
                    {guards.map(guard => (
                      <SelectItem key={guard.id} value={guard.id}>
                        {guard.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {reportType === "site" && (
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Select Site</label>
                <Select value={selectedEntity} onValueChange={setSelectedEntity}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Choose site..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <Button
            onClick={generateReport}
            disabled={generating || (reportType !== "overall" && reportType !== "monthly_incidents" && reportType !== "monthly_maintenance" && !selectedEntity)}
            className="w-full h-10 sm:h-11 lg:h-12 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-sm sm:text-base"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 mr-2 animate-spin" />
                <span className="truncate">Generating AI Report...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
                Generate Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Generated Report Display */}
      {generatedReport && (
        <ReportDisplay report={generatedReport} />
      )}

      {/* Automated Report Scheduler */}
      <AutomatedReportScheduler />

      {/* Report History */}
      <ReportHistory />
    </div>
  );
}