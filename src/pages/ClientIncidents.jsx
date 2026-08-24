import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Search, Loader2, MapPin, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import moment from "moment";

export default function ClientIncidents() {
  const [user, setUser] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }
      const [sites, incs] = await Promise.all([
        base44.entities.Site.filter({ customer_id: cid }).catch(() => []),
        base44.entities.Incident.filter({}).catch(() => []),
      ]);
      const siteIds = new Set(sites.map(s => s.id));
      setIncidents(incs.filter(i => siteIds.has(i.site_id)));
    } catch (e) {
      console.error("ClientIncidents error:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = incidents.filter(i => {
    if (filterStatus !== "all" && i.status !== filterStatus) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (i.title || "").toLowerCase().includes(q) || (i.site_name || "").toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q);
  });

  const statusColors = {
    reported: "bg-amber-500/20 text-amber-400",
    assigned: "bg-sky-500/20 text-sky-400",
    accepted: "bg-indigo-500/20 text-indigo-400",
    in_progress: "bg-violet-500/20 text-violet-400",
    resolved: "bg-emerald-500/20 text-emerald-400",
    closed: "bg-slate-500/20 text-slate-400",
    declined: "bg-rose-500/20 text-rose-400",
  };

  const priorityColors = {
    critical: "bg-rose-500/20 text-rose-400",
    high: "bg-amber-500/20 text-amber-400",
    medium: "bg-sky-500/20 text-sky-400",
    low: "bg-slate-500/20 text-slate-400",
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Incidents</h1>
            <p className="text-slate-400 text-sm">{incidents.length} incidents at your sites</p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input placeholder="Search incidents..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-slate-900 border-slate-700 text-white" />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {["all", "reported", "assigned", "in_progress", "resolved", "closed"].map(t => (
            <button key={t} onClick={() => setFilterStatus(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filterStatus === t ? "bg-sky-500 text-white" : "bg-slate-900 text-slate-400"}`}>
              {t.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <AlertTriangle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No incidents found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(i => (
              <Card key={i.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm">{i.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span className="text-slate-400 text-xs">{i.site_name}</span>
                        <Clock className="w-3 h-3 text-slate-400 ml-1" />
                        <span className="text-slate-400 text-xs">{moment(i.reported_at || i.created_date).fromNow()}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Badge className={`text-xs ${priorityColors[i.priority] || priorityColors.medium}`}>{i.priority}</Badge>
                      <Badge className={`text-xs ${statusColors[i.status] || statusColors.reported}`}>{(i.status || "").replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  {i.description && <p className="text-slate-500 text-xs mt-2 line-clamp-2">{i.description}</p>}
                  {i.resolution_notes && i.status === "resolved" && (
                    <div className="mt-2 p-2 bg-emerald-500/10 rounded-lg">
                      <p className="text-emerald-400 text-xs">Resolution: {i.resolution_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}