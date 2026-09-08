import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Building2, Repeat, XCircle, Archive, ArchiveRestore, Trash2, Pencil, Clock,
} from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/datetime";
import {
  BATCH_VIEW_TABS, BATCH_STATUS_META, RECURRENCE_LABEL, ARCHIVED_BADGE_CLS,
  filterBatchesByView, isTaskDeletable,
} from "./taskMeta";
import BatchEditDialog from "./BatchEditDialog";

/** Cancel options for a RECURRING SERIES (history is never deleted). */
function SeriesCancelDialog({ batch, onClose, act }) {
  if (!batch) return null;
  const run = (payload, msg) => {
    act({ action: "cancelBatch", id: batch.id, ...payload }, msg).catch(() => {});
    onClose();
  };
  const btn = "w-full h-11 justify-start text-left bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700";
  return (
    <Dialog open={!!batch} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">Cancel recurring series</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400 -mt-1">
          “{batch.title}” repeats {RECURRENCE_LABEL[batch.recurrence_type] || "recurring"}.
          Choose how to stop it — historical completed and signed occurrences are never deleted.
        </p>
        <div className="space-y-2">
          <Button variant="outline" className={btn}
            onClick={() => run({ scope: "future" }, "Future occurrences cancelled")}>
            A · Cancel future occurrences only
          </Button>
          <Button variant="outline" className={btn}
            onClick={() => run({ scope: "all" }, "Series cancelled")}>
            B · Cancel current + all open occurrences
          </Button>
          <Button variant="outline" className={btn}
            onClick={() => run({ scope: "all", archive_history: true }, "Series cancelled and history archived")}>
            C · Cancel all + archive completed history
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * TASK LISTS view — Active / Completed / Cancelled / Archived / All with the
 * full data lifecycle: Edit, Cancel (series scopes A/B/C), Archive, Restore
 * and Delete where the record is safe to delete. The SERVER revalidates every
 * action — a denied delete surfaces the reason (archive offered instead).
 */
export default function BatchListTab({ batches, tasks, data, act }) {
  const [view, setView] = useState("active");
  const [cancelSeries, setCancelSeries] = useState(null);
  const [editBatch, setEditBatch] = useState(null);

  const tasksByBatch = useMemo(() => {
    const m = {};
    for (const t of tasks) {
      if (!t.task_batch_id) continue;
      (m[t.task_batch_id] = m[t.task_batch_id] || []).push(t);
    }
    return m;
  }, [tasks]);

  const filtered = useMemo(() => filterBatchesByView(batches, view), [batches, view]);
  const counts = useMemo(() => {
    const c = {};
    for (const [key] of BATCH_VIEW_TABS) c[key] = filterBatchesByView(batches, key).length;
    return c;
  }, [batches]);

  const batchSafeToDelete = (batch) => {
    if (batch.report_generated_at) return false;
    const members = batch.is_series
      ? [batch, ...batches.filter((b) => b.parent_batch_id === batch.id)]
      : [batch];
    return members.every((m) => !m.report_generated_at
      && (tasksByBatch[m.id] || []).every((t) => isTaskDeletable(t)));
  };

  const cancelBatch = (batch) => {
    if (batch.is_series) { setCancelSeries(batch); return; }
    if (!window.confirm(`Cancel "${batch.title}"?\nOpen tasks will stop operating — records and history are preserved.`)) return;
    act({ action: "cancelBatch", id: batch.id }, "Task list cancelled").catch(() => {});
  };
  const archiveBatch = (batch) => {
    if (!window.confirm(`Archive "${batch.title}"?\nIt will be hidden from active views but kept (with all history) under Archived.`)) return;
    act({ action: "archiveBatch", id: batch.id }, "Task list archived").catch(() => {});
  };
  const restoreBatch = (batch) =>
    act({ action: "restoreBatch", id: batch.id }, "Task list restored").catch(() => {});
  const deleteBatch = (batch) => {
    if (!window.confirm(`Permanently delete "${batch.title}"?\nThis cannot be undone.`)) return;
    act({ action: "deleteBatch", id: batch.id }, "Task list permanently deleted").catch(() => {});
  };

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {BATCH_VIEW_TABS.map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${view === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}{counts[key] ? ` (${counts[key]})` : ""}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No task lists in this view</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((batch) => {
            const bt = tasksByBatch[batch.id] || [];
            const completed = bt.filter((t) => t.status === "completed").length;
            const outstanding = bt.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
            const status = BATCH_STATUS_META[batch.status] || BATCH_STATUS_META.active;
            const isActive = batch.status === "active" || batch.status === "reason_pending";
            return (
              <div key={batch.id} className={`rounded-xl border p-4 ${batch.archived ? "border-slate-600/40 bg-slate-900/30" : "border-slate-700/50 bg-slate-900/60"}`}>
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white truncate">{batch.title}</h3>
                      <Badge variant="outline" className={status.cls}>{status.label}</Badge>
                      {batch.archived && (
                        <Badge variant="outline" className={ARCHIVED_BADGE_CLS}>Archived</Badge>
                      )}
                      {batch.is_series && (
                        <Badge variant="outline" className="bg-slate-500/15 text-slate-300 border-slate-500/30 gap-1">
                          <Repeat className="w-3 h-3" /> {RECURRENCE_LABEL[batch.recurrence_type] || "Recurring"}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-500" />
                        {batch.control_room_name || "—"}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        {formatDate(batch.scheduled_date)} · {batch.active_start_time}–{batch.deadline_time}
                      </span>
                      <span>Supervisor: {batch.primary_supervisor_name || "—"}</span>
                      {bt.length > 0 && (
                        <span className="text-slate-300">
                          {completed}/{bt.length} completed · {outstanding} outstanding
                        </span>
                      )}
                      {batch.report_generated_at && (
                        <span className="text-emerald-400">Report delivered {formatDateTime(batch.report_generated_at)}</span>
                      )}
                      {batch.archived && batch.archived_at && (
                        <span>Archived {formatDateTime(batch.archived_at)}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {isActive && !batch.archived && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditBatch(batch)}
                          className="bg-slate-800 border-slate-700 text-slate-200 h-10">
                          <Pencil className="w-4 h-4" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => cancelBatch(batch)}
                          className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10 h-10">
                          <XCircle className="w-4 h-4" /> Cancel
                        </Button>
                      </>
                    )}
                    {!batch.archived ? (
                      <Button size="sm" variant="outline" onClick={() => archiveBatch(batch)}
                        className="bg-slate-800 border-slate-700 text-slate-200 h-10">
                        <Archive className="w-4 h-4" /> Archive
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => restoreBatch(batch)}
                        className="bg-slate-800 border-slate-700 text-slate-200 h-10">
                        <ArchiveRestore className="w-4 h-4" /> Restore
                      </Button>
                    )}
                    {batchSafeToDelete(batch) && (
                      <Button size="sm" variant="outline" onClick={() => deleteBatch(batch)}
                        className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10 h-10">
                        <Trash2 className="w-4 h-4" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <SeriesCancelDialog batch={cancelSeries} onClose={() => setCancelSeries(null)} act={act} />
      <BatchEditDialog open={!!editBatch} batch={editBatch} data={data} act={act}
        onClose={() => setEditBatch(null)} />
    </div>
  );
}