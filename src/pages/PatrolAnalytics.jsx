import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Shield, TrendingUp, CheckCircle2, XCircle, Clock, BarChart3 } from "lucide-react";

const COLORS = ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

export default function PatrolAnalytics() {
  const [period, setPeriod] = useState("30");

  const { data: patrols = [] } = useQuery({
    queryKey: ["patrolAnalytics", period],
    queryFn: async () => {
      const all = await base44.entities.ScheduledPatrol.list("-scheduled_start", 2000);
      const from = new Date(); from.setDate(from.getDate() - parseInt(period)); from.setHours(0,0,0,0);
      return all.filter(p => new Date(p.scheduled_start) >= from);
    },
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => base44.entities.Site.list(),
  });

  const total = patrols.length;
  const completed = patrols.filter(p => p.status === "completed").length;
  const missed = patrols.filter(p => p.status === "missed" || p.status === "failed").length;
  const overdue = patrols.filter(p => p.status === "overdue").length;
  const complianceRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  const avgScore = patrols.filter(p => p.completion_score != null).length > 0
    ? Math.round(patrols.filter(p => p.completion_score != null).reduce((s, p) => s + p.completion_score, 0) / patrols.filter(p => p.completion_score != null).length)
    : 0;

  const avgDuration = patrols.filter(p => p.actual_start && p.actual_end).length > 0
    ? Math.round(patrols.filter(p => p.actual_start && p.actual_end).reduce((s, p) => {
        return s + (new Date(p.actual_end) - new Date(p.actual_start)) / 60000;
      }, 0) / patrols.filter(p => p.actual_start && p.actual_end).length)
    : 0;

  // By status
  const statusData = [
    { name: "Completed", value: completed },
    { name: "Missed",    value: missed },
    { name: "Overdue",   value: overdue },
    { name: "Active",    value: patrols.filter(p => p.status === "active").length },
    { name: "Upcoming",  value: patrols.filter(p => p.status === "upcoming").length },
  ].filter(d => d.value > 0);

  // By site
  const bySite = sites.map(s => ({
    name: s.name.length > 12 ? s.name.substring(0, 12) + "…" : s.name,
    completed: patrols.filter(p => p.site_id === s.id && p.status === "completed").length,
    missed:    patrols.filter(p => p.site_id === s.id && (p.status === "missed" || p.status === "failed")).length,
  })).filter(s => s.completed + s.missed > 0);

  // By day (last 14 days)
  const byDay = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i)); d.setHours(0,0,0,0);
    const dEnd = new Date(d); dEnd.setHours(23,59,59,999);
    const day = patrols.filter(p => {
      const pd = new Date(p.scheduled_start);
      return pd >= d && pd <= dEnd;
    });
    return {
      date: d.toLocaleDateString("en-ZA", { day: "2-digit", month: "2-digit" }),
      completed: day.filter(p => p.status === "completed").length,
      missed:    day.filter(p => p.status === "missed" || p.status === "failed").length,
    };
  });

  // Guard compliance
  const guardMap = {};
  patrols.forEach(p => {
    if (!p.guard_name) return;
    if (!guardMap[p.guard_name]) guardMap[p.guard_name] = { name: p.guard_name, total: 0, completed: 0 };
    guardMap[p.guard_name].total++;
    if (p.status === "completed") guardMap[p.guard_name].completed++;
  });
  const guardData = Object.values(guardMap)
    .map(g => ({ ...g, rate: Math.round((g.completed / g.total) * 100) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 10);

  return (
    <div className="min-h-screen p-4 lg:p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-7 h-7 text-sky-400" /> Patrol Analytics
            </h1>
            <p className="text-slate-400 text-sm">Compliance, trends & performance</p>
          </div>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-40 bg-slate-800 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Patrols",   value: total,            color: "border-slate-500",   icon: Shield },
            { label: "Compliance %",    value: `${complianceRate}%`, color: complianceRate >= 90 ? "border-emerald-500" : complianceRate >= 70 ? "border-amber-500" : "border-rose-500", icon: TrendingUp },
            { label: "Missed",          value: missed,           color: "border-rose-500",    icon: XCircle },
            { label: "Avg Score",       value: `${avgScore}%`,   color: "border-sky-500",     icon: CheckCircle2 },
          ].map(({ label, value, color, icon: Icon }) => (
            <Card key={label} className={`bg-slate-800 border-slate-700 border-l-4 ${color}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className="w-7 h-7 text-slate-400 flex-shrink-0" />
                <div>
                  <p className="text-slate-400 text-xs">{label}</p>
                  <p className="text-2xl font-bold text-white">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid md:grid-cols-2 gap-5">

          {/* Daily trend */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white text-base">Daily Compliance (14 Days)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byDay} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "none", borderRadius: 8, color: "#fff" }} />
                  <Bar dataKey="completed" fill="#10b981" radius={[3,3,0,0]} name="Completed" />
                  <Bar dataKey="missed"    fill="#ef4444" radius={[3,3,0,0]} name="Missed" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Status pie */}
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white text-base">Status Breakdown</CardTitle></CardHeader>
            <CardContent>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#1e293b", border: "none", borderRadius: 8, color: "#fff" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-48 text-slate-500">No data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* By Site */}
        {bySite.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white text-base">Compliance by Site</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bySite} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#1e293b", border: "none", borderRadius: 8, color: "#fff" }} />
                  <Legend />
                  <Bar dataKey="completed" fill="#10b981" radius={[3,3,0,0]} name="Completed" />
                  <Bar dataKey="missed"    fill="#ef4444" radius={[3,3,0,0]} name="Missed" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Guard performance */}
        {guardData.length > 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader><CardTitle className="text-white text-base">Guard Patrol Compliance</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {guardData.map(g => (
                  <div key={g.name} className="flex items-center gap-3">
                    <p className="text-slate-300 text-sm w-40 truncate">{g.name}</p>
                    <div className="flex-1 h-2.5 bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${g.rate >= 90 ? "bg-emerald-500" : g.rate >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${g.rate}%` }} />
                    </div>
                    <p className={`text-sm font-bold w-12 text-right ${g.rate >= 90 ? "text-emerald-400" : g.rate >= 70 ? "text-amber-400" : "text-rose-400"}`}>
                      {g.rate}%
                    </p>
                    <p className="text-slate-500 text-xs w-20">{g.completed}/{g.total}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}