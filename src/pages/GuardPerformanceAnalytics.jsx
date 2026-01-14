import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  Clock, 
  AlertTriangle, 
  FileText, 
  TrendingUp, 
  TrendingDown,
  Award,
  AlertCircle,
  Download,
  Search
} from "lucide-react";
import moment from "moment";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";

export default function GuardPerformanceAnalytics() {
  const [dateFrom, setDateFrom] = useState(moment().subtract(30, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(moment().format('YYYY-MM-DD'));
  const [selectedSite, setSelectedSite] = useState("all");
  const [selectedGuard, setSelectedGuard] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: guards = [], isLoading: loadingGuards } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === 'guard');
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list()
  });

  const { data: shifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => base44.entities.Shift.list()
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => base44.entities.Incident.list()
  });

  const { data: generatedReports = [] } = useQuery({
    queryKey: ['generated-reports'],
    queryFn: () => base44.entities.GeneratedReport.list()
  });

  const guardMetrics = useMemo(() => {
    const metrics = guards.map(guard => {
      const guardShifts = shifts.filter(s => 
        s.guard_id === guard.id &&
        moment(s.start_time).isBetween(dateFrom, dateTo, 'day', '[]')
      );

      if (selectedSite !== "all") {
        guardShifts.filter(s => s.site_id === selectedSite);
      }

      const completedShifts = guardShifts.filter(s => s.status === 'completed');
      const guardIncidents = incidents.filter(i => 
        i.guard_id === guard.id &&
        moment(i.reported_at || i.created_date).isBetween(dateFrom, dateTo, 'day', '[]')
      );
      
      const guardReports = generatedReports.filter(r => 
        r.guard_id === guard.id &&
        moment(r.generated_at || r.created_date).isBetween(dateFrom, dateTo, 'day', '[]')
      );

      // Calculate average response time (time from incident reported to assigned/in_progress)
      const responseTimesMinutes = guardIncidents
        .filter(i => i.status !== 'reported' && i.reported_at)
        .map(i => {
          const reported = moment(i.reported_at);
          const responded = moment(i.updated_date);
          return responded.diff(reported, 'minutes');
        })
        .filter(t => t >= 0 && t < 1440); // Filter out invalid times (negative or > 24 hours)

      const avgResponseTime = responseTimesMinutes.length > 0
        ? Math.round(responseTimesMinutes.reduce((a, b) => a + b, 0) / responseTimesMinutes.length)
        : null;

      // Calculate average shift duration
      const shiftDurations = completedShifts
        .filter(s => s.clock_in?.timestamp && s.clock_out?.timestamp)
        .map(s => {
          const clockIn = moment(s.clock_in.timestamp);
          const clockOut = moment(s.clock_out.timestamp);
          return clockOut.diff(clockIn, 'hours', true);
        });

      const avgShiftDuration = shiftDurations.length > 0
        ? (shiftDurations.reduce((a, b) => a + b, 0) / shiftDurations.length).toFixed(1)
        : null;

      // Calculate late clock-ins (more than 15 minutes after shift start)
      const lateClockIns = guardShifts.filter(s => {
        if (!s.clock_in?.timestamp || !s.start_time) return false;
        const scheduledStart = moment(s.start_time);
        const actualClockIn = moment(s.clock_in.timestamp);
        return actualClockIn.diff(scheduledStart, 'minutes') > 15;
      }).length;

      // Calculate missed shifts
      const missedShifts = guardShifts.filter(s => s.status === 'missed').length;

      // On-time reports (reports filed within 24 hours of shift end)
      const onTimeReports = guardReports.filter(r => {
        const report = generatedReports.find(rep => rep.id === r.id);
        if (!report || !report.shift_id) return false;
        const shift = shifts.find(s => s.id === report.shift_id);
        if (!shift || !shift.end_time) return false;
        const shiftEnd = moment(shift.end_time);
        const reportTime = moment(report.generated_at || report.created_date);
        return reportTime.diff(shiftEnd, 'hours') <= 24;
      }).length;

      // Performance score (0-100)
      let score = 100;
      if (lateClockIns > 0) score -= lateClockIns * 5;
      if (missedShifts > 0) score -= missedShifts * 10;
      if (avgResponseTime && avgResponseTime > 30) score -= 10;
      if (guardReports.length === 0 && completedShifts.length > 0) score -= 20;
      score = Math.max(0, Math.min(100, score));

      return {
        guard,
        totalShifts: guardShifts.length,
        completedShifts: completedShifts.length,
        missedShifts,
        lateClockIns,
        totalIncidents: guardIncidents.length,
        avgResponseTime,
        avgShiftDuration,
        totalReports: guardReports.length,
        onTimeReports,
        performanceScore: score
      };
    });

    return metrics;
  }, [guards, shifts, incidents, generatedReports, dateFrom, dateTo, selectedSite]);

  const filteredMetrics = useMemo(() => {
    return guardMetrics.filter(metric => {
      const guardMatch = selectedGuard === "all" || metric.guard.id === selectedGuard;
      const searchMatch = searchQuery === "" || 
        metric.guard.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        metric.guard.badge_number?.toLowerCase().includes(searchQuery.toLowerCase());
      return guardMatch && searchMatch;
    });
  }, [guardMetrics, selectedGuard, searchQuery]);

  const summaryStats = useMemo(() => {
    const totalGuards = filteredMetrics.length;
    const avgPerformance = totalGuards > 0
      ? Math.round(filteredMetrics.reduce((sum, m) => sum + m.performanceScore, 0) / totalGuards)
      : 0;
    
    const topPerformers = filteredMetrics
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, 3);

    const needsAttention = filteredMetrics.filter(m => 
      m.performanceScore < 70 || m.lateClockIns > 3 || m.missedShifts > 1
    );

    return {
      totalGuards,
      avgPerformance,
      topPerformers,
      needsAttention,
      totalShifts: filteredMetrics.reduce((sum, m) => sum + m.totalShifts, 0),
      totalIncidents: filteredMetrics.reduce((sum, m) => sum + m.totalIncidents, 0),
      totalReports: filteredMetrics.reduce((sum, m) => sum + m.totalReports, 0)
    };
  }, [filteredMetrics]);

  const exportToCSV = () => {
    const headers = ['Guard Name', 'Badge', 'Performance Score', 'Total Shifts', 'Completed', 'Missed', 'Late Clock-ins', 'Incidents', 'Avg Response (min)', 'Avg Shift (hrs)', 'Reports Filed', 'On-Time Reports'];
    const rows = filteredMetrics.map(m => [
      m.guard.full_name,
      m.guard.badge_number || 'N/A',
      m.performanceScore,
      m.totalShifts,
      m.completedShifts,
      m.missedShifts,
      m.lateClockIns,
      m.totalIncidents,
      m.avgResponseTime || 'N/A',
      m.avgShiftDuration || 'N/A',
      m.totalReports,
      m.onTimeReports
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guard-performance-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  };

  const chartData = useMemo(() => {
    return filteredMetrics
      .sort((a, b) => b.performanceScore - a.performanceScore)
      .slice(0, 10)
      .map(m => ({
        name: m.guard.full_name?.split(' ')[0] || 'Guard',
        score: m.performanceScore,
        shifts: m.completedShifts,
        incidents: m.totalIncidents
      }));
  }, [filteredMetrics]);

  if (loadingGuards || loadingShifts) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <Users className="w-8 h-8 text-sky-400" />
            Guard Performance Analytics
          </h1>
          <p className="text-slate-400 mt-1">Monitor and analyze guard performance metrics</p>
        </div>
        <Button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-700">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-sky-500/20 to-sky-600/20 border-sky-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-sky-300 mb-1">Total Guards</p>
                <p className="text-3xl font-bold text-white">{summaryStats.totalGuards}</p>
              </div>
              <Users className="w-10 h-10 text-sky-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 border-emerald-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-300 mb-1">Avg Performance</p>
                <p className="text-3xl font-bold text-white">{summaryStats.avgPerformance}%</p>
              </div>
              <TrendingUp className="w-10 h-10 text-emerald-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/20 to-purple-600/20 border-purple-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-purple-300 mb-1">Top Performers</p>
                <p className="text-3xl font-bold text-white">{summaryStats.topPerformers.length}</p>
              </div>
              <Award className="w-10 h-10 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-500/20 to-rose-600/20 border-rose-500/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-rose-300 mb-1">Needs Attention</p>
                <p className="text-3xl font-bold text-white">{summaryStats.needsAttention.length}</p>
              </div>
              <AlertCircle className="w-10 h-10 text-rose-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Site</label>
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Sites</SelectItem>
                  {sites.map(site => (
                    <SelectItem key={site.id} value={site.id} className="text-white">{site.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Guard</label>
              <Select value={selectedGuard} onValueChange={setSelectedGuard}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Guards</SelectItem>
                  {guards.map(guard => (
                    <SelectItem key={guard.id} value={guard.id} className="text-white">{guard.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Name or badge..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Chart */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Performance Overview (Top 10)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Bar dataKey="score" fill="#0ea5e9" name="Performance Score" />
              <Bar dataKey="shifts" fill="#10b981" name="Completed Shifts" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Performers */}
      {summaryStats.topPerformers.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summaryStats.topPerformers.map((metric, idx) => (
                <div key={metric.guard.id} className="flex items-center gap-4 p-3 bg-slate-900/50 rounded-lg">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold">{metric.guard.full_name}</p>
                    <p className="text-sm text-slate-400">{metric.guard.badge_number}</p>
                  </div>
                  <Badge className="bg-emerald-600 text-white">
                    {metric.performanceScore}% Score
                  </Badge>
                  <div className="text-right text-sm text-slate-400">
                    <p>{metric.completedShifts} shifts</p>
                    <p>{metric.totalIncidents} incidents</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Guard Details Table */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Guard Performance Details</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredMetrics.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No guards found matching your filters</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMetrics.map(metric => (
                <div key={metric.guard.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center text-white font-bold">
                        {metric.guard.full_name?.[0]?.toUpperCase() || 'G'}
                      </div>
                      <div>
                        <p className="text-white font-semibold">{metric.guard.full_name}</p>
                        <p className="text-sm text-slate-400">{metric.guard.badge_number || 'No badge'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={
                        metric.performanceScore >= 90 ? "bg-emerald-600" :
                        metric.performanceScore >= 70 ? "bg-sky-600" :
                        metric.performanceScore >= 50 ? "bg-amber-600" :
                        "bg-rose-600"
                      }>
                        {metric.performanceScore}% Performance
                      </Badge>
                      {metric.performanceScore < 70 && (
                        <Badge className="bg-rose-600">
                          <AlertCircle className="w-3 h-3 mr-1" />
                          Needs Attention
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                        <Clock className="w-3 h-3" />
                        Total Shifts
                      </div>
                      <p className="text-white font-semibold">{metric.totalShifts}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-emerald-400 text-xs mb-1">
                        <Clock className="w-3 h-3" />
                        Completed
                      </div>
                      <p className="text-white font-semibold">{metric.completedShifts}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-rose-400 text-xs mb-1">
                        <AlertTriangle className="w-3 h-3" />
                        Missed
                      </div>
                      <p className="text-white font-semibold">{metric.missedShifts}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-amber-400 text-xs mb-1">
                        <Clock className="w-3 h-3" />
                        Late Clock-ins
                      </div>
                      <p className="text-white font-semibold">{metric.lateClockIns}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-sky-400 text-xs mb-1">
                        <AlertTriangle className="w-3 h-3" />
                        Incidents
                      </div>
                      <p className="text-white font-semibold">{metric.totalIncidents}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="flex items-center gap-2 text-purple-400 text-xs mb-1">
                        <FileText className="w-3 h-3" />
                        Reports
                      </div>
                      <p className="text-white font-semibold">{metric.totalReports}</p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="text-slate-400 text-xs mb-1">Avg Response</div>
                      <p className="text-white font-semibold">
                        {metric.avgResponseTime ? `${metric.avgResponseTime}m` : 'N/A'}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="text-slate-400 text-xs mb-1">Avg Shift</div>
                      <p className="text-white font-semibold">
                        {metric.avgShiftDuration ? `${metric.avgShiftDuration}h` : 'N/A'}
                      </p>
                    </div>

                    <div className="p-3 bg-slate-800/50 rounded">
                      <div className="text-slate-400 text-xs mb-1">On-Time Reports</div>
                      <p className="text-white font-semibold">
                        {metric.onTimeReports}/{metric.totalReports}
                      </p>
                    </div>
                  </div>

                  {(metric.lateClockIns > 3 || metric.missedShifts > 1) && (
                    <div className="mt-3 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                      <p className="text-rose-400 text-sm font-semibold flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Recurring Issues Detected
                      </p>
                      <ul className="text-rose-300 text-xs mt-2 space-y-1">
                        {metric.lateClockIns > 3 && (
                          <li>• Frequent late clock-ins ({metric.lateClockIns} times)</li>
                        )}
                        {metric.missedShifts > 1 && (
                          <li>• Multiple missed shifts ({metric.missedShifts} times)</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}