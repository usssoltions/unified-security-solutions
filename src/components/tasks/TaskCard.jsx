import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Clock, MapPin, User, Building2, CalendarClock, ClipboardList, Repeat,
  ShieldCheck, FileWarning, AlertTriangle,
} from "lucide-react";
import EvidenceViewDialog from "./EvidenceViewDialog";
import { formatDateTime, formatDate } from "@/lib/datetime";
import { TASK_STATUS_META, PRIORITY_META } from "./taskMeta";

/**
 * Universal task display card for the Control Room Task Scheduling workflow.
 * Renders the full dual-sign-off picture; role-specific action buttons are
 * passed as children by each view (operator queue / My Tasks / supervisor).
 */
export default function TaskCard({ task, children }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const status = TASK_STATUS_META[task.status] || TASK_STATUS_META.new;
  const priority = PRIORITY_META[task.priority] || PRIORITY_META.medium;

  return (
    <div className={`rounded-xl border bg-slate-900/60 p-4 ${task.status === "overdue" ? "border-rose-500/40" : "border-slate-700/50"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-white truncate">{task.title}</h3>
            <Badge variant="outline" className={status.cls}>{status.short || status.label}</Badge>
            <Badge variant="outline" className={priority.cls}>{priority.label}</Badge>
          </div>

          {task.description && (
            <p className="text-sm text-slate-400 mt-2 whitespace-pre-wrap">{task.description}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-xs text-slate-400">
            {task.control_room_name && (
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                {task.control_room_name}
              </div>
            )}
            {task.task_batch_title && (
              <div className="flex items-center gap-1.5">
                <ClipboardList className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                {task.task_batch_title}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {task.site_name || "No site / service area"}
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
            {task.recurrence_type && task.recurrence_type !== "none" && (
              <div className="flex items-center gap-1.5">
                <Repeat className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                Recurring task series
              </div>
            )}
          </div>

          {/* Dual sign-off picture */}
          {task.completed_by_name && (
            <div className="mt-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300/90">
              <div className="flex items-center gap-1.5 font-medium">
                <User className="w-3.5 h-3.5 shrink-0" />
                Sign-off 1 — {task.completed_by_name} · {formatDateTime(task.completed_at)}
                {task.completion_signature && " (signed)"}
              </div>
              {task.completion_notes && <p className="mt-1 whitespace-pre-wrap">{task.completion_notes}</p>}
              {task.completion_evidence_url && (
                <button type="button" onClick={() => setEvidenceOpen(true)}
                  className="inline-block mt-1 text-sky-400 underline">View evidence</button>
              )}
            </div>
          )}
          {task.verified_by_name && (
            <div className="mt-2 rounded-lg bg-sky-500/5 border border-sky-500/20 px-3 py-2 text-xs text-sky-300/90">
              <div className="flex items-center gap-1.5 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                Sign-off 2 — verified by {task.verified_by_name} · {formatDateTime(task.verified_at)}
                {task.verification_signature && " (signed)"}
              </div>
              {task.verification_notes && <p className="mt-1 whitespace-pre-wrap">{task.verification_notes}</p>}
            </div>
          )}
          {task.status === "completed" && task.final_completed_at && (
            <p className="text-xs text-emerald-400 mt-2">
              Fully completed {formatDateTime(task.final_completed_at)} (both sign-offs)
            </p>
          )}
          {task.reopen_reason && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-orange-300/90">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">
                Rejected by {task.reopened_by_name || "operator"}: {task.reopen_reason}
              </span>
            </div>
          )}
          {task.non_completion_reason && (
            <div className="mt-2 flex items-start gap-1.5 text-xs text-rose-300/90">
              <FileWarning className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span className="whitespace-pre-wrap">
                Non-completion reason ({task.reason_captured_by_name || "—"}): {task.non_completion_reason}
              </span>
            </div>
          )}
        </div>

        {children && <div className="flex sm:flex-col gap-2 shrink-0">{children}</div>}
      </div>

      {/* In-app evidence viewer — a raw new-tab open renders blank in the
          guard's Android WebView, so the stored file is displayed in-app. */}
      {task.completion_evidence_url && (
        <EvidenceViewDialog open={evidenceOpen} url={task.completion_evidence_url}
          onClose={() => setEvidenceOpen(false)} />
      )}
    </div>
  );
}