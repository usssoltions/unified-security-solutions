import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardList, PlayCircle, CheckCircle2, Shield } from "lucide-react";
import TaskCard from "./TaskCard";
import SignoffDialog from "./SignoffDialog";
import { TASK_OPEN_STATUSES } from "./taskMeta";

/**
 * GUARD / ASSIGNED USER — "MY TASKS". Only the tasks assigned to this user
 * (server-scoped: the gateway never returns other guards' tasks, other
 * control rooms' queues or other tenants' data). The guard can start, note,
 * attach evidence and SIGN OFF (sign-off 1) — never final verification.
 */
export default function MyTasksView({ data, act, user }) {
  const [signoffTask, setSignoffTask] = useState(null);
  const [saving, setSaving] = useState(false);

  const tasks = data?.tasks || [];
  const openTasks = useMemo(() =>
    tasks.filter((t) => TASK_OPEN_STATUSES.includes(t.status)).sort((a, b) =>
      String(a.due_date || a.scheduled_at || a.scheduled_date || "")
        .localeCompare(String(b.due_date || b.scheduled_at || b.scheduled_date || ""))),
    [tasks]);
  const doneTasks = useMemo(() =>
    tasks.filter((t) => t.status === "completed")
      .sort((a, b) => String(b.final_completed_at || "").localeCompare(String(a.final_completed_at || "")))
      .slice(0, 10),
    [tasks]);

  const submitSignoff = async (payload) => {
    setSaving(true);
    try {
      await act({ action: "submitCompletion", id: signoffTask.id, ...payload },
        "Signed off — awaiting Control Room verification");
      setSignoffTask(null);
    } catch (_) {} finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <ClipboardList className="w-6 h-6 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">My Tasks</h1>
          <p className="text-sm text-slate-400">Tasks assigned to you — sign off when done</p>
        </div>
      </div>

      {openTasks.length === 0 ? (
        <div className="text-center py-16">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No open tasks</p>
          <p className="text-slate-500 text-sm mt-1">You're all caught up. New assignments appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {openTasks.map((task) => (
            <TaskCard key={task.id} task={task}>
              {(task.status === "assigned" || task.status === "new" || task.status === "reopened") && (
                <Button size="sm" variant="outline" onClick={() => act({ action: "start", id: task.id }, "Task started").catch(() => {})}
                  className="flex-1 sm:flex-none">
                  <PlayCircle className="w-4 h-4" /> Start
                </Button>
              )}
              <Button size="sm" onClick={() => setSignoffTask(task)} className="flex-1 sm:flex-none">
                <CheckCircle2 className="w-4 h-4" /> Complete & Sign Off
              </Button>
            </TaskCard>
          ))}
        </div>
      )}

      {doneTasks.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Recently completed</h2>
          <div className="space-y-3 opacity-80">
            {doneTasks.map((task) => <TaskCard key={task.id} task={task} />)}
          </div>
        </div>
      )}

      <SignoffDialog open={!!signoffTask} task={signoffTask} saving={saving}
        onClose={() => setSignoffTask(null)} onSubmit={submitSignoff} />
    </div>
  );
}