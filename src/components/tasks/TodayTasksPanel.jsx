import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { isPageModuleEnabled } from "@/lib/moduleMapping";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { useAuth } from "@/lib/AuthContext";
import { ClipboardList, ChevronRight, AlertTriangle, Clock, UserPlus, ShieldCheck } from "lucide-react";
import { TASK_STATUS_META, sastToday } from "./taskMeta";

const PANEL_ROLES = ["admin", "dispatcher", "customer_admin", "control_room_operator", "platform_admin"];

/**
 * Control Room dashboard — compact "TODAY'S TASKS" panel. Non-blocking: sits
 * near the top of the Control Room page, shows counters + a priority list
 * (overdue → due soon → unassigned → awaiting verification) and a View All
 * Tasks link. Renders nothing when the Task Scheduling module is not enabled
 * or there are no tasks today — the rest of the dashboard is untouched.
 */
export default function TodayTasksPanel() {
  const { user } = useAuth();
  const { data: entitlements = [] } = useModuleEntitlements(user?.id, user?.customer_id);
  const enabled = isPageModuleEnabled(entitlements, "ScheduledTasks", isPlatformAdminUser(user));

  const { data } = useQuery({
    queryKey: ["scheduledTasks", user?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("scheduledTaskAccess", { action: "list" });
      return res?.data ?? res;
    },
    enabled: !!user && enabled && PANEL_ROLES.includes(user?.role_type),
    staleTime: 0,
  });

  const stats = useMemo(() => {
    const today = sastToday();
    const tasks = (data?.tasks || []).filter((t) => t.scheduled_date === today && t.status !== "cancelled");
    const completed = tasks.filter((t) => t.status === "completed");
    const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "reopened");
    const overdue = tasks.filter((t) => t.status === "overdue");
    const outstanding = tasks.filter((t) =>
      !["completed", "cancelled"].includes(t.status) && t.status !== "overdue");

    const now = Date.now();
    const priority = [
      ...overdue,
      ...tasks.filter((t) => t.due_date && new Date(t.due_date).getTime() - now < 60 * 60 * 1000
        && !["completed", "overdue"].includes(t.status)),
      ...tasks.filter((t) => t.status === "queue"),
      ...tasks.filter((t) => t.status === "awaiting_verification"),
    ].filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i).slice(0, 5);

    return { total: tasks.length, completed: completed.length, inProgress: inProgress.length,
      outstanding: outstanding.length, overdue: overdue.length, priority };
  }, [data]);

  if (!enabled || !stats.total) return null;

  const counters = [
    [stats.total, "Total", "text-white"],
    [stats.completed, "Completed", "text-emerald-400"],
    [stats.inProgress, "In Progress", "text-amber-400"],
    [stats.outstanding, "Outstanding", "text-sky-400"],
    [stats.overdue, "Overdue", "text-rose-400"],
  ];

  return (
    <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-5 h-5 text-sky-400 shrink-0" />
          <h3 className="font-semibold text-white truncate">Today's Tasks</h3>
        </div>
        <Link to="/ScheduledTasks" className="flex items-center gap-1 text-sm text-sky-400 hover:text-sky-300 font-medium shrink-0">
          View All Tasks <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="grid grid-cols-5 gap-2 mb-3">
        {counters.map(([value, label, cls]) => (
          <div key={label} className="rounded-lg bg-slate-900/60 border border-slate-700/50 px-2 py-2 text-center">
            <p className={`text-lg font-bold leading-tight ${cls}`}>{value}</p>
            <p className="text-[10px] text-slate-500 leading-tight">{label}</p>
          </div>
        ))}
      </div>
      {stats.priority.length > 0 && (
        <div className="space-y-1.5">
          {stats.priority.map((t) => {
            const meta = TASK_STATUS_META[t.status] || TASK_STATUS_META.new;
            return (
              <div key={t.id} className="flex items-center gap-2 text-sm">
                {t.status === "overdue" && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
                {t.status === "queue" && <UserPlus className="w-4 h-4 text-sky-400 shrink-0" />}
                {t.status === "awaiting_verification" && <ShieldCheck className="w-4 h-4 text-violet-400 shrink-0" />}
                {["assigned", "in_progress", "reopened"].includes(t.status) && <Clock className="w-4 h-4 text-amber-400 shrink-0" />}
                <span className="text-slate-200 truncate flex-1">{t.title}</span>
                <Badge variant="outline" className={`${meta.cls} shrink-0 text-[10px] px-2 py-0`}>
                  {meta.short || meta.label}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}