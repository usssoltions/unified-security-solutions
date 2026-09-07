import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ClipboardList, Plus, Search } from "lucide-react";
import ScheduledTaskForm from "@/components/tasks/ScheduledTaskForm";
import ScheduledTaskCard, { TASK_OPEN_STATUSES } from "@/components/tasks/ScheduledTaskCard";

/**
 * Scheduled Tasks — operational task scheduling, SEPARATE from guard shift
 * scheduling. All data flows through the scheduledTaskAccess gateway, which
 * resolves the caller's tenant server-side: guards see only their own tasks,
 * tenant admins/ops manage their own customer's tasks, and cross-tenant
 * access fails closed.
 */
export default function ScheduledTasks() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("active");
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [completing, setCompleting] = useState(null);
  const [completionNotes, setCompletionNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["scheduledTasks", user?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("scheduledTaskAccess", { action: "list" });
      return res?.data ?? res;
    },
    enabled: !!user,
  });

  const tasks = data?.tasks || [];
  const sites = data?.sites || [];
  const users = data?.users || [];
  const canManage = !!data?.can_manage;

  const tabs = canManage
    ? [["active", "Active"], ["overdue", "Overdue"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]]
    : [["active", "My Open Tasks"], ["completed", "Completed"], ["all", "All"]];

  const filtered = useMemo(() => {
    let list = tasks;
    if (tab === "active") list = list.filter((t) => TASK_OPEN_STATUSES.includes(t.status));
    else if (tab !== "all") list = list.filter((t) => t.status === tab);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((t) =>
      (t.title || "").toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q));
    if (siteFilter !== "all") list = list.filter((t) => t.site_id === siteFilter);
    return [...list].sort((a, b) => tab === "active"
      ? String(a.scheduled_at || a.scheduled_date || "").localeCompare(String(b.scheduled_at || b.scheduled_date || ""))
      : String(b.created_date || "").localeCompare(String(a.created_date || "")));
  }, [tasks, tab, search, siteFilter]);

  const act = async (payload, successMsg) => {
    try {
      const res = await base44.functions.invoke("scheduledTaskAccess", payload);
      const d = res?.data ?? res;
      if (!d || d.error) throw new Error(d?.error || "The action failed. Please try again.");
      qc.invalidateQueries({ queryKey: ["scheduledTasks"] });
      if (successMsg) toast({ title: successMsg });
      return d;
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || "The action failed. Please try again.";
      toast({ title: msg, variant: "destructive" });
      throw e;
    }
  };

  const submitTask = async (payload) => {
    setSaving(true);
    try {
      const d = await act(
        payload.id ? { action: "update", ...payload } : { action: "create", ...payload },
        payload.id ? "Task updated" : (d => d)(null) || "Task created"
      );
      if (d?.occurrences_generated > 0) {
        toast({ title: `Recurring task created`, description: `${d.occurrences_generated} upcoming occurrences scheduled.` });
      }
      setShowForm(false);
      setEditing(null);
    } catch (_) {
      // act already surfaced the error
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (!completing) return;
    setSaving(true);
    try {
      await act({ action: "complete", id: completing.id, completion_notes: completionNotes.trim() || undefined }, "Task completed");
      setCompleting(null);
      setCompletionNotes("");
    } catch (_) {
    } finally {
      setSaving(false);
    }
  };

  const openComplete = (task) => {
    if (task.completion_notes_required) {
      setCompleting(task);
      setCompletionNotes("");
    } else {
      act({ action: "complete", id: task.id }, "Task completed").catch(() => {});
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Scheduled Tasks</h1>
            <p className="text-sm text-slate-400">
              {canManage ? "Operational task schedule for your organisation" : "Tasks assigned to you"}
            </p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => { setEditing(null); setShowForm(true); }}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white h-11 px-5">
            <Plus className="w-4 h-4" /> New Task
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..." className="pl-9 bg-slate-800/70 border-slate-700 text-white h-11" />
        </div>
        {canManage && sites.length > 0 && (
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700 text-white h-11 w-full sm:w-56">
              <SelectValue placeholder="All sites" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
              <SelectItem value="all" className="text-white">All sites</SelectItem>
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 h-9 rounded-lg text-sm font-medium whitespace-nowrap border transition-colors ${tab === key ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800/60 border-slate-700 text-slate-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-slate-600 border-t-sky-500 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No tasks here</p>
          <p className="text-slate-500 text-sm mt-1">
            {canManage ? "Create a task to schedule operational work." : "You have no tasks matching this view."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task) => (
            <ScheduledTaskCard
              key={task.id}
              task={task}
              canManage={canManage}
              isAssignee={task.assigned_to === user?.id}
              onStart={() => act({ action: "start", id: task.id }, "Task started").catch(() => {})}
              onComplete={() => openComplete(task)}
              onEdit={() => { setEditing(task); setShowForm(true); }}
              onCancel={() => {
                if (window.confirm(`Cancel "${task.title}"?`)) {
                  act({ action: "cancel", id: task.id }, "Task cancelled").catch(() => {});
                }
              }}
            />
          ))}
        </div>
      )}

      <ScheduledTaskForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        onSubmit={submitTask}
        saving={saving}
        sites={sites}
        users={users}
        task={editing}
      />

      <Dialog open={!!completing} onOpenChange={(o) => !o && setCompleting(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">Complete Task</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <p className="text-sm text-slate-400">{completing?.title}</p>
            <Label className="text-slate-300">Completion notes (required)</Label>
            <Textarea rows={3} value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="What was done / outcome"
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleting(null)}
              className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
            <Button onClick={handleComplete} disabled={saving || !completionNotes.trim()}
              className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
              {saving ? "Saving..." : "Mark Completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}