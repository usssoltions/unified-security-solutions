/**
 * BatchShiftAcknowledgeModal
 * Lets a guard review and respond to MANY scheduled shifts at once (a full
 * week or month of assignments) with a single signature applied to every
 * selected shift. Mirrors the single ShiftAcknowledgeModal flow but operates
 * on a batch via Shift.bulkUpdate + one consolidated management notification.
 *
 * Records kept per shift: guard_ack_status, guard_ack_note, guard_ack_at,
 * guard_ack_signature — the same audit fields as the single-shift flow.
 */
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getUserDisplayName } from "@/lib/userDisplayName";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2, XCircle, RefreshCw, X, Loader2, PenTool, MapPin, Clock
} from "lucide-react";
import SignaturePad from "@/components/guard/SignaturePad";
import WhatsAppNotifier from "@/components/WhatsAppNotifier";

const STATUS_CONFIG = {
  accepted:           { label: "Accept All",         color: "bg-emerald-600 hover:bg-emerald-700", icon: CheckCircle2 },
  declined:           { label: "Decline All",        color: "bg-rose-600 hover:bg-rose-700",       icon: XCircle },
  revision_requested: { label: "Request Revision",  color: "bg-amber-600 hover:bg-amber-700",      icon: RefreshCw },
};

const fmtDate = (t) => new Date(t).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (t) => new Date(t).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

export default function BatchShiftAcknowledgeModal({ shifts, user, onClose }) {
  const [selected, setSelected] = useState(() => shifts.map(s => s.id));
  const [step, setStep] = useState("choose"); // choose | notes | sign | whatsapp
  const [status, setStatus] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [waMessage, setWaMessage] = useState("");

  const selectedShifts = useMemo(
    () => shifts.filter(s => selected.includes(s.id)),
    [shifts, selected]
  );
  const allSelected = selected.length === shifts.length;

  const toggle = (id) => setSelected(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
  const toggleAll = () => setSelected(allSelected ? [] : shifts.map(s => s.id));

  const handleChoose = (s) => {
    if (selected.length === 0) return;
    setStatus(s);
    setStep(s === "accepted" ? "sign" : "notes");
  };

  const applyAll = async (sig) => {
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const updates = selectedShifts.map(s => ({
        id: s.id,
        guard_ack_status: status,
        guard_ack_note: notes,
        guard_ack_at: nowIso,
        guard_ack_signature: sig,
      }));
      await base44.entities.Shift.bulkUpdate(updates);

      // One consolidated in-app notification to management (avoids spamming N
      // notifications for a batch while still keeping a permanent audit record).
      try {
        const lines = selectedShifts
          .map(s => `• ${s.site_name} — ${fmtDate(s.start_time)} ${fmtTime(s.start_time)}`)
          .join("\n");
        await base44.entities.Notification.create({
          type: "shift_reminder",
          priority: "high",
          title: `Shifts ${status.replace("_", " ")} (batch) — ${getUserDisplayName(user)}`,
          message: `${getUserDisplayName(user)} has ${status.replace("_", " ")} ${selectedShifts.length} shift(s):\n${lines}${notes ? `\n\nNote: ${notes}` : ""}`,
          read: false,
          related_entity: "shift",
          related_id: selectedShifts[0]?.id || null,
        });
      } catch (_) {}

      const lines = selectedShifts
        .map(s => `• ${s.site_name} — ${fmtDate(s.start_time)} ${fmtTime(s.start_time)}`)
        .join("\n");
      setWaMessage(
        `*Shift Acknowledgement (Batch)*\nGuard: ${getUserDisplayName(user)}\nResponse: ${status.replace("_", " ").toUpperCase()}\nShifts (${selectedShifts.length}):\n${lines}${notes ? `\n\nNote: ${notes}` : ""}`
      );
      setStep("whatsapp");
    } catch (err) {
      alert("Failed to save batch acknowledgement: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (step === "sign") {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <SignaturePad
            onSave={applyAll}
            onCancel={() => setStep(status === "accepted" ? "choose" : "notes")}
          />
        </div>
      </div>
    );
  }

  if (step === "whatsapp") {
    return (
      <WhatsAppNotifier
        message={waMessage}
        title={`Batch ${status.replace("_", " ")} — Notify Management`}
        onDone={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4 overflow-y-auto">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-lg">Review Pending Shifts</CardTitle>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {shifts.length} shift(s) awaiting your response
          </p>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          {/* Selectable shift list */}
          <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
            <button onClick={toggleAll} className="text-xs text-sky-400 underline mb-1">
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            {shifts.map(s => {
              const on = selected.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggle(s.id)}
                  className={`w-full text-left rounded-lg p-3 border transition ${
                    on ? "bg-slate-900/70 border-sky-500/40" : "bg-slate-900/30 border-slate-700 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={`w-4 h-4 rounded border mt-0.5 shrink-0 flex items-center justify-center ${
                        on ? "bg-sky-500 border-sky-500" : "border-slate-600"
                      }`}
                    >
                      {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-white text-sm font-medium truncate">{s.site_name}</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-400 text-xs ml-5">
                        <Clock className="w-3 h-3" />
                        {fmtDate(s.start_time)} · {fmtTime(s.start_time)} – {fmtTime(s.end_time)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {step === "choose" && (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm text-center">
                {selected.length === 0
                  ? "Select at least one shift"
                  : `Apply your response to ${selected.length} selected shift(s):`}
              </p>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <Button
                    key={key}
                    onClick={() => handleChoose(key)}
                    disabled={selected.length === 0}
                    className={`w-full h-12 ${cfg.color} font-semibold`}
                  >
                    <Icon className="w-5 h-5 mr-2" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          )}

          {step === "notes" && (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">
                {status === "declined"
                  ? "Reason for declining (applies to all selected):"
                  : "What revision is needed (applies to all selected)?"}
              </p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a message for management..."
                className="bg-slate-900 border-slate-700 text-white"
                rows={3}
              />
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep("choose")}
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  Back
                </Button>
                <Button
                  onClick={() => setStep("sign")}
                  disabled={saving}
                  className={`flex-1 ${STATUS_CONFIG[status]?.color}`}
                >
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenTool className="w-4 h-4 mr-2" />}
                  Sign & Confirm
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}