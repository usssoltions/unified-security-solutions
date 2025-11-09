import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wrench, Clock, CheckCircle2, AlertCircle, TrendingDown } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899'];

export default function MaintenanceAnalysis({ maintenanceRequests, sites }) {
  const categoryBreakdown = useMemo(() => {
    const categories = {};
    maintenanceRequests.forEach(req => {
      categories[req.category] = (categories[req.category] || 0) + 1;
    });
    
    return Object.entries(categories).map(([name, value]) => ({
      name: name.replace(/_/g, ' ').toUpperCase(),
      value
    })).sort((a, b) => b.value - a.value);
  }, [maintenanceRequests]);

  const statusBreakdown = useMemo(() => {
    const statuses = {
      reported: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0
    };
    
    maintenanceRequests.forEach(req => {
      statuses[req.status] = (statuses[req.status] || 0) + 1;
    });
    
    return Object.entries(statuses).map(([name, value]) => ({
      name: name.replace(/_/g, ' ').toUpperCase(),
      value
    }));
  }, [maintenanceRequests]);

  const urgencyBreakdown = useMemo(() => {
    const urgencies = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0
    };
    
    maintenanceRequests.forEach(req => {
      urgencies[req.urgency] = (urgencies[req.urgency] || 0) + 1;
    });
    
    return Object.entries(urgencies).map(([name, value]) => ({
      name: name.toUpperCase(),
      value,
      color: name === 'critical' ? '#ef4444' : name === 'high' ? '#f59e0b' : name === 'medium' ? '#0ea5e9' : '#10b981'
    }));
  }, [maintenanceRequests]);

  const monthlyTrend = useMemo(() => {
    const months = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = monthDate.toLocaleString('default', { month: 'short' });
      
      const monthRequests = maintenanceRequests.filter(req => {
        const reqDate = new Date(req.reported_at);
        return reqDate.getMonth() === monthDate.getMonth() && reqDate.getFullYear() === monthDate.getFullYear();
      });
      
      months.push({
        month: monthName,
        total: monthRequests.length,
        completed: monthRequests.filter(r => r.status === 'completed').length,
        pending: monthRequests.filter(r => r.status !== 'completed' && r.status !== 'cancelled').length
      });
    }
    
    return months;
  }, [maintenanceRequests]);

  const siteMaintenanceLoad = useMemo(() => {
    return sites.map(site => {
      const siteRequests = maintenanceRequests.filter(r => r.site_id === site.id);
      const pending = siteRequests.filter(r => r.status === 'reported' || r.status === 'assigned' || r.status === 'in_progress').length;
      const completed = siteRequests.filter(r => r.status === 'completed').length;
      const critical = siteRequests.filter(r => r.urgency === 'critical').length;
      
      return {
        site_name: site.name.substring(0, 20),
        total: siteRequests.length,
        pending,
        completed,
        critical
      };
    }).sort((a, b) => b.pending - a.pending).slice(0, 10);
  }, [sites, maintenanceRequests]);

  const avgCompletionTime = useMemo(() => {
    const completed = maintenanceRequests.filter(r => r.status === 'completed' && r.completed_at);
    if (completed.length === 0) return 0;
    
    const totalHours = completed.reduce((sum, req) => {
      const reported = new Date(req.reported_at);
      const completedDate = new Date(req.completed_at);
      const hours = (completedDate - reported) / (1000 * 60 * 60);
      return sum + hours;
    }, 0);
    
    return Math.round(totalHours / completed.length);
  }, [maintenanceRequests]);

  const pendingCount = maintenanceRequests.filter(r => r.status !== 'completed' && r.status !== 'cancelled').length;
  const completedCount = maintenanceRequests.filter(r => r.status === 'completed').length;
  const completionRate = maintenanceRequests.length > 0 ? (completedCount / maintenanceRequests.length) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                <Wrench className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Total Requests</p>
                <p className="text-2xl font-bold text-white">{maintenanceRequests.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-500/10 rounded-lg flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Pending</p>
                <p className="text-2xl font-bold text-white">{pendingCount}</p>
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
                <p className="text-xs text-slate-400">Completion Rate</p>
                <p className="text-2xl font-bold text-white">{Math.round(completionRate)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-500/10 rounded-lg flex items-center justify-center">
                <Clock className="w-5 h-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Avg Completion</p>
                <p className="text-2xl font-bold text-white">{avgCompletionTime}h</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Status Breakdown */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusBreakdown.map((entry, index) => (
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

        {/* Category Breakdown */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Requests by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" style={{ fontSize: '10px' }} angle={-45} textAnchor="end" height={100} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Bar dataKey="value" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Monthly Trend (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="month" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="#8b5cf6" name="Total" strokeWidth={2} />
                <Line type="monotone" dataKey="completed" stroke="#10b981" name="Completed" strokeWidth={2} />
                <Line type="monotone" dataKey="pending" stroke="#f59e0b" name="Pending" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Urgency Distribution */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Urgency Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={urgencyBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Bar dataKey="value">
                  {urgencyBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Sites with Highest Maintenance Load */}
      <Card className="bg-gradient-to-r from-amber-500/10 to-amber-600/10 border-amber-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingDown className="w-5 h-5 text-amber-400" />
            Sites with Highest Maintenance Load
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 pb-3 font-medium">Site</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Total</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Pending</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Completed</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Critical</th>
                </tr>
              </thead>
              <tbody>
                {siteMaintenanceLoad.map((site, index) => (
                  <tr key={index} className="border-b border-slate-700/50">
                    <td className="py-3 text-white">{site.site_name}</td>
                    <td className="py-3 text-slate-300">{site.total}</td>
                    <td className="py-3">
                      <Badge className={site.pending > 5 ? "bg-rose-500" : "bg-amber-500"}>
                        {site.pending}
                      </Badge>
                    </td>
                    <td className="py-3 text-emerald-400">{site.completed}</td>
                    <td className="py-3">
                      {site.critical > 0 ? (
                        <Badge className="bg-rose-500">{site.critical}</Badge>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
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