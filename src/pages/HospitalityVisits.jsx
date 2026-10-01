import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { FileDown, FileSpreadsheet, Hotel, Loader2 } from "lucide-react";
import { listSites } from "@/lib/siteApi";
import { presenceOf, computeTotals, PRESENCE_LABELS, HOSP_CATEGORY_LABELS } from "@/lib/hospitalityMeta";
import { exportVisitsCsv, exportVisitsPdf } from "@/lib/hospitalityExport";
import VisitFilters from "@/components/hospitality/VisitFilters";
import VisitCard from "@/components/hospitality/VisitCard";
import VisitDetailDialog from "@/components/hospitality/VisitDetailDialog";
import CancelVisitDialog from "@/components/hospitality/CancelVisitDialog";

const TABS = [["all", "All"], ["pending", "Pending"], ["on_site", "On site"], ["exited", "Exited"], ["cancelled", "Cancelled"]];
const dayStr = (d) => d.toLocaleDateString("en-CA");

export default function HospitalityVisits() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState(() => ({ from: dayStr(new Date(Date.now() - 6 * 864e5)), to: dayStr(new Date()), site_id: "", category: "" }));
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [exporting, setExporting] = useState(false);

  const { data: sites = [] } = useQuery({
    queryKey: ["hosp_sites"],
    queryFn: async () => ((await listSites({}))?.sites || []).filter((s) => s.access_workflow === "grid_gate_hospitality"),
  });

  const queryKey = ["hosp_visits", filters];
  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await base44.functions.invoke("finalizeAccessEntry", { action: "hospitality_list", access_data: {
        site_id: filters.site_id || undefined, category: filters.category || undefined, limit: 1000,
        date_from: filters.from ? new Date(`${filters.from}T00:00:00`).toISOString() : undefined,
        date_to: filters.to ? new Date(`${filters.to}T23:59:59`).toISOString() : undefined,
      } });
      return res.data;
    },
  });
  const all = data?.visits || [];
  const counts = useMemo(() => computeTotals(all).byPresence, [all]);
  const shown = tab === "all" ? all : all.filter((v) => presenceOf(v) === tab);

  const fileBase = `hospitality-visits_${filters.from}_${filters.to}`;
  const summary = [
    `${filters.from} to ${filters.to}`,
    filters.site_id ? sites.find((s) => s.id === filters.site_id)?.name : "All hospitality sites",
    filters.category ? HOSP_CATEGORY_LABELS[filters.category] : "All categories",
    tab !== "all" ? PRESENCE_LABELS[tab] : "All statuses",
  ].join(" · ");

  const doPdf = async () => {
    setExporting(true);
    try {
      const res = await base44.functions.invoke("finalizeAccessEntry", { action: "hospitality_report_brand", access_data: { site_id: filters.site_id || sites[0]?.id } });
      exportVisitsPdf(shown, res.data, summary, fileBase);
    } finally { setExporting(false); }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center"><Hotel className="w-5 h-5 text-sky-400" /></div>
          <div>
            <h1 className="text-white text-xl font-bold">Hospitality Visits</h1>
            <p className="text-slate-400 text-xs">GRID GATE admission decisions and current presence</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => exportVisitsCsv(shown, fileBase)} disabled={!shown.length} variant="outline" className="h-10 border-slate-600 text-slate-200 active:scale-95 transition-transform">
            <FileSpreadsheet className="w-4 h-4 mr-2" /> CSV / Excel
          </Button>
          <Button onClick={doPdf} disabled={!shown.length || exporting} className="h-10 bg-sky-600 hover:bg-sky-700 active:scale-95 transition-transform">
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />} PDF
          </Button>
        </div>
      </div>

      <VisitFilters filters={filters} onChange={setFilters} sites={sites} />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`shrink-0 h-9 px-3 rounded-lg text-sm font-medium border transition-all active:scale-95 ${tab === k ? "bg-sky-500/20 border-sky-500/40 text-sky-300" : "bg-slate-900 border-slate-700 text-slate-400"}`}>
            {l} <span className="text-xs opacity-70">{k === "all" ? all.length : counts[k] || 0}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-sky-400 animate-spin" /></div>
      ) : error ? (
        <p className="text-rose-400 text-sm">{error?.response?.data?.error || "Visits could not be loaded."}</p>
      ) : shown.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-12">No hospitality visits match these filters.</p>
      ) : (
        <div className="space-y-2">
          {data?.truncated && <p className="text-amber-300 text-xs">Showing the most recent 1000 visits — narrow the date range for complete totals.</p>}
          {shown.map((v) => <VisitCard key={v.id} visit={v} onOpen={setOpen} />)}
        </div>
      )}

      <VisitDetailDialog visit={open} onClose={() => setOpen(null)} onCancel={(v) => { setOpen(null); setCancelling(v); }} />
      {cancelling && (
        <CancelVisitDialog visit={cancelling} open={!!cancelling} onClose={() => setCancelling(null)}
          onCancelled={() => { setCancelling(null); qc.invalidateQueries({ queryKey: ["hosp_visits"] }); }} />
      )}
    </div>
  );
}