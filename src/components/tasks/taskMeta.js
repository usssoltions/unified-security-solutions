/**
 * Task Scheduling — shared status/priority display metadata.
 * Single source for every task surface (queue, My Tasks, batches, dashboard
 * panel). Legacy standalone-task statuses (new/acknowledged/awaiting) remain
 * supported for old records.
 */
export const TASK_STATUS_META = {
  queue: { label: "Control Room Queue", short: "Queue", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  assigned: { label: "Assigned", short: "Assigned", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  in_progress: { label: "In Progress", short: "In Progress", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  awaiting_verification: { label: "Awaiting Control Room Verification", short: "Awaiting Verification", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  reopened: { label: "Reopened — Needs Attention", short: "Reopened", cls: "bg-orange-500/15 text-orange-300 border-orange-500/30" },
  overdue: { label: "Overdue / Outstanding", short: "Overdue", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  completed: { label: "Completed", short: "Completed", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  cancelled: { label: "Cancelled", short: "Cancelled", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  new: { label: "Scheduled", short: "Scheduled", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  acknowledged: { label: "Acknowledged", short: "Ack", cls: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30" },
  awaiting: { label: "Awaiting", short: "Awaiting", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
};

export const PRIORITY_META = {
  low: { label: "Low", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  medium: { label: "Medium", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  high: { label: "High", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  critical: { label: "Critical", cls: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

export const TASK_OPEN_STATUSES = [
  "queue", "assigned", "in_progress", "awaiting_verification", "reopened",
  "new", "acknowledged", "awaiting", "overdue",
];

export const TASK_INCOMPLETE_STATUSES = [
  "queue", "assigned", "in_progress", "awaiting_verification", "reopened", "overdue",
];

/** Operator queue tabs: [key, label, status filter predicate] */
export const QUEUE_TABS = [
  ["unassigned", "Unassigned", (t) => t.status === "queue"],
  ["assigned", "Assigned", (t) => t.status === "assigned"],
  ["in_progress", "In Progress", (t) => t.status === "in_progress" || t.status === "reopened"],
  ["verification", "Awaiting Verification", (t) => t.status === "awaiting_verification"],
  ["overdue", "Overdue", (t) => t.status === "overdue"],
  ["completed", "Completed", (t) => t.status === "completed"],
  ["all", "All", () => true],
];

/** Today's SAST date (YYYY-MM-DD) — matches the server's SAST window maths. */
export function sastToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}