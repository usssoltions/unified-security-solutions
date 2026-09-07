import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock, MapPin, User, Repeat, Pencil, XCircle, CheckCircle2,
  PlayCircle, CalendarClock, StickyNote, History,
} from "lucide-react";
import { formatDateTime, formatDate } from "@/lib/datetime";

export const TASK_OPEN_STATUSES = ["new", "acknowledged", "in_progress", "awaiting", "overdue"];

export const TASK_STATUS_META = {
  new: { label: "Scheduled", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  acknowledged: { label: "Acknowledged", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  in_progress: { label: "In Progress", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  awaiting: { label: "Awaiting", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  overdue: { label: "Missed / Overdue", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  completed: { label: "Completed", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Cancelled", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
};

const PRIORITY_META = {
  low: { label: "Low", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  medium: { label: "Medium", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  high: { label: "High", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  critical: { label: "Critical", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

const RECURRENCE_LABEL = {
  daily: "Repeats daily",
  weekly: "Repeats weekly",
  weekdays: "Repeats on selected weekdays",
  monthly: "Repeats monthly",
  custom: "Repeats on a custom interval",
};

export default function ScheduledTaskCard({ task, canManage, isAssignee, onStart, onComplete, onEdit, onCancel }) {
  const status = TASK_STATUS_META[task.status] || TASK_STATUS_META.new;
  const priority = PRIORITY_META[task.priority] || PRIORITY_META.medium;
  const open = TASK_OPEN_STATUSES.includes(task.status);
  const canWork = open && (canManage || isAssignee);

  return (
    <div className={`rounded-xl border bg-slate-900/60 p-4 ${task.status === "overdue" ? "border-rose-500/40" : "border-slate-700/50"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white truncate">{task.title}</h3>
            <Badge variant="outline" className={status.cls}>{status.label}</Badge>
            <Badge variant="outline" className={priority.cls}>{priority.label}</Badge>
            {task.recurrence_type && task.recurrence_type !== "none" && (
              <Badge variant="outline" className="bg-slate-500/15 text-slate-300 border-slate-500/30 gap-1">
                <Repeat className="w-3 h-3" />
                {RECURRENCE_LABEL[task.recurrence_type] || "Recurring"}
              </Badge>
            )}
          </div>

          {task.description && <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap">{task.description}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {task.site_name || "—"}
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {task.assigned_to_name || "Unassigned"}
            </div>
            <div className="flex items-center gap-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {formatDate(task.scheduled_date)}{task.scheduled_time ? ` · ${task.scheduled_time}` : ""}
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              Due: {task.due_date ? formatDateTime(task.due_date) : "—"}
            </div>
            <div className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              Created by {task.assigned_by_name || "—"} · {formatDateTime(task.created_date)}
            </div>
            {task.status === "completed" && (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Completed by {task.completed_by_name || "—"} · {formatDateTime(task.completed_at)}
              </div>
            )}
          </div>

          {task.completion_notes && (
            <div className="flex items-start gap-1.5 mt-3 text-xs text-emerald-300/90">
              <StickyNote className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">{task.completion_notes}</span>
            </div>
          )}
        </div>

        <div className="flex sm:flex-col gap-2 shrink-0">
          {canWork && task.status !== "in_progress" && (
            <Button size="sm" variant="outline" onClick={onStart} className="flex-1 sm:flex-none">
              <PlayCircle className="w-4 h-4" /> Start
            </Button>
          )}
          {canWork && (
            <Button size="sm" onClick={onComplete} className="flex-1 sm:flex-none">
              <CheckCircle2 className="w-4 h-4" /> Complete
            </Button>
          )}
          {canManage && open && (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} className="flex-1 sm:flex-none">
                <Pencil className="w-4 h-4" /> Edit
              </Button>
              <Button size="sm" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none text-rose-400 border-rose-500/30 hover:bg-rose-500/10">
                <XCircle className="w-4 h-4" /> Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}