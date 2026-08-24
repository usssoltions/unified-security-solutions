import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, Search, Loader2, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import moment from "moment";

export default function ClientReports() {
  const [user, setUser] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }
      const all = await base44.entities.GeneratedReport.filter({}).catch(() => []);
      setReports(all.filter(r => r.customer_id === cid));
    } catch (e) {
      console.error("ClientReports error:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = reports.filter(r => {
    if (filterType !== "all" && r.report_type !== filterType) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (r.title || "").toLowerCase().includes(q) || (r.report_type || "").toLowerCase().includes(q);
  });

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-slate-400 text-sm">{reports.length} reports available</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input placeholder="Search reports..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-900 border-slate-700 text-white" />
          </div>
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {["all", "daily_access", "incident", "maintenance", "patrol", "shift"].map(t => (
            <button key={t} onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filterType === t ? "bg-sky-500 text-white" : "bg-slate-900 text-slate-400"}`}>
              {t.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No reports found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => (
              <Card key={r.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm">{r.title || r.report_type || "Report"}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{moment(r.created_date).format("MMM D, YYYY [at] HH:mm")}</p>
                      {r.summary && <p className="text-slate-500 text-xs mt-1 line-clamp-2">{r.summary}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className="text-xs bg-slate-700 text-slate-300">{r.report_type || "report"}</Badge>
                      {r.file_url && (
                        <a href={r.file_url} target="_blank" rel="noopener noreferrer"
                          className="w-9 h-9 bg-sky-500/20 rounded-lg flex items-center justify-center text-sky-400 hover:bg-sky-500/30 transition">
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}