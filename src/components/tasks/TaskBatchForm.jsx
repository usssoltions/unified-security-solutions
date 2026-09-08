import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X, Repeat, ClipboardList } from "lucide-react";
import { sastToday } from "./taskMeta";

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
  ["none", "Once-off"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["weekdays", "Selected weekdays"],
  ["monthly", "Monthly"],
  ["custom", "Custom interval"],
];
const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"],
];
const SUPERVISOR_ROLES = ["dispatcher", "admin", "customer_admin"];

const EMPTY = {
  control_room_id: "", title: "", description: "",
  scheduled_date: sastToday(), active_start_time: "08:00", deadline_time: "16:00",
  recurrence_type: "none", recurrence_weekdays: [1, 2, 3, 4, 5],
  recurrence_interval_days: 1, recurrence_end_date: "",
  primary_supervisor_id: "", additional_notification_user_ids: [],
};

const EMPTY_TASK = {
  title: "", description: "", task_type: "other", priority: "medium",
  site_id: "", scheduled_time: "", due_time: "",
  completion_notes_required: false, evidence_required: false,
};

/**
 * Create a TASK LIST (TaskBatch) allocated to a specific Control Room, with
 * embedded task items. The list enters the control room's queue — tasks are
 * NOT directly assigned to guards; the Control Room Operator allocates them.
 * Primary Supervisor is required; additional recipients optional (same
 * customer only — validated server-side).
 */
