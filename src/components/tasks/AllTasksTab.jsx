import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  UserPlus, ShieldCheck, XCircle, FileWarning, Archive, ArchiveRestore, Trash2,
  ClipboardList,
} from "lucide-react";
import TaskCard from "./TaskCard";
import AssignDialog from "./AssignDialog";
import VerifyDialog from "./VerifyDialog";
import ReasonDialog from "./ReasonDialog";
import {
  TASK_VIEW_TABS, TASK_OPEN_STATUSES, filterTasksByView, isTaskDeletable,
} from "./taskMeta";

/**
 * ALL TASKS view — Active / Completed / Overdue / Cancelled / Archived / All.
 * Operational actions (assign, verify, reason, cancel) plus the data
 * lifecycle: Archive, Restore, Delete (only shown for records the client
 * mirror says are safe — the SERVER revalidates every delete) and BULK
 * Archive / Bulk Cancel. Bulk delete is deliberately NOT offered.
 */
export default function AllTasksTab({ tasks, data, act }) {
  const [view, setView] = useState("active");
  const [selected, setSelected] = useState([]);
  const [assignTask, setAssignTask] = useState(null);
  const [verifyTask, setVerifyTask] = useState(null);
  const [reasonTask, setReasonTask] = useState(null);
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const c = {};
    for (const [key] of TASK_VIEW_TABS) c[key] = filterTasksByView(tasks, key).length;
    return c;
  }, [tasks]);

  const filtered = useMemo(() => filterTasksByView(tasks, view), [tasks, view]);
  const sorted = useMemo(() =>
    [...filtered].sort((a, b) =>
      String(a.due_date || a.scheduled_at || a.scheduled_date || "")
        .localeCompare(String(b.due_date || b.scheduled_at || b.scheduled_date || ""))),
    [filtered]);

  const withSaving = async (fn) => {
    setSaving(true);
    try { await fn(); } catch (_) {} finally { setSaving(false); }
  };

  const toggleSelect = (id) => setSelected((s) =>
    s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const bulk = (mode) => {
    const msg = mode === "archive"
      ? `Archive ${selected.length} task(s)?\nThey will be hidden from active views but kept (with all history) under Archived.`
      : `Cancel ${selected.length} task(s)?\nOpen tasks stop operating — records and history are preserved.`;
    if (!window.confirm(msg)) return;
    withSaving(async () => {
      await act({ action: "bulkTaskAction", mode, ids: selected },
        mode === "archive" ? "Tasks archived" : "Tasks cancelled");
      setSelected([]);
    });
  };

  const archiveTask = (task) => {
    if (!window.confirm(`Archive "${task.title}"?\nIt will be hidden from active queues but kept (with all history) under Archived.`)) return;
    act({ action: "archiveTask", id: task.id }, "Task archived").catch(() => {});
  };
  const restoreTask = (task) =>
    act({ action: "restoreTask", id: task.id }, "Task restored").catch(() => {});
  const deleteTask = (task) => {
    if (!window.confirm(`Permanently delete "${task.title}"?\nThis cannot be undone.`)) return;
    act({ action: "deleteTask", id: task.id }, "Task permanently deleted").catch(() => {});
  };
  const cancelTask = (task) => {
    if (!window.confirm(`Cancel "${task.title}"?\nIt stops operating — the record is preserved.`)) return;
    act({ action: "cancel", id: task.id }, "Task cancelled").catch(() => {});
  };

  const submitAssign = async (userId) => {
    const reassign = assignTask.assigned_to && assignTask.assigned_to !== userId;
    await withSaving(() => act({
      action: reassign ? "reassign" : "assign", id: assignTask.id, assigned_to: userId,
    }, reassign ? "Task reassigned" : "Task assigned"));
    setAssignTask(null);
  };
  const submitVerify = async (payload) => {
    await withSaving(() => act({ action: "verify", id: verifyTask.id, ...payload }, "Task verified — completed"));
    setVerifyTask(null);
  };
  const submitReason = async (reason) => {
    await withSaving(() => act({ action: "captureReason", id: reasonTask.id, reason }, "Reason saved"));
    setReasonTask(null);
  };

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {TASK_VIEW_TABS.map(([key, label]) => (
          <button key={key} onClick={() => setView(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${view === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}{counts[key] ? ` (${counts[key]})` : ""}
          </button>
        ))}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <span className="text-sm text-sky-200 font-medium">{selected.length} selected</span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" disabled={saving} onClick={() => bulk("archive")}
            className="bg-slate-800 border-slate-700 text-slate-200 h-9">
            <Archive className="w-4 h-4" /> Bulk Archive
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => bulk("cancel")}
            className="text-amber-400 border-amber-500/30 hover:bg-amber-500/10 h-9">
            <XCircle className="w-4 h-4" /> Bulk Cancel
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}
            className="text-slate-400 hover:text-white h-9">Clear</Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No tasks in this view</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((task) => (
            <div key={task.id} className="flex gap-2 items-start">
              <Checkbox className="mt-5 shrink-0"
                checked={selected.includes(task.id)}
                onCheckedChange={() => toggleSelect(task.id)}
                aria-label={`Select ${task.title}`} />
              <div className="flex-1 min-w-0">
                <TaskCard task={task}>
                  {!task.archived && ["queue", "assigned", "in_progress", "reopened", "new"].includes(task.status) && (
                    <Button size="sm" variant="outline" onClick={() => setAssignTask(task)} className="flex-1 sm:flex-none">
                      <UserPlus className="w-4 h-4" /> {task.assigned_to ? "Reassign" : "Assign"}
                    </Button>
                  )}
                  {task.status === "awaiting_verification" && (
                    <Button size="sm" onClick={() => setVerifyTask(task)} className="flex-1 sm:flex-none">
                      <ShieldCheck className="w-4 h-4" /> Verify
                    </Button>
                  )}
                  {["overdue", "reopened"].includes(task.status) && !task.non_completion_reason && (
                    <Button size="sm" variant="outline" onClick={() => setReasonTask(task)}
                      className="flex-1 sm:flex-none text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                      <FileWarning className="w-4 h-4" /> Reason
                    </Button>
                  )}
                  {!task.archived && TASK_OPEN_STATUSES.includes(task.status) && (
                    <Button size="sm" variant="outline" onClick={() => cancelTask(task)}
                      className="flex-1 sm:flex-none text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                      <XCircle className="w-4 h-4" /> Cancel
                    </Button>
                  )}
                  {!task.archived ? (
                    <Button size="sm" variant="outline" onClick={() => archiveTask(task)}
                      className="flex-1 sm:flex-none bg-slate-800 border-slate-700 text-slate-200">
                      <Archive className="w-4 h-4" /> Archive
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => restoreTask(task)}
                      className="flex-1 sm:flex-none bg-slate-800 border-slate-700 text-slate-200">
                      <ArchiveRestore className="w-4 h-4" /> Restore
                    </Button>
                  )}
                  {isTaskDeletable(task) && (
                    <Button size="sm" variant="outline" onClick={() => deleteTask(task)}
                      className="flex-1 sm:flex-none text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                      <Trash2 className="w-4 h-4" /> Delete
                    </Button>
                  )}
                </TaskCard>
              </div>
            </div>
          ))}
        </div>
      )}

      <AssignDialog open={!!assignTask} task={assignTask} users={data?.users || []} saving={saving}
        reassign={!!assignTask?.assigned_to}
        onClose={() => setAssignTask(null)} onSubmit={submitAssign} />
      <VerifyDialog open={!!verifyTask} task={verifyTask} mode="verify" saving={saving}
        onClose={() => setVerifyTask(null)} onSubmit={submitVerify} />
      <ReasonDialog open={!!reasonTask} task={reasonTask} saving={saving}
        onClose={() => setReasonTask(null)} onSubmit={submitReason} />
    </div>
  );
}