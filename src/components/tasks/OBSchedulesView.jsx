import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CalendarClock, Plus, Pause, Play, Ban, Pencil, History, Loader2,
} from "lucide-react";
import OBScheduleFormDialog from "./OBScheduleFormDialog";
import { cadenceSummary, scheduleScopeLabel, statusLabel, OB_WEEKDAYS } from "./obMeta";

/**
 * OB SCHEDULES (admins/supervisors) — create, edit, pause, resume and cancel
 * the customer's OB check schedules. All changes flow through the obAccess
 * gateway (schedule_save / schedule_status) which appends the audit history.
 */
export default function OBSchedulesView({ ob, act, refresh }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusId, setStatusId] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);

  const schedules = ob?.schedules || [];
  const rooms = ob?.rooms || [];
  const roomNameOf = (id) => (rooms.find((r) => r.id === id) || {}).name;

  const sorted = useMemo(() =>
    schedules.slice().sort((a, b) =>
      (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) ||
      String(a.title || "").localeCompare(String(b.title || ""))),
    [schedules]);

  const status = async (id, wanted, reason) => {
    setStatusId(id);
    try {
      await act({ action: "schedule_status", id, status: wanted, reason: reason || undefined },
        wanted === "active" ? "Schedule resumed" : wanted === "paused" ? "Schedule paused" : "Schedule cancelled");
      if (refresh) refresh();
    } catch (_) {} finally { setStatusId(null); }
  };

  const save = async (payload) => {
    setSaving(true);
    try {
      const d = await act(payload, editing ? "Schedule updated" : "Schedule created");
      setFormOpen(false); setEditing(null);
      if (refresh && d?.schedule) refresh();
    } catch (_) {} finally { setSaving(false); }
  };

  const statusBadge = (s) => {
    const map = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
      paused: "bg-amber-500/15 text-amber-400 border-amber-500/40",
      cancelled: "bg-slate-600/30 text-slate-400 border-slate-600/50",
    };
    return <Badge variant="outline" className={map[s.status] || "border-slate-600 text-slate-400"}>{statusLabel(s.status)}</Badge>;
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <CalendarClock className="w-6 h-6 text-sky-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-white">OB Schedules</h1>
            <p className="text-sm text-slate-400">{schedules.length} schedule{schedules.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="shrink-0 active:scale-95">
          <Plus className="w-4 h-4" /> New Schedule
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <CalendarClock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">No OB schedules yet</p>
          <p className="text-slate-500 text-sm mt-1">Create a schedule to generate recurring Occurrence Book checks.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((s) => {
            const busy = statusId === s.id;
            const days = (s.active_days || []);
            return (
              <div key={s.id} className="rounded-xl border bg-slate-900/60 border-slate-800 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{s.title}</p>
                      {statusBadge(s)}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {scheduleScopeLabel(s, roomNameOf)} · {cadenceSummary(s)}
                      {s.assigned_operator_name ? " · " + s.assigned_operator_name : ""}
                      {s.evidence_required ? " · evidence required" : ""}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {days.length ? "Days: " + days.map((d) => (OB_WEEKDAYS.find((w) => w.value === d) || {}).short).join(", ") : "Every day"}
                      {s.start_date ? " · from " + s.start_date : ""}{s.end_date ? " to " + s.end_date : ""}
                      {s.status === "active" && (s.next_slots || []).length ? " · next: " + s.next_slots.map((x) => x.slot_label).join(", ") : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : (
                      <>
                        {s.status !== "cancelled" && (
                          <Button size="sm" variant="outline" onClick={() => { setEditing(s); setFormOpen(true); }}
                            className="border-slate-600 text-slate-300 h-8 px-2" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {s.status === "active" && (
                          <Button size="sm" variant="outline" onClick={() => status(s.id, "paused")}
                            className="border-amber-500/40 text-amber-400 h-8 px-2" title="Pause">
                            <Pause className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {s.status === "paused" && (
                          <Button size="sm" variant="outline" onClick={() => status(s.id, "active")}
                            className="border-emerald-500/40 text-emerald-400 h-8 px-2" title="Resume">
                            <Play className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {s.status !== "cancelled" && (
                          <Button size="sm" variant="outline" onClick={() => status(s.id, "cancelled")}
                            className="border-rose-500/40 text-rose-400 h-8 px-2" title="Cancel">
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Change history */}
      {sorted.some((s) => (s.change_history || []).length > 0) && (
        <div className="mt-6">
          <button onClick={() => setHistoryOf(historyOf === false ? null : false)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-300">
            <History className="w-4 h-4" /> Schedule change history
          </button>
        </div>
      )}
      {historyOf === false && (
        <div className="mt-3 space-y-3">
          {sorted.filter((s) => (s.change_history || []).length > 0).map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-sm font-semibold text-slate-200">{s.title}</p>
              <div className="mt-2 space-y-1">
                {(s.change_history || []).slice().reverse().map((h, i) => (
                  <p key={i} className="text-xs text-slate-400">
                    {new Date(h.timestamp).toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {" — "}{h.action}{h.actor_name ? " by " + h.actor_name : ""}{h.notes ? " · " + h.notes : ""}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <OBScheduleFormDialog
        open={formOpen} editing={editing} saving={saving}
        rooms={rooms} sites={ob?.sites || []} operators={ob?.operators || []}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSubmit={save}
      />
    </div>
  );
}