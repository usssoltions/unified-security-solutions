import React, { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ClipboardList, Plus, Building2, Repeat, XCircle, UserPlus,
  ShieldCheck, FileWarning, CheckCircle2, Clock,
} from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/datetime";
import TaskCard from "./TaskCard";
import AssignDialog from "./AssignDialog";
import VerifyDialog from "./VerifyDialog";
import ReasonDialog from "./ReasonDialog";
import TaskBatchForm from "./TaskBatchForm";
import ControlRoomManager from "./ControlRoomManager";
import { TASK_OPEN_STATUSES } from "./taskMeta";

const RECURRENCE_LABEL = {
  daily: "Daily", weekly: "Weekly", weekdays: "Selected weekdays",
  monthly: "Monthly", custom: "Custom interval",
};
const BATCH_STATUS_META = {
  active: { label: "Active", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  reported: { label: "Reported", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Cancelled", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

/**
 * SUPERVISOR / CUSTOMER ADMIN VIEW — task list (batch) management: create task
 * lists allocated to control rooms, monitor completion, cancel; plus the full
 * task view with assign / verify / reason actions (verify enforces the
 * two-person sign-off rule server-side).
 */
export default function SupervisorView({ data, act, user }) {
  const [tab, setTab] = useState("batches");
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignTask, setAssignTask] = useState(null);
  const [verifyTask, setVerifyTask] = useState(null);
  const [reasonTask, setReasonTask] = useState(null);

  const tasks = data?.tasks || [];
  const batches = data?.batches || [];

  const tasksByBatch = useMemo(() => {
    const m = {};
    for (const t of tasks) {
      if (!t.task_batch_id) continue;
      (m[t.task_batch_id] = m[t.task_batch_id] || []).push(t);
    }
    return m;
  }, [tasks]);

  const submitBatch = async (payload) => {
    setSaving(true);
    try {
      const d = await act({ action: "createBatch", ...payload }, "Task list created");
      if (d?.occurrences_generated > 0) {
        // toast already shown by act; recurrence occurrences were generated
      }
      setShowBatchForm(false);
    } catch (_) {} finally { setSaving(false); }
  };

  const cancelBatch = async (batch) => {
    if (!window.confirm(`Cancel "${batch.title}"${batch.is_series ? " and all future occurrences" : ""}?`)) return;
    act({ action: "cancelBatch", id: batch.id }, "Task list cancelled").catch(() => {});
  };

  const submitAssign = async (userId) => {
    const reassign = assignTask.assigned_to && assignTask.assigned_to !== userId;
    await act({ action: reassign ? "reassign" : "assign", id: assignTask.id, assigned_to: userId },
      reassign ? "Task reassigned" : "Task assigned").catch(() => {});
    setAssignTask(null);
  };
  const submitVerify = async (payload) => {
    await act({ action: "verify", id: verifyTask.id, ...payload }, "Task verified — completed").catch(() => {});
    setVerifyTask(null);
  };
  const submitReason = async (reason) => {
    await act({ action: "captureReason", id: reasonTask.id, reason }, "Reason saved").catch(() => {});
    setReasonTask(null);
  };

  const sortedTasks = useMemo(() =>
    [...tasks].sort((a, b) => {
      const aOpen = TASK_OPEN_STATUSES.includes(a.status) ? 0 : 1;
      const bOpen = TASK_OPEN_STATUSES.includes(b.status) ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      return String(a.due_date || a.scheduled_at || a.scheduled_date || "")
        .localeCompare(String(b.due_date || b.scheduled_at || b.scheduled_date || ""));
    }), [tasks]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Task Scheduling</h1>
            <p className="text-sm text-slate-400">Task lists → control rooms → operators → guards</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowBatchForm(true)}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white h-11 px-5">
            <Plus className="w-4 h-4" /> New Task List
          </Button>
          <Button variant="outline" onClick={() => setShowRooms(true)}
            className="bg-slate-800 border-slate-700 text-slate-200 h-11 px-5">
            <Building2 className="w-4 h-4" /> Control Rooms
          </Button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        {[["batches", "Task Lists"], ["tasks", "All Tasks"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium border transition-colors ${tab === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "batches" ? (
        batches.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No task lists yet</p>
            <p className="text-slate-500 text-sm mt-1">Create a task list and allocate it to a control room.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => {
              const bt = tasksByBatch[batch.id] || [];
              const completed = bt.filter((t) => t.status === "completed").length;
              const outstanding = bt.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
              const status = BATCH_STATUS_META[batch.status] || BATCH_STATUS_META.active;
              return (
                <div key={batch.id} className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-white truncate">{batch.title}</h3>
                        <Badge variant="outline" className={status.cls}>{status.label}</Badge>
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
                        {(batch.additional_notification_user_ids || []).length > 0 && (
                          <span>+{(batch.additional_notification_user_ids).length} additional recipient(s)</span>
                        )}
                        {batch.report_generated_at && (
                          <span className="text-emerald-400">Report delivered {formatDateTime(batch.report_generated_at)}</span>
                        )}
                        {batch.last_reminder_at && !batch.report_generated_at && (
                          <span>Last reminder {formatDateTime(batch.last_reminder_at)}</span>
                        )}
                      </div>
                    </div>
                    {batch.status === "active" && (
                      <Button size="sm" variant="outline" onClick={() => cancelBatch(batch)}
                        className="text-rose-400 border-rose-500/30 hover:bg-rose-500/10 h-10">
                        <XCircle className="w-4 h-4" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : sortedTasks.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No tasks yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedTasks.map((task) => (
            <TaskCard key={task.id} task={task}>
              {["queue", "assigned", "in_progress", "reopened", "new"].includes(task.status) && (
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
              {TASK_OPEN_STATUSES.includes(task.status) && (
                <Button size="sm" variant="outline"
                  onClick={() => {
                    if (window.confirm(`Cancel "${task.title}"?`)) {
                      act({ action: "cancel", id: task.id }, "Task cancelled").catch(() => {});
                    }
                  }}
                  className="flex-1 sm:flex-none text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                  <XCircle className="w-4 h-4" /> Cancel
                </Button>
              )}
            </TaskCard>
          ))}
        </div>
      )}

      <TaskBatchForm open={showBatchForm} data={data} saving={saving}
        onClose={() => setShowBatchForm(false)} onSubmit={submitBatch} />
      <ControlRoomManager open={showRooms} data={data} act={act}
        onClose={() => setShowRooms(false)} />
      <AssignDialog open={!!assignTask} task={assignTask} users={data?.users || []}
        reassign={!!assignTask?.assigned_to}
        onClose={() => setAssignTask(null)} onSubmit={submitAssign} />
      <VerifyDialog open={!!verifyTask} task={verifyTask} mode="verify"
        onClose={() => setVerifyTask(null)} onSubmit={submitVerify} />
      <ReasonDialog open={!!reasonTask} task={reasonTask}
        onClose={() => setReasonTask(null)} onSubmit={submitReason} />
    </div>
  );
}