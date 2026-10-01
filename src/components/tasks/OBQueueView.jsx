import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ClipboardList, Plus, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import OBSubmitDialog from "./OBSubmitDialog";
import { OB_OUTCOME_LABELS, obTime } from "./obMeta";

/**
 * OPERATOR OCCURRENCE BOOK VIEW — the outstanding OB checks of the control
 * rooms the operator is authorised for (server-scoped by obAccess), plus
 * unscheduled OB entry capture. All writes go through the obAccess gateway.
 */
export default function OBQueueView({ ob, act, user, refresh }) {
  const [submitting, setSubmitting] = useState(null);
  const [unscheduled, setUnscheduled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const queue = ob?.queue || [];
  const rooms = ob?.rooms || [];
  const sites = ob?.sites || [];
  const now = Date.now();

  const pending = useMemo(() =>
    queue.filter((c) => c.status === "pending")
      .sort((a, b) => String(a.due_at || "").localeCompare(String(b.due_at || ""))),
    [queue]);

  const isOverdue = (c) => !!c.overdue_at || (c.due_at && Date.parse(c.due_at) < now - 1000);
  const overdueCount = pending.filter(isOverdue).length;

  const doSubmit = async (payload) => {
    setSaving(true);
    try {
      await act(payload, submitting ? "Check recorded" : "OB entry recorded");
      setSubmitting(null); setUnscheduled(false);
      if (refresh) refresh();
    } catch (_) {} finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <BookOpen className="w-6 h-6 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">Occurrence Book</h1>
            <p className="text-sm text-slate-400">
              {overdueCount > 0 ? overdueCount + " check" + (overdueCount > 1 ? "s" : "") + " overdue" : pending.length + " outstanding check" + (pending.length === 1 ? "" : "s")}
            </p>
          </div>
        </div>
        <Button onClick={() => setUnscheduled(true)} className="shrink-0">
          <Plus className="w-4 h-4" /> Unscheduled Entry
        </Button>
      </div>

      {pending.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 className="w-12 h-12 text-emerald-500/60 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No outstanding OB checks</p>
          <p className="text-slate-500 text-sm mt-1">Scheduled checks appear here when their due time arrives.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map((c) => {
            const overdue = isOverdue(c);
            return (
              <div key={c.id}
                className={`rounded-xl border p-4 ${overdue ? "border-amber-500/40 bg-amber-500/5" : "bg-slate-900/60 border-slate-800"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{c.title}</p>
                      {overdue && <Badge variant="destructive" className="bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/20">
                        <AlertTriangle className="w-3 h-3 mr-1" />Overdue
                      </Badge>}
                      {c.evidence_required && <Badge variant="outline" className="border-slate-600 text-slate-400">Evidence required</Badge>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {c.slot_label || obTime(c.due_at)}
                      {c.site_name ? " · " + c.site_name : " · Overall"}
                      {" · " + (c.control_room_name || "Control room")}
                      {c.category ? " · " + c.category : ""}
                    </p>
                    {c.instructions && <p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{c.instructions}</p>}
                  </div>
                  <Button size="sm" disabled={busyId === c.id} onClick={() => setSubmitting(c)}
                    className="shrink-0 active:scale-95">
                    {busyId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />}
                    Record
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <OBSubmitDialog
        open={!!submitting || unscheduled}
        check={submitting}
        rooms={rooms}
        sites={sites}
        saving={saving}
        onClose={() => { setSubmitting(null); setUnscheduled(false); }}
        onSubmit={doSubmit}
      />
    </div>
  );
}