import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OB_WEEKDAYS } from "./obMeta";

const EMPTY = {
  title: "", category: "", instructions: "", scope: "overall", control_room_id: "",
  site_id: "", assigned_operator_id: "", cadence: "interval", every_n_minutes: "60",
  specified_times: [], active_days: [], start_date: "", end_date: "",
  window_start: "06:00", window_end: "18:00", window_end_inclusive: true,
  overdue_grace_minutes: "15", escalation_delay_minutes: "30", evidence_required: false,
};

/**
 * OB schedule create/edit dialog. Validation is server-enforced by obAccess —
 * the form just collects the fields and lets the gateway fail closed.
 */
export default function OBScheduleFormDialog({ open, onClose, onSubmit, editing, rooms, sites, operators, saving }) {
  const [f, setF] = useState(EMPTY);
  const [timesText, setTimesText] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setF({
        ...EMPTY, ...editing,
        every_n_minutes: editing.every_n_minutes != null ? String(editing.every_n_minutes) : "60",
        overdue_grace_minutes: String(editing.overdue_grace_minutes ?? 15),
        escalation_delay_minutes: String(editing.escalation_delay_minutes ?? 30),
        specified_times: editing.specified_times || [],
      });
      setTimesText((editing.specified_times || []).join(", "));
    } else {
      setF({ ...EMPTY, start_date: new Date().toISOString().slice(0, 10) });
      setTimesText("");
    }
  }, [open, editing]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const toggleDay = (d) => setF((p) => ({
    ...p,
    active_days: p.active_days.includes(d) ? p.active_days.filter((x) => x !== d) : p.active_days.concat(d).sort(),
  }));

  const payload = () => ({
    action: "schedule_save",
    id: editing ? editing.id : undefined,
    schedule: {
      ...f,
      every_n_minutes: Number(f.every_n_minutes),
      overdue_grace_minutes: Number(f.overdue_grace_minutes),
      escalation_delay_minutes: Number(f.escalation_delay_minutes),
      specified_times: f.cadence === "times"
        ? timesText.split(",").map((t) => t.trim()).filter(Boolean)
        : [],
      active_days: (f.active_days || []).map(Number),
      window_end_inclusive: f.window_end_inclusive !== false,
      evidence_required: f.evidence_required === true,
      site_id: f.scope === "site" ? f.site_id : null,
      assigned_operator_id: f.assigned_operator_id || null,
    },
  });

  const valid = f.title.trim() && f.control_room_id && f.start_date &&
    (f.cadence === "interval" ? Number(f.every_n_minutes) > 0 : timesText.trim().length > 0) &&
    (f.scope === "overall" || f.site_id);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit OB Schedule" : "New OB Schedule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-slate-300">Check title</Label>
            <Input value={f.title} onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Electric fence patrol check" className="bg-slate-800 border-slate-700" />
          </div>
          <div>
            <Label className="text-slate-300">Instructions</Label>
            <Textarea value={f.instructions} onChange={(e) => set("instructions", e.target.value)} rows={2}
              placeholder="Exactly what the controller must perform and observe" className="bg-slate-800 border-slate-700" />
          </div>
          <div>
            <Label className="text-slate-300">Category (optional)</Label>
            <Input value={f.category} onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Security, Fire" className="bg-slate-800 border-slate-700" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-300">Control room</Label>
              <Select value={f.control_room_id} onValueChange={(v) => set("control_room_id", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Select room" /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {(rooms || []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300">Scope</Label>
              <Select value={f.scope} onValueChange={(v) => set("scope", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="overall">Overall (no site)</SelectItem>
                  <SelectItem value="site">Specific site</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {f.scope === "site" && (
            <div>
              <Label className="text-slate-300">Site</Label>
              <Select value={f.site_id} onValueChange={(v) => set("site_id", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue placeholder="Select site" /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {(sites || []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-slate-300">Assigned operator (optional — every authorised operator otherwise)</Label>
            <Select value={f.assigned_operator_id || "any"} onValueChange={(v) => set("assigned_operator_id", v === "any" ? "" : v)}>
              <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="any">Any authorised operator</SelectItem>
                {(operators || []).map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-300">Cadence</Label>
              <Select value={f.cadence} onValueChange={(v) => set("cadence", v)}>
                <SelectTrigger className="bg-slate-800 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="interval">Every N minutes</SelectItem>
                  <SelectItem value="times">Specified times</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {f.cadence === "interval" ? (
              <div>
                <Label className="text-slate-300">Every (minutes)</Label>
                <Input type="number" min="1" value={f.every_n_minutes}
                  onChange={(e) => set("every_n_minutes", e.target.value)} className="bg-slate-800 border-slate-700" />
              </div>
            ) : (
              <div>
                <Label className="text-slate-300">Times (HH:MM, comma-separated)</Label>
                <Input value={timesText} onChange={(e) => setTimesText(e.target.value)}
                  placeholder="06:00, 12:00, 18:00" className="bg-slate-800 border-slate-700" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-300">Window start</Label>
              <Input type="time" value={f.window_start} onChange={(e) => set("window_start", e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-slate-300">Window end</Label>
              <Input type="time" value={f.window_end} onChange={(e) => set("window_end", e.target.value)} className="bg-slate-800 border-slate-700" />
              <p className="text-[11px] text-slate-500 mt-0.5">Earlier than start = overnight window.</p>
            </div>
          </div>

          <div>
            <Label className="text-slate-300">Active days (none = every day)</Label>
            <div className="flex gap-1 flex-wrap mt-1">
              {OB_WEEKDAYS.map((d) => (
                <button key={d.value} type="button" onClick={() => toggleDay(d.value)}
                  className={`w-11 h-8 rounded-lg text-xs font-medium border transition-colors ${
                    f.active_days.includes(d.value)
                      ? "bg-sky-500/20 border-sky-500/50 text-sky-300"
                      : "bg-slate-800 border-slate-700 text-slate-400"}`}>
                  {d.short}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-300">Start date</Label>
              <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-slate-300">End date (optional)</Label>
              <Input type="date" value={f.end_date || ""} onChange={(e) => set("end_date", e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-300">Overdue grace (min)</Label>
              <Input type="number" min="0" value={f.overdue_grace_minutes}
                onChange={(e) => set("overdue_grace_minutes", e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-slate-300">Escalation delay (min)</Label>
              <Input type="number" min="0" value={f.escalation_delay_minutes}
                onChange={(e) => set("escalation_delay_minutes", e.target.value)} className="bg-slate-800 border-slate-700" />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={f.evidence_required === true}
              onChange={(e) => set("evidence_required", e.target.checked)} className="accent-sky-500 w-4 h-4" />
            <span className="text-sm text-slate-300">Evidence required to record this check</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600 text-slate-300">Cancel</Button>
          <Button onClick={() => onSubmit(payload())} disabled={!valid || saving} className="min-w-[110px]">
            {saving ? "Saving…" : editing ? "Save Changes" : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}