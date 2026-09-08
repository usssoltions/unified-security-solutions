import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardList, UserPlus, ShieldCheck, XCircle, FileWarning, Radio } from "lucide-react";
import TaskCard from "./TaskCard";
import AssignDialog from "./AssignDialog";
import VerifyDialog from "./VerifyDialog";
import ReasonDialog from "./ReasonDialog";
import { QUEUE_TABS } from "./taskMeta";

/**
 * CONTROL ROOM OPERATOR QUEUE — the operator sees ONLY the queues of the
 * control rooms they are authorised for (server-scoped). Tabs: Unassigned /
 * Assigned / In Progress / Awaiting Verification / Overdue / Completed.
 * Actions: assign, reassign, verify + sign off (sign-off 2), reject/reopen,
 * capture non-completion reason.
 */
export default function OperatorQueueView({ data, act, user }) {
  const [tab, setTab] = useState("unassigned");
  const [assignTask, setAssignTask] = useState(null);
  const [verifyTask, setVerifyTask] = useState(null);
  const [verifyMode, setVerifyMode] = useState("verify");
  const [reasonTask, setReasonTask] = useState(null);
  const [saving, setSaving] = useState(false);

  const tasks = data?.tasks || [];
  const users = data?.users || [];
  const rooms = data?.control_rooms || [];
  const roomName = (id) => (rooms.find((r) => r.id === id) || {}).name || "Control Room";

  const counts = useMemo(() => {
    const byKey = {};
    for (const t of tasks) {
      for (const [key, , pred] of QUEUE_TABS) {
        if (pred(t)) { byKey[key] = (byKey[key] || 0) + 1; break; }
      }
    }
    return byKey;
  }, [tasks]);

  const filtered = useMemo(() => {
    const entry = QUEUE_TABS.find(([key]) => key === tab) || QUEUE_TABS[0];
    return tasks.filter(entry[2]).sort((a, b) =>
      String(a.due_date || a.scheduled_at || a.scheduled_date || "")
        .localeCompare(String(b.due_date || b.scheduled_at || b.scheduled_date || "")));
  }, [tasks, tab]);

  const withSaving = async (fn) => {
    setSaving(true);
    try { await fn(); } catch (_) {} finally { setSaving(false); }
  };

  const submitAssign = async (userId) => {
    const reassign = assignTask.assigned_to && assignTask.assigned_to !== userId;
    await withSaving(() => act({
      action: reassign ? "reassign" : "assign", id: assignTask.id, assigned_to: userId,
    }, reassign ? "Task reassigned" : "Task assigned"));
    setAssignTask(null);
  };
  const submitVerify = async (payload) => {
    const task = verifyTask;
    const isVerify = verifyMode === "verify";
    await withSaving(() => act(
      isVerify
        ? { action: "verify", id: task.id, ...payload }
        : { action: "reject", id: task.id, ...payload },
      isVerify ? "Task verified — completed" : "Task reopened"));
    setVerifyTask(null);
  };
  const submitReason = async (reason) => {
    await withSaving(() => act({ action: "captureReason", id: reasonTask.id, reason }, "Reason saved"));
    setReasonTask(null);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <Radio className="w-6 h-6 text-sky-400" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">Task Queue</h1>
          <p className="text-sm text-slate-400 truncate">
            {rooms.length === 0 ? "No control rooms assigned to you"
              : rooms.length === 1 ? roomName(rooms[0].id)
              : rooms.length + " control room(s): " + rooms.map((r) => r.name).join(", ")}
          </p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {QUEUE_TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${tab === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}{counts[key] ? ` (${counts[key]})` : ""}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No tasks in this view</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <TaskCard key={task.id} task={task}>
              {["queue", "assigned", "in_progress", "reopened", "new"].includes(task.status) && (
                <Button size="sm" variant="outline" onClick={() => setAssignTask(task)} className="flex-1 sm:flex-none">
                  <UserPlus className="w-4 h-4" /> {task.assigned_to ? "Reassign" : "Assign"}
                </Button>
              )}
              {task.status === "awaiting_verification" && (
                <>
                  <Button size="sm" onClick={() => { setVerifyMode("verify"); setVerifyTask(task); }} className="flex-1 sm:flex-none">
                    <ShieldCheck className="w-4 h-4" /> Verify
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setVerifyMode("reject"); setVerifyTask(task); }}
                    className="flex-1 sm:flex-none text-orange-400 border-orange-500/30 hover:bg-orange-500/10">
                    <XCircle className="w-4 h-4" /> Reject
                  </Button>
                </>
              )}
              {/* OVERDUE IS NOT TERMINAL: a task with Sign-off 1 stays
                  verifiable past the deadline — the operator completes the
                  dual sign-off late (reason captured inside the verify
                  modal). The standalone Reason action remains only for
                  overdue tasks with NO sign-off yet. */}
              {task.status === "overdue" && task.completed_at && (
                <Button size="sm" onClick={() => { setVerifyMode("verify"); setVerifyTask(task); }} className="flex-1 sm:flex-none">
                  <ShieldCheck className="w-4 h-4" /> Verify Late Completion
                </Button>
              )}
              {((task.status === "overdue" && !task.completed_at) || (task.status === "reopened" && !task.non_completion_reason)) && (
                <Button size="sm" variant="outline" onClick={() => setReasonTask(task)}
                  className="flex-1 sm:flex-none text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                  <FileWarning className="w-4 h-4" /> Reason
                </Button>
              )}
            </TaskCard>
          ))}
        </div>
      )}

      <AssignDialog open={!!assignTask} task={assignTask} users={users} saving={saving}
        reassign={!!assignTask?.assigned_to}
        onClose={() => setAssignTask(null)} onSubmit={submitAssign} />
      <VerifyDialog open={!!verifyTask} task={verifyTask} mode={verifyMode} saving={saving}
        onClose={() => setVerifyTask(null)} onSubmit={submitVerify} />
      <ReasonDialog open={!!reasonTask} task={reasonTask} saving={saving}
        onClose={() => setReasonTask(null)} onSubmit={submitReason} />
    </div>
  );
}