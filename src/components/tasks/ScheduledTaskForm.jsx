import React, { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Repeat } from "lucide-react";

const TASK_TYPES = [
  ["other", "General / Other"],
  ["check_guard", "Check Guard"],
  ["contact_site", "Contact Site"],
  ["verify_patrol", "Verify Patrol"],
  ["follow_up_incident", "Follow Up Incident"],
  ["review_alarm", "Review Alarm"],
  ["confirm_shift", "Confirm Shift"],
  ["contact_customer", "Contact Customer"],
];

const RECURRENCES = [
  ["none", "Does not repeat"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["weekdays", "Selected weekdays"],
  ["monthly", "Monthly"],
  ["custom", "Custom interval"],
];

const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
];

const EMPTY = {
  title: "", description: "", task_type: "other", priority: "medium",
  site_id: "", assigned_to: "", scheduled_date: "", scheduled_time: "",
  due_local: "", recurrence_type: "none", recurrence_weekdays: [1, 2, 3, 4, 5],
  recurrence_interval_days: 1, recurrence_end_date: "",
  notes: "", completion_notes_required: false,
};

/**
 * Create/Edit dialog for Scheduled Tasks. Recurrence rules are set at CREATE
 * time only — occurrences are then generated server-side (bounded, deduped).
 */
export default function ScheduledTaskForm({ open, onClose, onSubmit, saving, sites = [], users = [], task }) {
  const isEdit = !!task;
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    if (!open) return;
    setForm(task
      ? {
          title: task.title || "",
          description: task.description || "",
          task_type: task.task_type || "other",
          priority: task.priority || "medium",
          site_id: task.site_id || "",
          assigned_to: task.assigned_to || "",
          scheduled_date: task.scheduled_date || "",
          scheduled_time: task.scheduled_time || "",
          due_local: task.due_date ? String(task.due_date).slice(0, 16) : "",
          notes: task.notes || "",
          completion_notes_required: !!task.completion_notes_required,
        }
      : { ...EMPTY });
  }, [open, task]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const toggleWeekday = (day) => {
    setForm((f) => ({
      ...f,
      recurrence_weekdays: f.recurrence_weekdays.includes(day)
        ? f.recurrence_weekdays.filter((d) => d !== day)
        : [...f.recurrence_weekdays, day],
    }));
  };

  const valid = form.title.trim() && form.site_id && form.assigned_to
    && form.scheduled_date && form.scheduled_time;

  const submit = () => {
    if (!valid || saving) return;
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      task_type: form.task_type,
      priority: form.priority,
      site_id: form.site_id,
      assigned_to: form.assigned_to,
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time,
      due_date: form.due_local ? `${form.due_local}:00+02:00` : null,
      notes: form.notes.trim() || null,
      completion_notes_required: form.completion_notes_required,
    };
    if (isEdit) {
      payload.id = task.id;
    } else {
      payload.recurrence_type = form.recurrence_type;
      payload.recurrence_weekdays = form.recurrence_weekdays;
      payload.recurrence_interval_days = Number(form.recurrence_interval_days) || 1;
      payload.recurrence_end_date = form.recurrence_end_date || null;
    }
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isEdit ? "Edit Scheduled Task" : "New Scheduled Task"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Task title *</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Unlock training hall and run equipment check" className="bg-slate-800 border-slate-700 text-white" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Site *</Label>
              <Select value={form.site_id} onValueChange={(v) => set("site_id", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                  {sites.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No active sites</div>}
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Assign to *</Label>
              <Select value={form.assigned_to} onValueChange={(v) => set("assigned_to", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 z-[60] max-h-64">
                  {users.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No assignable users</div>}
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-white">{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Scheduled date *</Label>
              <Input type="date" value={form.scheduled_date}
                onChange={(e) => set("scheduled_date", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Time *</Label>
              <Input type="time" value={form.scheduled_time}
                onChange={(e) => set("scheduled_time", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Due (optional)</Label>
              <Input type="datetime-local" value={form.due_local}
                onChange={(e) => set("due_local", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                  <SelectItem value="low" className="text-white">Low</SelectItem>
                  <SelectItem value="medium" className="text-white">Medium</SelectItem>
                  <SelectItem value="high" className="text-white">High</SelectItem>
                  <SelectItem value="critical" className="text-white">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">Task type</Label>
            <Select value={form.task_type} onValueChange={(v) => set("task_type", v)}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                {TASK_TYPES.map(([value, label]) => (
                  <SelectItem key={value} value={value} className="text-white">{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">Description / instructions</Label>
            <Textarea rows={3} value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What must be done, and any instructions"
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>

          {!isEdit && (
            <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <Repeat className="w-4 h-4 text-sky-400" /> Recurrence
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Repeats</Label>
                  <Select value={form.recurrence_type} onValueChange={(v) => set("recurrence_type", v)}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                      {RECURRENCES.map(([value, label]) => (
                        <SelectItem key={value} value={value} className="text-white">{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.recurrence_type !== "none" && (
                  <div className="space-y-1.5">
                    <Label className="text-slate-300">End date (optional)</Label>
                    <Input type="date" value={form.recurrence_end_date}
                      onChange={(e) => set("recurrence_end_date", e.target.value)}
                      className="bg-slate-800 border-slate-700 text-white" />
                  </div>
                )}
              </div>
              {form.recurrence_type === "weekdays" && (
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map(([day, label]) => (
                    <button key={day} type="button" onClick={() => toggleWeekday(day)}
                      className={`h-10 w-12 rounded-lg text-xs font-medium border transition-colors ${form.recurrence_weekdays.includes(day) ? "bg-sky-500/20 border-sky-500/50 text-sky-300" : "bg-slate-800 border-slate-700 text-slate-400"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {form.recurrence_type === "custom" && (
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Repeat every (days)</Label>
                  <Input type="number" min={1} value={form.recurrence_interval_days}
                    onChange={(e) => set("recurrence_interval_days", e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white w-32" />
                </div>
              )}
              <p className="text-xs text-slate-500">
                Occurrences are generated for the next 30 days (or until the end date) and topped up automatically — never duplicated.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-slate-300">Notes</Label>
            <Textarea rows={2} value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional notes for the assignee"
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox id="cnr" checked={form.completion_notes_required}
              onCheckedChange={(v) => set("completion_notes_required", !!v)} />
            <Label htmlFor="cnr" className="text-slate-300 text-sm">Require completion notes when the task is completed</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}