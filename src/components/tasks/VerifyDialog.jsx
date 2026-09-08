import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import TaskSignaturePad from "./TaskSignaturePad";

/**
 * SIGN-OFF 2 — Control Room Operator verification (mode 'verify'), or
 * rejection with a mandatory reason (mode 'reject' → task reopened and
 * returned to the assigned user). The server refuses verification by the same
 * person who performed sign-off 1.
 */
export default function VerifyDialog({ open, task, mode, onClose, onSubmit, saving }) {
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState(null);
  const [reason, setReason] = useState("");
  const [lateReason, setLateReason] = useState("");

  React.useEffect(() => {
    if (!open) return;
    setNotes(task?.verification_notes || "");
    setSignature(null);
    setReason("");
    setLateReason("");
  }, [open, task]);

  const isVerify = mode === "verify";
  // Single source of truth with the server: verification performed after the
  // task's original deadline is a LATE COMPLETION — the late reason is
  // mandatory and the deadline miss is permanently recorded.
  const isLate = !!task?.due_date && !isNaN(Date.parse(task.due_date)) && Date.parse(task.due_date) < Date.now();
  const valid = isVerify
    ? !!signature && (!isLate || lateReason.trim().length > 0)
    : !!reason.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">
            {isVerify ? (isLate ? "Verify Late Completion (Final)" : "Verify & Sign Off (Final)") : "Reject / Reopen Task"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-slate-400">{task?.title}</p>

          {isVerify ? (
            <>
              <div className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 space-y-1">
                <p><span className="text-slate-300">Sign-off 1:</span> {task?.completed_by_name} · {task?.completed_at ? "completed" : "—"}</p>
                {task?.completion_notes && <p className="whitespace-pre-wrap">Notes: {task.completion_notes}</p>}
              </div>
              {isLate && (
                <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                  The deadline ({task?.due_date ? new Date(task.due_date).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "—"})
                  has passed. Verifying now records this task as <b>Completed Late</b> — the original deadline is preserved.
                </p>
              )}
              {isLate && (
                <div className="space-y-1.5">
                  <Label className="text-slate-300">Late reason (required)</Label>
                  <Textarea rows={2} value={lateReason} onChange={(e) => setLateReason(e.target.value)}
                    placeholder="Why was the verification completed after the deadline?"
                    className="bg-slate-800 border-slate-700 text-white resize-none" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-slate-300">Verification notes (optional)</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Review notes — inspected evidence, outcome confirmed"
                  className="bg-slate-800 border-slate-700 text-white resize-none" />
              </div>
              <p className="text-xs text-emerald-300/80">
                Your signature completes the task (both sign-offs) and immediately notifies the supervisor.
              </p>
              <TaskSignaturePad onChange={setSignature} />
            </>
          ) : (
            <>
              <p className="text-xs text-orange-300/80 bg-orange-500/10 border border-orange-500/25 rounded-lg px-3 py-2">
                The task returns to {task?.assigned_to_name || "the assigned user"} with your reason.
                Their previous sign-off is preserved in the audit history and the reminder cycle continues.
              </p>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Reason (required)</Label>
                <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is the completion not accepted?"
                  className="bg-slate-800 border-slate-700 text-white resize-none" />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={() => isVerify
            ? onSubmit({
                verification_notes: notes.trim() || undefined,
                signature,
                ...(isLate ? { late_reason: lateReason.trim() } : {}),
              })
            : onSubmit({ reason: reason.trim() })}
            disabled={!valid || saving}
            className={isVerify
              ? "bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white"
              : "bg-orange-600 hover:bg-orange-700 text-white"}>
            {saving ? "Saving..." : isVerify ? (isLate ? "Verify Late Completion" : "Verify & Complete") : "Reject & Reopen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}