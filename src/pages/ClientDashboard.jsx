import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Shield, AlertTriangle, FileText, MapPin, Loader2, TrendingUp, Clock } from "lucide-react";
import { useModuleEntitlements, isModuleEnabled } from "@/hooks/useModuleEntitlements";
import moment from "moment";

export default function ClientDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ sites: 0, openIncidents: 0, resolvedIncidents: 0, recentAccess: 0, reports: 0 });
  const [recentIncidents, setRecentIncidents] = useState([]);
  const [recentAccess, setRecentAccess] = useState([]);
  const [recentReports, setRecentReports] = useState([]);
  const { data: entitlements = [] } = useModuleEntitlements(user?.id, user?.customer_id);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }

      const [sites, incidents, accessLogs, reports] = await Promise.all([
        base44.entities.Site.filter({ customer_id: cid, status: "active" }).catch(() => []),
        base44.entities.Incident.filter({}).catch(() => []),
        base44.entities.AccessLog.filter({}).catch(() => []),
        base44.entities.GeneratedReport.filter({}).catch(() => []),
      ]);

      const siteIds = new Set(sites.map(s => s.id));
      const myIncidents = incidents.filter(i => siteIds.has(i.site_id));
      const myAccess = accessLogs.filter(a => siteIds.has(a.site_id) || a.customer_id === cid);
      const myReports = reports.filter(r => r.customer_id === cid);

      setStats({
        sites: sites.length,
        openIncidents: myIncidents.filter(i => !["resolved", "closed"].includes(i.status)).length,
        resolvedIncidents: myIncidents.filter(i => ["resolved", "closed"].includes(i.status)).length,
        recentAccess: myAccess.filter(a => moment(a.timestamp).isAfter(moment().subtract(24, "hours"))).length,
        reports: myReports.length,
      });

      setRecentIncidents(myIncidents.slice(0, 5));
      setRecentAccess(myAccess.slice(0, 5));
      setRecentReports(myReports.slice(0, 5));
    } catch (e) {
      console.error("ClientDashboard error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  const hasAccess = isModuleEnabled(entitlements, "ACCESS", false);
  const hasPatrol = isModuleEnabled(entitlements, "PATROL", false);
  const hasReporting = isModuleEnabled(entitlements, "REPORTING_CORE", false);

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm">{user?.display_name || user?.full_name}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-sky-400" />
                <p className="text-slate-400 text-xs">Sites</p>
              </div>
              <p className="text-2xl font-bold text-white">{stats.sites}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <p className="text-slate-400 text-xs">Open Incidents</p>
              </div>
              <p className="text-2xl font-bold text-white">{stats.openIncidents}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Shield className="w-4 h-4 text-emerald-400" />
                <p className="text-slate-400 text-xs">Resolved</p>
              </div>
              <p className="text-2xl font-bold text-white">{stats.resolvedIncidents}</p>
            </CardContent>
          </Card>
          {hasReporting && (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-violet-400" />
                  <p className="text-slate-400 text-xs">Reports</p>
                </div>
                <p className="text-2xl font-bold text-white">{stats.reports}</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <h3 className="text-white font-medium text-sm mb-3">Recent Incidents</h3>
              {recentIncidents.length === 0 ? (
                <p className="text-slate-500 text-sm py-4 text-center">No incidents</p>
              ) : (
                <div className="space-y-2">
                  {recentIncidents.map(i => (
                    <div key={i.id} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                      <div className="min-w-0">
                        <p className="text-white text-sm truncate">{i.title}</p>
                        <p className="text-slate-400 text-xs">{i.site_name} • {moment(i.reported_at || i.created_date).fromNow()}</p>
                      </div>
                      <Badge className={`text-xs shrink-0 ml-2 ${
                        i.priority === "critical" ? "bg-rose-500/20 text-rose-400" :
                        i.priority === "high" ? "bg-amber-500/20 text-amber-400" :
                        "bg-slate-500/20 text-slate-400"
                      }`}>{i.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {hasAccess && (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <h3 className="text-white font-medium text-sm mb-3">Recent Access Activity</h3>
                {recentAccess.length === 0 ? (
                  <p className="text-slate-500 text-sm py-4 text-center">No recent access</p>
                ) : (
                  <div className="space-y-2">
                    {recentAccess.map(a => (
                      <div key={a.id} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                        <div className="min-w-0">
                          <p className="text-white text-sm truncate">{a.person_name || "Unknown"}</p>
                          <p className="text-slate-400 text-xs">{a.gate_name} • {moment(a.timestamp).fromNow()}</p>
                        </div>
                        <Badge className={`text-xs shrink-0 ml-2 ${
                          a.status === "inside" ? "bg-emerald-500/20 text-emerald-400" :
                          a.status === "exited" ? "bg-sky-500/20 text-sky-400" :
                          a.status === "denied" ? "bg-rose-500/20 text-rose-400" :
                          "bg-slate-500/20 text-slate-400"
                        }`}>{a.status}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {hasReporting && (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4">
                <h3 className="text-white font-medium text-sm mb-3">Recent Reports</h3>
                {recentReports.length === 0 ? (
                  <p className="text-slate-500 text-sm py-4 text-center">No reports available</p>
                ) : (
                  <div className="space-y-2">
                    {recentReports.map(r => (
                      <div key={r.id} className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                        <div className="min-w-0">
                          <p className="text-white text-sm truncate">{r.title || r.report_type || "Report"}</p>
                          <p className="text-slate-400 text-xs">{moment(r.created_date).fromNow()}</p>
                        </div>
                        {r.file_url && <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 text-xs shrink-0 ml-2">View</a>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}