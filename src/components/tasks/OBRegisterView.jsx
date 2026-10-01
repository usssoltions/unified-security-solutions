import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { BookOpen, Download, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { OB_OUTCOME_LABELS, OB_PERIODS, obTime } from "./obMeta";

/**
 * OB REGISTER & REPORTING (admins/supervisors) — period summary (completed on
 * time / late, outstanding within grace, overdue, cancelled, unscheduled
 * entries) plus the detailed register and outstanding-check list for the
 * period, with CSV export. Served by the obAccess "report" action (same
 * permissions as the screen).
 */
export default function OBRegisterView({ ob, user }) {
  const [period, setPeriod] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [roomId, setRoomId] = useState("all");
  const [view, setView] = useState("entries");

  const rooms = ob?.rooms || [];
  const canQuery = !!user?.customer_id || !!user?.reseller_id;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["obReport", user?.id, period, customFrom, customTo, roomId],
    queryFn: async () => {
      const res = await base44.functions.invoke("obAccess", {
        action: "report",
        period,
        date_from: period === "custom" ? customFrom : undefined,
        date_to: period === "custom" ? customTo : undefined,
        filters: roomId !== "all" ? { control_room_id: roomId } : {},
      });
      return res?.data ?? res;
    },
    enabled: canQuery && (period !== "custom" || (!!customFrom && !!customTo)),
  });

  const summary = data?.summary || {};
  const entries = data?.entries || [];
  const missed = data?.missed || [];

  const cards = useMemo(() => ([
    { label: "Scheduled due", value: summary.scheduled_due, color: "text-sky-400" },
    { label: "On time", value: summary.completed_on_time, color: "text-emerald-400" },
    { label: "Late", value: summary.completed_late, color: "text-amber-400" },
    { label: "Overdue outstanding", value: summary.overdue_outstanding, color: "text-rose-400" },
    { label: "Within grace", value: summary.outstanding_within_grace, color: "text-slate-300" },
    { label: "Cancelled", value: summary.cancelled_checks, color: "text-slate-400" },
    { label: "Unscheduled entries", value: summary.unscheduled_entries, color: "text-indigo-400" },
  ]), [summary]);

  const exportCsv = () => {
    const rows = view === "entries" ? entries : missed;
    const head = view === "entries"
      ? ["Reference", "Type", "Title", "Category", "Outcome", "Control room", "Site", "Operator", "Due", "Recorded", "Notes"]
      : ["Reference", "Title", "Control room", "Site", "Due", "Status", "Cancel reason"];
    const lines = [head.join(",")].concat(rows.map((e) => {
      const vals = view === "entries"
        ? [e.ob_reference, e.source, e.title, e.category || "", OB_OUTCOME_LABELS[e.outcome] || "", e.control_room_name || "", e.site_name || "", e.operator_name || "", obTime(e.due_at), obTime(e.submitted_at), (e.notes || "").replace(/[\r\n]+/g, " ")]
        : [e.ob_reference, e.title, e.control_room_name || "", e.site_name || "", obTime(e.due_at), e.status, (e.cancel_reason || "").replace(/[\r\n]+/g, " ")];
      return vals.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(",");
    }));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ob-" + (view === "entries" ? "register" : "outstanding") + "-" + (data?.date_from || period) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!canQuery) return null;

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
          <BookOpen className="w-6 h-6 text-indigo-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">OB Register & Reports</h1>
          <p className="text-sm text-slate-400">
            {data ? data.date_from + (data.date_to !== data.date_from ? " – " + data.date_to : "") : "—"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="bg-slate-800 border-slate-700 w-40"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            {OB_PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {period === "custom" && (
          <>
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-slate-800 border-slate-700 w-36" />
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-slate-800 border-slate-700 w-36" />
          </>
        )}
        {rooms.length > 1 && (
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger className="bg-slate-800 border-slate-700 w-48"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              <SelectItem value="all">All control rooms</SelectItem>
              {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
            {cards.map((c) => (
              <div key={c.label} className="rounded-xl bg-slate-900/60 border border-slate-800 p-3">
                <p className={`text-2xl font-bold ${c.color}`}>{c.value ?? 0}</p>
                <p className="text-[11px] text-slate-500 leading-tight mt-0.5">{c.label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setView("entries")}
              className={`px-4 h-9 rounded-lg text-sm font-medium border ${view === "entries" ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
              Recorded entries ({entries.length})
            </button>
            <button onClick={() => setView("missed")}
              className={`px-4 h-9 rounded-lg text-sm font-medium border ${view === "missed" ? "bg-amber-500/20 border-amber-500/50 text-amber-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
              Outstanding / cancelled ({missed.length})
            </button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={(view === "entries" ? entries : missed).length === 0}
              className="ml-auto border-slate-600 text-slate-300">
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>

          {(view === "entries" ? entries : missed).length === 0 ? (
            <div className="text-center py-12">
              {view === "entries"
                ? <CheckCircle2 className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                : <XCircle className="w-10 h-10 text-slate-600 mx-auto mb-2" />}
              <p className="text-slate-400 text-sm">{view === "entries" ? "No recorded entries in this period" : "No outstanding or cancelled checks in this period"}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(view === "entries" ? entries : missed).map((e) => (
                <div key={e.id} className="rounded-xl border bg-slate-900/60 border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-sky-400">{e.ob_reference}</span>
                        <p className="font-medium text-white text-sm">{e.title}</p>
                        {e.source === "unscheduled" && <Badge variant="outline" className="border-indigo-500/40 text-indigo-400 text-[10px]">Unscheduled</Badge>}
                        {e.status === "cancelled" && <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">Cancelled</Badge>}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {e.control_room_name || "Control room"}{e.site_name ? " · " + e.site_name : ""}
                        {e.operator_name ? " · " + e.operator_name : ""}
                        {e.amendments && e.amendments.length > 0 ? " · " + e.amendments.length + " amendment(s)" : ""}
                      </p>
                      {e.notes && <p className="text-xs text-slate-300 mt-1.5 whitespace-pre-wrap line-clamp-3">{e.notes}</p>}
                      {e.status === "cancelled" && e.cancel_reason && (
                        <p className="text-xs text-slate-500 mt-1.5"><AlertTriangle className="w-3 h-3 inline mr-1" />{e.cancel_reason}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 text-xs text-slate-400">
                      {e.source === "scheduled"
                        ? (e.submitted_at
                          ? <span className={e.submitted_at > e.due_at ? "text-amber-400" : "text-emerald-400"}>
                              {e.submitted_at > e.due_at ? "Late" : "On time"} · {obTime(e.submitted_at)}
                            </span>
                          : <span className="text-rose-400">{e.overdue_at ? "Overdue" : "Outstanding"} · due {obTime(e.due_at)}</span>)
                        : obTime(e.submitted_at || e.due_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}