export default function TaskBatchForm({ open, onClose, onSubmit, data, saving }) {
  const [form, setForm] = useState(EMPTY);
  const [tasks, setTasks] = useState([{ ...EMPTY_TASK }]);

  React.useEffect(() => {
    if (!open) return;
    setForm({ ...EMPTY, scheduled_date: sastToday() });
    setTasks([{ ...EMPTY_TASK }]);
  }, [open]);

  const controlRooms = (data?.control_rooms || []).filter((r) => r.status !== "inactive");
  const sites = data?.sites || [];
  const staff = data?.staff || [];
  const supervisors = staff.filter((u) => SUPERVISOR_ROLES.includes(u.role_type));

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setTask = (i, key, value) => setTasks((ts) =>
    ts.map((t, idx) => (idx === i ? { ...t, [key]: value } : t)));
  const addTask = () => setTasks((ts) => [...ts, { ...EMPTY_TASK }]);
  const removeTask = (i) => setTasks((ts) => (ts.length > 1 ? ts.filter((_, idx) => idx !== i) : ts));
  const toggleRecipient = (id) => setForm((f) => ({
    ...f,
    additional_notification_user_ids: f.additional_notification_user_ids.includes(id)
      ? f.additional_notification_user_ids.filter((x) => x !== id)
      : [...f.additional_notification_user_ids, id],
  }));
  const toggleWeekday = (day) => setForm((f) => ({
    ...f,
    recurrence_weekdays: f.recurrence_weekdays.includes(day)
      ? f.recurrence_weekdays.filter((d) => d !== day)
      : [...f.recurrence_weekdays, day],
  }));

  const valid = form.control_room_id && form.title.trim() && form.scheduled_date
    && form.active_start_time && form.deadline_time && form.primary_supervisor_id
    && tasks.every((t) => t.title.trim());

  const submit = () => {
    if (!valid || saving) return;
    onSubmit({
      ...form,
      title: form.title.trim(),
      description: form.description.trim() || null,
      recurrence_end_date: form.recurrence_end_date || null,
      task_definitions: tasks.map((t) => ({
        title: t.title.trim(),
        description: t.description.trim() || null,
        task_type: t.task_type,
        priority: t.priority,
        site_id: t.site_id || null,
        scheduled_time: t.scheduled_time || null,
        due_time: t.due_time || null,
        completion_notes_required: !!t.completion_notes_required,
        evidence_required: !!t.evidence_required,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-sky-400" /> New Task List
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Control Room *</Label>
              <Select value={form.control_room_id} onValueChange={(v) => set("control_room_id", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                  <SelectValue placeholder={controlRooms.length ? "Select control room" : "No control rooms"} />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                  {controlRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-white">{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Task list title *</Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Daily Operational Tasks"
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Date *</Label>
              <Input type="date" value={form.scheduled_date}
                onChange={(e) => set("scheduled_date", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Window start *</Label>
              <Input type="time" value={form.active_start_time}
                onChange={(e) => set("active_start_time", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Deadline *</Label>
              <Input type="time" value={form.deadline_time}
                onChange={(e) => set("deadline_time", e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Primary supervisor *</Label>
              <Select value={form.primary_supervisor_id} onValueChange={(v) => set("primary_supervisor_id", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                  {supervisors.map((u) => (
                    <SelectItem key={u.id} value={u.id} className="text-white">{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">Additional notification recipients (optional)</Label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/40 divide-y divide-slate-700/50">
              {supervisors.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">No users available</div>}
              {supervisors.map((u) => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-200 cursor-pointer">
                  <Checkbox checked={form.additional_notification_user_ids.includes(u.id)}
                    onCheckedChange={() => toggleRecipient(u.id)} />
                  <span className="truncate">{u.name}</span>
                  <span className="text-xs text-slate-500">({u.role_type})</span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Repeat className="w-4 h-4 text-sky-400" /> Recurrence
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Repeats</Label>
                <Select value={form.recurrence_type} onValueChange={(v) => set("recurrence_type", v)}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11"><SelectValue /></SelectTrigger>
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
                    className="bg-slate-800 border-slate-700 text-white h-11" />
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
                  className="bg-slate-800 border-slate-700 text-white w-32 h-11" />
              </div>
            )}
            {form.recurrence_type !== "none" && (
              <p className="text-xs text-slate-500">
                Occurrences are generated for the next 30 days (or until the end date) and topped up automatically — never duplicated.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-slate-300">Tasks ({tasks.length})</Label>
            {tasks.map((t, i) => (
              <div key={i} className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400 shrink-0">#{i + 1}</span>
                  <Input value={t.title} onChange={(e) => setTask(i, "title", e.target.value)}
                    placeholder="Task title *"
                    className="bg-slate-800 border-slate-700 text-white h-11" />
                  {tasks.length > 1 && (
                    <button type="button" onClick={() => removeTask(i)}
                      className="w-9 h-9 rounded-lg bg-slate-800 border border-slate-700 text-rose-400 flex items-center justify-center shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Textarea rows={2} value={t.description} onChange={(e) => setTask(i, "description", e.target.value)}
                  placeholder="Detailed instructions (optional)"
                  className="bg-slate-800 border-slate-700 text-white resize-none" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-slate-400 text-xs">Type</Label>
                    <Select value={t.task_type} onValueChange={(v) => setTask(i, "task_type", v)}>
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-10 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                        {TASK_TYPES.map(([value, label]) => (
                          <SelectItem key={value} value={value} className="text-white">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-400 text-xs">Priority</Label>
                    <Select value={t.priority} onValueChange={(v) => setTask(i, "priority", v)}>
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-10 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                        {["low", "medium", "high", "critical"].map((p) => (
                          <SelectItem key={p} value={p} className="text-white capitalize">{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-slate-400 text-xs">Site / area (optional)</Label>
                    <Select value={t.site_id} onValueChange={(v) => setTask(i, "site_id", v)}>
                      <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-10 text-xs">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                        <SelectItem value={null} className="text-white">None</SelectItem>
                        {sites.map((s) => (
                          <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-slate-400 text-xs">Start (opt)</Label>
                      <Input type="time" value={t.scheduled_time}
                        onChange={(e) => setTask(i, "scheduled_time", e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white h-10 text-xs px-2" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-slate-400 text-xs">Due (opt)</Label>
                      <Input type="time" value={t.due_time}
                        onChange={(e) => setTask(i, "due_time", e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white h-10 text-xs px-2" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <Checkbox checked={t.completion_notes_required}
                      onCheckedChange={(v) => setTask(i, "completion_notes_required", !!v)} />
                    Require completion notes
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <Checkbox checked={t.evidence_required}
                      onCheckedChange={(v) => setTask(i, "evidence_required", !!v)} />
                    Require evidence
                  </label>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addTask} className="w-full h-11 bg-slate-800 border-slate-700 text-slate-200">
              <Plus className="w-4 h-4" /> Add Task
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">Description (optional)</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)}
              placeholder="Purpose of this task list"
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Creating..." : "Create Task List"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}