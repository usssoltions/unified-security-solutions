import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield, MapPin, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  BarChart3, User, Navigation, Zap, Calendar, Filter, Eye, Bell, TrendingUp
} from "lucide-react";

const STATUS_CONFIG = {
  upcoming:  { color: "bg-slate-600", text: "Upcoming",  dot: "bg-slate-400" },
  due:       { color: "bg-amber-600",  text: "Due",       dot: "bg-amber-400" },
  active:    { color: "bg-emerald-600",text: "Active",    dot: "bg-emerald-400 animate-pulse" },
  completed: { color: "bg-sky-600",    text: "Completed", dot: "bg-sky-400" },
  missed:    { color: "bg-rose-700",   text: "Missed",    dot: "bg-rose-400" },
  overdue:   { color: "bg-orange-600", text: "Overdue",   dot: "bg-orange-400 animate-pulse" },
  failed:    { color: "bg-rose-800",   text: "Failed",    dot: "bg-rose-600" },
};

function StatCard({ label, value, color, icon: Icon }) { // eslint-disable-line
  return (
    <Card className={`bg-slate-800 border-slate-700 border-l-4 ${color}`}>
      <CardContent className="p-4 flex items-center gap-3">
        <Icon className="w-8 h-8 opacity-70 text-white" />
        <div>
          <p className="text-slate-400 text-xs">{label}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PatrolDashboard() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [filterSite, setFilterSite] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterGuard, setFilterGuard] = useState("");
  const queryClient = useQueryClient();

  const { data: patrols = [], isLoading } = useQuery({
    queryKey: ["scheduledPatrols", selectedDate],
    queryFn: async () => {
      const all = await base44.entities.ScheduledPatrol.list("-scheduled_start", 500);
      const start = new Date(selectedDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(selectedDate); end.setHours(23, 59, 59, 999);
      return all.filter(p => {
        const d = new Date(p.scheduled_start);
        return d >= start && d <= end;
      });
    },
    refetchInterval: 30000,
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => base44.entities.Site.list(),
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const u = await base44.entities.User.list();
      return u.filter(x => x.role_type === "guard");
    },
  });

  const markMissedMutation = useMutation({
    mutationFn: async (patrolId) => {
      await base44.entities.ScheduledPatrol.update(patrolId, { status: "missed" });
    },
    onSuccess: () => queryClient.invalidateQueries(["scheduledPatrols"]),
  });

  // Auto-update overdue statuses
  useEffect(() => {
    const now = new Date();
    patrols.forEach(p => {
      if (p.status === "upcoming" || p.status === "due") {
        const scheduled = new Date(p.scheduled_start);
        const minsLate = (now - scheduled) / 60000;
        if (minsLate > 15 && p.status !== "overdue") {
          base44.entities.ScheduledPatrol.update(p.id, { status: "overdue" }).catch(() => {});
        }
      }
    });
  }, [patrols]);

  let filtered = patrols;
  if (filterSite)   filtered = filtered.filter(p => p.site_id === filterSite);
  if (filterStatus) filtered = filtered.filter(p => p.status === filterStatus);
  if (filterGuard)  filtered = filtered.filter(p => p.guard_id === filterGuard);

  const stats = {
    upcoming:  patrols.filter(p => p.status === "upcoming").length,
    active:    patrols.filter(p => p.status === "active").length,
    completed: patrols.filter(p => p.status === "completed").length,
    missed:    patrols.filter(p => p.status === "missed" || p.status === "failed").length,
    overdue:   patrols.filter(p => p.status === "overdue" || p.status === "due").length,
    total:     patrols.length,
  };

  const complianceRate = stats.total > 0
    ? Math.round((stats.completed / stats.total) * 100)
    : 0;

  return (
    <div className="min-h-screen p-4 lg:p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shield className="w-7 h-7 text-sky-400" /> AI Patrol Dashboard
            </h1>
            <p className="text-slate-400 text-sm mt-1">Real-time patrol monitoring & compliance</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => queryClient.invalidateQueries(["scheduledPatrols"])}
              variant="outline" size="sm" className="border-slate-600 text-slate-300">
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
            <Input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white w-40" />
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total"     value={stats.total}     color="border-slate-500"   icon={BarChart3} />
          <StatCard label="Upcoming"  value={stats.upcoming}  color="border-slate-500"   icon={Clock} />
          <StatCard label="Active"    value={stats.active}    color="border-emerald-500" icon={Navigation} />
          <StatCard label="Completed" value={stats.completed} color="border-sky-500"     icon={CheckCircle2} />
          <StatCard label="Overdue"   value={stats.overdue}   color="border-amber-500"   icon={AlertTriangle} />
          <StatCard label="Missed"    value={stats.missed}    color="border-rose-500"    icon={XCircle} />
        </div>

        {/* Compliance Banner */}
        <Card className={`border ${complianceRate >= 90 ? "bg-emerald-900/30 border-emerald-600" : complianceRate >= 70 ? "bg-amber-900/30 border-amber-600" : "bg-rose-900/30 border-rose-600"}`}>
          <CardContent className="p-4 flex items-center gap-4">
            <TrendingUp className="w-8 h-8 text-white" />
            <div>
              <p className="text-white font-bold text-lg">Today's Compliance: {complianceRate}%</p>
              <p className="text-slate-300 text-sm">{stats.completed} of {stats.total} patrols completed</p>
            </div>
            <div className="ml-auto">
              <div className="w-32 h-3 bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${complianceRate >= 90 ? "bg-emerald-400" : complianceRate >= 70 ? "bg-amber-400" : "bg-rose-400"}`}
                  style={{ width: `${complianceRate}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Select value={filterSite} onValueChange={setFilterSite}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="All Sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Sites</SelectItem>
                  {sites.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Statuses</SelectItem>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) =>
                    <SelectItem key={k} value={k}>{v.text}</SelectItem>)}
                </SelectContent>
              </Select>

              <Select value={filterGuard} onValueChange={setFilterGuard}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="All Guards" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Guards</SelectItem>
                  {guards.map(g => <SelectItem key={g.id} value={g.id}>{g.full_name}</SelectItem>)}
                </SelectContent>
              </Select>

              <Button variant="outline" className="border-slate-600 text-slate-300"
                onClick={() => { setFilterSite(""); setFilterStatus(""); setFilterGuard(""); }}>
                <Filter className="w-4 h-4 mr-1" /> Clear
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Patrol Cards */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-12 text-slate-400">Loading patrols...</div>
          ) : filtered.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="py-12 text-center">
                <Shield className="w-12 h-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400">No patrols found for this date / filter</p>
              </CardContent>
            </Card>
          ) : (
            filtered.map(patrol => {
              const cfg = STATUS_CONFIG[patrol.status] || STATUS_CONFIG.upcoming;
              const progress = patrol.checkpoints_total > 0
                ? Math.round((patrol.checkpoints_completed / patrol.checkpoints_total) * 100)
                : 0;
              return (
                <Card key={patrol.id} className={`bg-slate-800 border-slate-700 ${patrol.status === "overdue" || patrol.status === "missed" ? "border-rose-600/50" : patrol.status === "active" ? "border-emerald-600/50" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex flex-col md:flex-row md:items-center gap-4">
                      {/* Status + Info */}
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`w-3 h-3 rounded-full mt-1.5 ${cfg.dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-semibold">{patrol.site_name}</span>
                            <Badge className={cfg.color + " text-white text-xs"}>{cfg.text}</Badge>
                            {patrol.ai_route_generated && <Badge className="bg-purple-700 text-xs">AI Route</Badge>}
                          </div>
                          <div className="flex items-center gap-4 mt-1 text-xs text-slate-400 flex-wrap">
                            <span className="flex items-center gap-1"><User className="w-3 h-3" />{patrol.guard_name || "Unassigned"}</span>
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(patrol.scheduled_start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />Patrol #{patrol.patrol_number}</span>
                          </div>
                          {/* Progress bar */}
                          {patrol.checkpoints_total > 0 && (
                            <div className="mt-2">
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Checkpoints: {patrol.checkpoints_completed}/{patrol.checkpoints_total}</span>
                                <span>{progress}%</span>
                              </div>
                              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all"
                                  style={{ width: `${progress}%` }} />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 flex-shrink-0">
                        {(patrol.status === "overdue" || patrol.status === "due") && (
                          <Button size="sm" variant="outline" className="border-rose-600 text-rose-400 text-xs"
                            onClick={() => markMissedMutation.mutate(patrol.id)}>
                            Mark Missed
                          </Button>
                        )}
                        {patrol.completion_score !== undefined && patrol.completion_score !== null && (
                          <div className="flex items-center gap-1 px-2 py-1 bg-slate-700 rounded text-xs text-slate-300">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Score: {patrol.completion_score}%
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}