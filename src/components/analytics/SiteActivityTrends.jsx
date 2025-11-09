import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, AlertTriangle, Shield, TrendingUp, Activity } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";

export default function SiteActivityTrends({ sites, incidents, shifts, maintenanceRequests }) {
  const siteMetrics = useMemo(() => {
    return sites.map(site => {
      const siteIncidents = incidents.filter(i => i.site_id === site.id);
      const siteShifts = shifts.filter(s => s.site_id === site.id);
      const siteMaintenance = maintenanceRequests.filter(m => m.site_id === site.id);
      
      const criticalIncidents = siteIncidents.filter(i => i.priority === "critical").length;
      const highIncidents = siteIncidents.filter(i => i.priority === "high").length;
      const resolvedIncidents = siteIncidents.filter(i => i.status === "resolved" || i.status === "closed").length;
      
      const completedShifts = siteShifts.filter(s => s.status === "completed").length;
      const missedShifts = siteShifts.filter(s => s.status === "missed").length;
      
      const pendingMaintenance = siteMaintenance.filter(m => m.status === "reported" || m.status === "assigned").length;
      const completedMaintenance = siteMaintenance.filter(m => m.status === "completed").length;
      
      // Calculate activity score
      const activityScore = siteIncidents.length + (siteShifts.length * 0.5) + (siteMaintenance.length * 0.3);
      
      // Calculate risk score
      const riskScore = (criticalIncidents * 10) + (highIncidents * 5) + (pendingMaintenance * 3);

      return {
        site_id: site.id,
        site_name: site.name,
        client_name: site.client_name,
        total_incidents: siteIncidents.length,
        critical_incidents: criticalIncidents,
        high_incidents: highIncidents,
        resolved_incidents: resolvedIncidents,
        resolution_rate: siteIncidents.length > 0 ? (resolvedIncidents / siteIncidents.length) * 100 : 0,
        total_shifts: siteShifts.length,
        completed_shifts: completedShifts,
        missed_shifts: missedShifts,
        shift_completion_rate: siteShifts.length > 0 ? (completedShifts / siteShifts.length) * 100 : 0,
        total_maintenance: siteMaintenance.length,
        pending_maintenance: pendingMaintenance,
        completed_maintenance: completedMaintenance,
        activity_score: activityScore,
        risk_score: riskScore
      };
    }).sort((a, b) => b.activity_score - a.activity_score);
  }, [sites, incidents, shifts, maintenanceRequests]);

  const incidentTrends = useMemo(() => {
    // Group incidents by week for last 8 weeks
    const weeks = [];
    const now = new Date();
    
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i * 7 * 24 * 60 * 60 * 1000));
      const weekEnd = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000));
      
      const weekIncidents = incidents.filter(inc => {
        const incDate = new Date(inc.reported_at);
        return incDate >= weekStart && incDate < weekEnd;
      });
      
      weeks.push({
        week: `Week ${8 - i}`,
        incidents: weekIncidents.length,
        critical: weekIncidents.filter(i => i.priority === "critical").length,
        resolved: weekIncidents.filter(i => i.status === "resolved" || i.status === "closed").length
      });
    }
    
    return weeks;
  }, [incidents]);

  const topRiskSites = siteMetrics.slice(0, 5);
  const topActivitySites = useMemo(() => {
    return [...siteMetrics].sort((a, b) => b.activity_score - a.activity_score).slice(0, 5);
  }, [siteMetrics]);

  const incidentsBySite = siteMetrics.slice(0, 10).map(site => ({
    name: site.site_name.substring(0, 15),
    incidents: site.total_incidents,
    critical: site.critical_incidents,
    resolved: site.resolved_incidents
  }));

  const getRiskLevel = (score) => {
    if (score > 50) return { badge: <Badge className="bg-rose-500">High Risk</Badge>, color: "text-rose-400" };
    if (score > 20) return { badge: <Badge className="bg-amber-500">Medium Risk</Badge>, color: "text-amber-400" };
    return { badge: <Badge className="bg-emerald-500">Low Risk</Badge>, color: "text-emerald-400" };
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-500/10 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-sky-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Total Sites</p>
                <p className="text-2xl font-bold text-white">{sites.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-500/10 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Total Incidents</p>
                <p className="text-2xl font-bold text-white">{incidents.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-500/10 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Active Shifts</p>
                <p className="text-2xl font-bold text-white">
                  {shifts.filter(s => s.status === "active").length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-slate-400">Avg Activity Score</p>
                <p className="text-2xl font-bold text-white">
                  {siteMetrics.length > 0
                    ? Math.round(siteMetrics.reduce((sum, s) => sum + s.activity_score, 0) / siteMetrics.length)
                    : 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Incident Trends */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Incident Trends (Last 8 Weeks)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={incidentTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="week" stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Legend />
                <Area type="monotone" dataKey="incidents" stackId="1" stroke="#0ea5e9" fill="#0ea5e9" name="Total" />
                <Area type="monotone" dataKey="critical" stackId="2" stroke="#ef4444" fill="#ef4444" name="Critical" />
                <Area type="monotone" dataKey="resolved" stackId="3" stroke="#10b981" fill="#10b981" name="Resolved" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Incidents by Site */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Incidents by Site (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={incidentsBySite}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" style={{ fontSize: '11px' }} angle={-45} textAnchor="end" height={80} />
                <YAxis stroke="#94a3b8" style={{ fontSize: '12px' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                  labelStyle={{ color: '#f1f5f9' }}
                />
                <Legend />
                <Bar dataKey="incidents" fill="#0ea5e9" name="Total" />
                <Bar dataKey="critical" fill="#ef4444" name="Critical" />
                <Bar dataKey="resolved" fill="#10b981" name="Resolved" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* High Risk Sites */}
      <Card className="bg-gradient-to-r from-rose-500/10 to-rose-600/10 border-rose-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            High Risk Sites
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topRiskSites.map(site => {
              const risk = getRiskLevel(site.risk_score);
              return (
                <div key={site.site_id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-white">{site.site_name}</h4>
                      <p className="text-xs text-slate-400">{site.client_name}</p>
                    </div>
                    {risk.badge}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400 text-xs">Total Incidents</p>
                      <p className={`${risk.color} font-semibold`}>{site.total_incidents}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Critical</p>
                      <p className="text-rose-400 font-semibold">{site.critical_incidents}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Resolution Rate</p>
                      <p className="text-white font-semibold">{Math.round(site.resolution_rate)}%</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Pending Maintenance</p>
                      <p className="text-amber-400 font-semibold">{site.pending_maintenance}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Risk Score</p>
                      <p className={`${risk.color} font-semibold`}>{Math.round(site.risk_score)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Most Active Sites */}
      <Card className="bg-gradient-to-r from-violet-500/10 to-violet-600/10 border-violet-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-violet-400" />
            Most Active Sites
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {topActivitySites.map((site, index) => (
              <div key={site.site_id} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-violet-400 to-violet-600 rounded-full flex items-center justify-center">
                      <span className="text-white font-bold text-sm">{index + 1}</span>
                    </div>
                    <div>
                      <h4 className="font-semibold text-white">{site.site_name}</h4>
                      <p className="text-xs text-slate-400">{site.client_name}</p>
                    </div>
                  </div>
                  <Badge className="bg-violet-500">Score: {Math.round(site.activity_score)}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-400 text-xs">Shifts</p>
                    <p className="text-white font-semibold">{site.completed_shifts}/{site.total_shifts}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Incidents</p>
                    <p className="text-white font-semibold">{site.total_incidents}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs">Maintenance</p>
                    <p className="text-white font-semibold">{site.total_maintenance}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* All Sites Table */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">All Sites Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 pb-3 font-medium">Site</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Incidents</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Resolution</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Shifts</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Maintenance</th>
                  <th className="text-left text-slate-400 pb-3 font-medium">Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {siteMetrics.map(site => {
                  const risk = getRiskLevel(site.risk_score);
                  return (
                    <tr key={site.site_id} className="border-b border-slate-700/50">
                      <td className="py-3">
                        <div>
                          <p className="text-white font-medium">{site.site_name}</p>
                          <p className="text-xs text-slate-400">{site.client_name}</p>
                        </div>
                      </td>
                      <td className="py-3 text-slate-300">
                        {site.total_incidents} ({site.critical_incidents} critical)
                      </td>
                      <td className="py-3 text-slate-300">{Math.round(site.resolution_rate)}%</td>
                      <td className="py-3 text-slate-300">
                        {site.completed_shifts}/{site.total_shifts}
                      </td>
                      <td className="py-3 text-slate-300">
                        {site.pending_maintenance} pending
                      </td>
                      <td className="py-3">{risk.badge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}