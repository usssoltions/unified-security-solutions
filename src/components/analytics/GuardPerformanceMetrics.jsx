import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, CheckCircle2, AlertTriangle, TrendingUp, Award } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

export default function GuardPerformanceMetrics({ guards, incidents, shifts, stayAwakeLogs, checklists, alarmResponses }) {
  const performanceData = useMemo(() => {
    return guards.map(guard => {
      // Incidents handled
      const guardIncidents = incidents.filter(i => i.guard_id === guard.id);
      const resolvedIncidents = guardIncidents.filter(i => i.status === "resolved" || i.status === "closed");
      
      // Shifts
      const guardShifts = shifts.filter(s => s.guard_id === guard.id);
      const completedShifts = guardShifts.filter(s => s.status === "completed");
      const missedShifts = guardShifts.filter(s => s.status === "missed");
      
      // Stay Awake Response
      const guardStayAwake = stayAwakeLogs.filter(s => s.guard_id === guard.id);
      const acknowledgedAlerts = guardStayAwake.filter(s => s.status === "acknowledged");
      const missedAlerts = guardStayAwake.filter(s => s.status === "missed");
      
      // Checklists
      const guardChecklists = checklists.filter(c => c.guard_id === guard.id);
      const completedChecklists = guardChecklists.filter(c => c.status === "completed");
      
      // Alarm Responses
      const guardAlarms = alarmResponses.filter(a => a.assigned_to === guard.id);
      const completedAlarms = guardAlarms.filter(a => a.status === "completed");
      
      // Calculate average response time for alarms
      const avgResponseTime = guardAlarms.length > 0
        ? guardAlarms.reduce((sum, alarm) => {
            if (alarm.response_time_minutes) {
              return sum + alarm.response_time_minutes;
            }
            return sum;
          }, 0) / guardAlarms.filter(a => a.response_time_minutes).length
        : 0;
      
      // Calculate resolution rate
      const resolutionRate = guardIncidents.length > 0
        ? (resolvedIncidents.length / guardIncidents.length) * 100
        : 0;
      
      // Calculate attendance rate
      const attendanceRate = guardShifts.length > 0
        ? ((guardShifts.length - missedShifts.length) / guardShifts.length) * 100
        : 0;
      
      // Calculate stay awake response rate
      const stayAwakeRate = guardStayAwake.length > 0
        ? (acknowledgedAlerts.length / guardStayAwake.length) * 100
        : 0;
      
      // Calculate overall performance score (0-100)
      const performanceScore = (
        (resolutionRate * 0.3) +
        (attendanceRate * 0.3) +
        (stayAwakeRate * 0.2) +
        (completedChecklists.length > 0 ? 20 : 0)
      );

      return {
        guard_id: guard.id,
        guard_name: guard.full_name,
        total_incidents: guardIncidents.length,
        resolved_incidents: resolvedIncidents.length,
        resolution_rate: resolutionRate,
        total_shifts: guardShifts.length,
        completed_shifts: completedShifts.length,
        missed_shifts: missedShifts.length,
        attendance_rate: attendanceRate,
        stay_awake_alerts: guardStayAwake.length,
        stay_awake_responded: acknowledgedAlerts.length,
        stay_awake_rate: stayAwakeRate,
        checklists_completed: completedChecklists.length,
        alarms_responded: completedAlarms.length,
        avg_response_time: avgResponseTime,
        performance_score: performanceScore
      };
    }).sort((a, b) => b.performance_score - a.performance_score);
  }, [guards, incidents, shifts, stayAwakeLogs, checklists, alarmResponses]);

  const topPerformers = performanceData.slice(0, 5);

  const performanceDistribution = useMemo(() => {
    const excellent = performanceData.filter(g => g.performance_score >= 80).length;
    const good = performanceData.filter(g => g.performance_score >= 60 && g.performance_score < 80).length;
    const average = performanceData.filter(g => g.performance_score >= 40 && g.performance_score < 60).length;
    const poor = performanceData.filter(g => g.performance_score < 40).length;

    return [
      { name: "Excellent (80-100)", value: excellent },
      { name: "Good (60-79)", value: good },
      { name: "Average (40-59)", value: average },
      { name: "Poor (<40)", value: poor }
    ];
  }, [performanceData]);

  const incidentsByGuard = useMemo(() => {
    return performanceData.slice(0, 10).map(guard => ({
      name: guard.guard_name.split(' ')[0],
      incidents: guard.total_incidents,
      resolved: guard.resolved_incidents
    }));
  }, [performanceData]);

  const getPerformanceBadge = (score) => {
    if (score >= 80) return <Badge className="bg-emerald-500">Excellent</Badge>;
    if (score >= 60) return <Badge className="bg-sky-500">Good</Badge>;
    if (score >= 40) return <Badge className="bg-amber-500">Average</Badge>;
    return <Badge className="bg-rose-500">Needs Improvement</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-500/10 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Total Guards</p>
                <p className="text-2xl font-bold text-white">{guards.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Avg Resolution Rate</p>
                <p className="text-2xl font-bold text-white">
                  {performanceData.length > 0
                    ? Math.round(performanceData.reduce((sum, g) => sum + g.resolution_rate, 0) / performanceData.length)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-500/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Avg Response Time</p>
                <p className="text-2xl font-bold text-white">
                  {performanceData.length > 0
                    ? Math.round(performanceData.reduce((sum, g) => sum + g.avg_response_time, 0) / performanceData.filter(g => g.avg_response_time > 0).length || 0)
                    : 0} min
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Avg Performance</p>
                <p className="text-2xl font-bold text-white">
                  {performanceData.length > 0
                    ? Math.round(performanceData.reduce((sum, g) => sum + g.performance_score, 0) / performanceData.length)
                    : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Incident Resolution by Guard */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Incident Resolution by Guard (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={incidentsByGuard}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Legend />
                <Bar dataKey="incidents" fill="#0ea5e9" name="Total Incidents" />
                <Bar dataKey="resolved" fill="#10b981" name="Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Performance Distribution */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Performance Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={performanceDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {performanceDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Performers */}
      <Card className="bg-gradient-to-r from-amber-500/10 to-amber-600/10 border-amber-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            Top Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topPerformers.map((guard, index) => (
              <div key={guard.guard_id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold">{index + 1}</span>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">{guard.guard_name}</h4>
                      <p className="text-xs text-slate-400">Performance Score: {Math.round(guard.performance_score)}%</p>
                    </div>
                  </div>
                  {getPerformanceBadge(guard.performance_score)}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Incidents Resolved</p>
                    <p className="text-white font-semibold">{guard.resolved_incidents}/{guard.total_incidents}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Attendance Rate</p>
                    <p className="text-white font-semibold">{Math.round(guard.attendance_rate)}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Stay Awake Rate</p>
                    <p className="text-white font-semibold">{Math.round(guard.stay_awake_rate)}%</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Avg Response</p>
                    <p className="text-white font-semibold">{Math.round(guard.avg_response_time)} min</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Detailed Guard List */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">All Guards Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 pb-3 font-medium">Guard</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Score</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Incidents</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Resolution</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Attendance</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Stay Awake</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Response</th>
                </tr>
              </thead>
              <tbody>
                {performanceData.map(guard => (
                  <tr key={guard.guard_id} className="border-b border-slate-700/50">
                    <td className="py-3 text-white">{guard.guard_name}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{Math.round(guard.performance_score)}%</span>
                        {getPerformanceBadge(guard.performance_score)}
                      </div>
                    </td>
                    <td className="py-3 text-slate-300">{guard.resolved_incidents}/{guard.total_incidents}</td>
                    <td className="py-3 text-slate-300">{Math.round(guard.resolution_rate)}%</td>
                    <td className="py-3 text-slate-300">{Math.round(guard.attendance_rate)}%</td>
                    <td className="py-3 text-slate-300">{Math.round(guard.stay_awake_rate)}%</td>
                    <td className="py-3 text-slate-300">{Math.round(guard.avg_response_time) || 'N/A'} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}