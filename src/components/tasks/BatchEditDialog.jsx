import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { getTaskTypes } from "@/lib/taskTypes";

const SUPERVISOR_ROLES = ["dispatcher", "admin", "customer_admin"];
const RECURRENCES = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["weekdays", "Selected weekdays"],
  ["monthly", "Monthly"],
  ["custom", "Custom interval"],
];
const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
const PRIORITIES = ["low", "medium", "high", "critical"];
const NONE_SITE = "__none__";

/**
 * EDIT a Task List (batch) — COMPLETE pre-execution editing: title,
 * description, scheduled date (once-off lists), active window, recurrence
 * (series) and embedded task items (series), plus Primary Supervisor and
 * additional notification recipients (editable at any time). The server
 * (scheduledTaskAccess updateBatch → shared/taskBatchEdit.ts) enforces the
 * execution-started lock: structural edits are rejected once the list has
 * started, collected evidence or signed off — the audit history is never
 * rewritten. Series edits propagate to pending occurrences only.
 */
export default function BatchEditDialog({ open, batch, data, act, onClose }) {
  const [supervisorId, setSupervisorId] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [recType, setRecType] = useState("none");
  const [recWeekdays, setRecWeekdays] = useState([1, 2, 3, 4, 5]);
  const [recInterval, setRecInterval] = useState(1);
  const [recEnd, setRecEnd] = useState("");
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const { user: authUser } = useAuth();
  const { data: entitlements = [] } = useModuleEntitlements(authUser?.id, authUser?.customer_id);
  const taskTypeOptions = getTaskTypes(entitlements, isPlatformAdminUser(authUser));

  React.useEffect(() => {
    if (open && batch) {
      setSupervisorId(batch.primary_supervisor_id || "");
      setRecipients(batch.additional_notification_user_ids || []);
      setTitle(batch.title || "");
      setDescription(batch.description || "");
      setScheduledDate(batch.scheduled_date || "");
      setStartTime(batch.active_start_time || "");
      setDeadlineTime(batch.deadline_time || "");
      setRecType(batch.recurrence_type && batch.recurrence_type !== "none" ? batch.recurrence_type : "none");
      setRecWeekdays((batch.recurrence_weekdays || []).length ? batch.recurrence_weekdays : [1, 2, 3, 4, 5]);
      setRecInterval(batch.recurrence_interval_days || 1);
      setRecEnd(batch.recurrence_end_date || "");
      setItems((batch.task_definitions || []).map((d) => ({ ...d, site_id: d.site_id || NONE_SITE })));
    }
  }, [open, batch]);

  if (!batch) return null;

  const isSeries = !!batch.is_series;
  const staff = data?.staff || [];
  const sites = data?.sites || [];
  const supervisors = staff.filter((u) => SUPERVISOR_ROLES.includes(u.role_type));
  const toggleRecipient = (id) => setRecipients((r) =>
    r.includes(id) ? r.filter((x) => x !== id) : [...r, id]);
  const toggleWeekday = (day) => setRecWeekdays((w) =>
    w.includes(day) ? w.filter((d) => d !== day) : [...w, day]);

  const setItem = (i, key, value) => setItems((list) => list.map((it, idx) =>
    idx === i ? { ...it, [key]: value } : it));
  const removeItem = (i) => setItems((list) => list.filter((_, idx) => idx !== i));
  const addItem = () => setItems((list) => [...list, {
    title: "", description: null, task_type: "other", priority: "medium",
    site_id: NONE_SITE, scheduled_time: null, due_time: null,
    completion_notes_required: false, evidence_required: false,
  }]);

  const cleanItem = (d) => ({
    title: String(d.title || "").trim(),
    description: (d.description || "").trim() || null,
    task_type: d.task_type || "other",
    priority: PRIORITIES.includes(d.priority) ? d.priority : "medium",
    site_id: d.site_id && d.site_id !== NONE_SITE ? d.site_id : null,
    site_name: d.site_id && d.site_id !== NONE_SITE ? (sites.find((s) => s.id === d.site_id)?.name || d.site_name || null) : null,
    scheduled_time: d.scheduled_time || null,
    due_time: d.due_time || null,
    completion_notes_required: !!d.completion_notes_required,
    evidence_required: !!d.evidence_required,
  });

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        action: "updateBatch", id: batch.id,
        primary_supervisor_id: supervisorId,
        additional_notification_user_ids: recipients,
      };
      if (title.trim() && title.trim() !== (batch.title || "")) payload.title = title.trim();
      if ((description || "") !== (batch.description || "")) payload.description = description.trim() || null;
      if (!isSeries && scheduledDate && scheduledDate !== (batch.scheduled_date || "")) payload.scheduled_date = scheduledDate;
      if ((startTime && startTime !== (batch.active_start_time || "")) || (deadlineTime && deadlineTime !== (batch.deadline_time || ""))) {
        payload.active_start_time = startTime || batch.active_start_time;
        payload.deadline_time = deadlineTime || batch.deadline_time;
      }
      if (isSeries) {
        if (recType && recType !== (batch.recurrence_type || "none")) payload.recurrence_type = recType;
        if (recType === "weekdays" && JSON.stringify(recWeekdays) !== JSON.stringify(batch.recurrence_weekdays || [])) {
          payload.recurrence_weekdays = recWeekdays;
        }
        if (recType === "custom" && (Number(recInterval) || 1) !== (batch.recurrence_interval_days || 1)) {
          payload.recurrence_interval_days = Number(recInterval) || 1;
        }
        if ((recEnd || "") !== (batch.recurrence_end_date || "")) payload.recurrence_end_date = recEnd || null;
        const cleaned = items.map(cleanItem).filter((d) => d.title);
        if (JSON.stringify(cleaned) !== JSON.stringify(batch.task_definitions || [])) {
          payload.task_definitions = cleaned;
        }
      }
      await act(payload, "Task list updated");
      onClose();
    } catch (_) {} finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Pencil className="w-5 h-5 text-sky-400" /> Edit Task List
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400 -mt-1 truncate">“{batch.title}”</p>
        <p className="text-xs text-slate-500 -mt-1">
          Structure (title, date, window, recurrence, task items) is editable only while execution has not started — the server locks it once tasks run, to protect audit history.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-slate-300">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white h-11" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-slate-300">Description / instructions</Label>
            <Textarea rows={2} value={description || ""} onChange={(e) => setDescription(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!isSeries && (
              <div className="space-y-1.5">
                <Label className="text-slate-300">Date</Label>
                <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white h-11" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-slate-300">Window start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Deadline</Label>
              <Input type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)}
                className="bg-slate-800 border-slate-700 text-white h-11" />
            </div>
          </div>

          {isSeries && (
            <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-800/30 p-3">
              <Label className="text-slate-300">Recurrence</Label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={recType} onValueChange={setRecType}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                    {RECURRENCES.map(([v, l]) => (
                      <SelectItem key={v} value={v} className="text-white">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {recType === "custom" && (
                  <Input type="number" min="1" value={recInterval}
                    onChange={(e) => setRecInterval(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white h-10" placeholder="Every N days" />
                )}
                <Input type="date" value={recEnd} onChange={(e) => setRecEnd(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white h-10 col-span-2" />
              </div>
              {recType === "weekdays" && (
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map(([d, l]) => (
                    <button key={d} type="button" onClick={() => toggleWeekday(d)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${recWeekdays.includes(d) ? "bg-sky-600 border-sky-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400"}`}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isSeries && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-slate-300">Task items</Label>
                <Button type="button" size="sm" variant="outline" onClick={addItem}
                  className="border-slate-600 text-slate-200 h-8">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-2.5 space-y-2">
                    <div className="flex gap-2">
                      <Input value={it.title || ""} onChange={(e) => setItem(i, "title", e.target.value)}
                        placeholder="Task title" className="bg-slate-800 border-slate-700 text-white h-9 text-sm flex-1" />
                      <button type="button" onClick={() => removeItem(i)}
                        className="w-9 h-9 shrink-0 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Input type="time" value={it.scheduled_time || ""} onChange={(e) => setItem(i, "scheduled_time", e.target.value || null)}
                        className="bg-slate-800 border-slate-700 text-white h-9 text-xs" placeholder="Start" />
                      <Input type="time" value={it.due_time || ""} onChange={(e) => setItem(i, "due_time", e.target.value || null)}
                        className="bg-slate-800 border-slate-700 text-white h-9 text-xs" placeholder="Due" />
                      <Select value={it.priority || "medium"} onValueChange={(v) => setItem(i, "priority", v)}>
                        <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                          {PRIORITIES.map((p) => <SelectItem key={p} value={p} className="text-white capitalize">{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <Checkbox checked={!!it.completion_notes_required}
                          onCheckedChange={(v) => setItem(i, "completion_notes_required", !!v)} /> Notes required
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                        <Checkbox checked={!!it.evidence_required}
                          onCheckedChange={(v) => setItem(i, "evidence_required", !!v)} /> Evidence required
                      </label>
                      <div className="min-w-[120px] flex-1">
                        <Select value={it.site_id || NONE_SITE} onValueChange={(v) => setItem(i, "site_id", v)}>
                          <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-9 text-xs"><SelectValue placeholder="No site" /></SelectTrigger>
                          <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                            <SelectItem value={NONE_SITE} className="text-white">No site</SelectItem>
                            {sites.map((s) => <SelectItem key={s.id} value={s.id} className="text-white">{s.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <p className="text-xs text-slate-500">No task items — use Add.</p>}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5 pt-1">
          <Label className="text-slate-300">Primary supervisor *</Label>
          <Select value={supervisorId} onValueChange={setSupervisorId}>
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

        <div className="space-y-1.5">
          <Label className="text-slate-300">Additional notification recipients</Label>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800/40 divide-y divide-slate-700/50">
            {supervisors.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">No users available</div>
            )}
            {supervisors.map((u) => (
              <label key={u.id} className="flex items-center gap-2 px-3 py-2.5 text-sm text-slate-200 cursor-pointer">
                <Checkbox checked={recipients.includes(u.id)}
                  onCheckedChange={() => toggleRecipient(u.id)} />
                <span className="truncate">{u.name}</span>
                <span className="text-xs text-slate-500">({u.role_type})</span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={save} disabled={!supervisorId || saving}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}