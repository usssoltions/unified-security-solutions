import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Non-completion reason capture for an outstanding/overdue task — required at
 * the deadline so the Task Completion Report always explains unfinished work.
 */
export default function ReasonDialog({ open, task, onClose, onSubmit, saving }) {
  const [reason, setReason] = useState("");

  React.useEffect(() => { if (open) setReason(task?.non_completion_reason || ""); }, [open, task]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-white">Non-Completion Reason</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-sm text-slate-400">{task?.title}</p>
          <Label className="text-slate-300">Reason (required)</Label>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why was this task not completed?"
            className="bg-slate-800 border-slate-700 text-white resize-none" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={() => onSubmit(reason.trim())} disabled={!reason.trim() || saving}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Saving..." : "Save Reason"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}