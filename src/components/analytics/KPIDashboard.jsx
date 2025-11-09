import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { AlertTriangle, Shield, CheckCircle2, Clock, TrendingUp, TrendingDown } from "lucide-react";

export default function KPIDashboard({ incidents, shifts, checklists, stayAwakeLogs, dateRange }) {
  const calculateMetrics = () => {
    const completedShifts = shifts.filter(s => s.status === "completed").length;
    const missedShifts = shifts.filter(s => s.status === "missed").length;
    const totalIncidents = incidents.length;
    const criticalIncidents = incidents.filter(i => i.priority === "critical").length;
    const checklistCompletionRate = checklists.length > 0 
      ? (checklists.filter(c => c.status === "completed").length / checklists.length * 100).toFixed(1)
      : 0;
    const stayAwakeCompliance = stayAwakeLogs.length > 0
      ? (stayAwakeLogs.filter(l => l.status === "acknowledged").length / stayAwakeLogs.length * 100).toFixed(1)
      : 0;

    return {
      completedShifts,
      missedShifts,
      totalIncidents,
      criticalIncidents,
      checklistCompletionRate,
      stayAwakeCompliance
    };
  };

  const metrics = calculateMetrics();

  const incidentsByCategory = incidents.reduce((acc, inc) => {
    acc[inc.category] = (acc[inc.category] || 0) + 1;
    return acc;
  }, {});

  const categoryData = Object.entries(incidentsByCategory).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    value
  }));

  const COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];

  const kpiCards = [
    {
      title: "Total Shifts",
      value: shifts.length,
      subtitle: `${metrics.completedShifts} completed`,
      icon: Shield,
      color: "from-sky-400 to-sky-600",
      trend: "+12%"
    },
    {
      title: "Incidents Reported",
      value: metrics.totalIncidents,
      subtitle: `${metrics.criticalIncidents} critical`,
      icon: AlertTriangle,
      color: "from-rose-400 to-rose-600",
      trend: "-5%"
    },
    {
      title: "Checklist Completion",
      value: `${metrics.checklistCompletionRate}%`,
      subtitle: `${checklists.length} checklists`,
      icon: CheckCircle2,
      color: "from-emerald-400 to-emerald-600",
      trend: "+8%"
    },
    {
      title: "Stay Awake Compliance",
      value: `${metrics.stayAwakeCompliance}%`,
      subtitle: `${stayAwakeLogs.length} checks`,
      icon: Clock,
      color: "from-purple-400 to-purple-600",
      trend: "+3%"
    }
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpiCards.map((kpi, index) => {
          const Icon = kpi.icon;
          const isPositive = kpi.trend.startsWith('+');
          
          return (
            <Card key={index} className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 bg-gradient-to-br ${kpi.color} rounded-lg flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <div className={`flex items-center gap-1 text-sm font-semibold ${
                    isPositive ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {kpi.trend}
                  </div>
                </div>
                <h3 className="text-3xl font-bold text-white mb-1">{kpi.value}</h3>
                <p className="text-sm text-slate-400">{kpi.title}</p>
                <p className="text-xs text-slate-500 mt-1">{kpi.subtitle}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Incidents by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Shift Completion Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[
                { name: 'Week 1', completed: 45, missed: 2 },
                { name: 'Week 2', completed: 52, missed: 1 },
                { name: 'Week 3', completed: 48, missed: 3 },
                { name: 'Week 4', completed: 55, missed: 0 }
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} />
                <Legend />
                <Bar dataKey="completed" fill="#10b981" />
                <Bar dataKey="missed" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}