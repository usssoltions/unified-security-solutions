import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Control Room Operator action: assign a queued/reopened task to an eligible
 * user. The user list is produced server-side (same customer, operational
 * roles only) — the browser never sees foreign-tenant users.
 */
export default function AssignDialog({ open, task, users, onClose, onSubmit, saving, reassign }) {
  const [userId, setUserId] = useState("");

  React.useEffect(() => { if (open) setUserId(task?.assigned_to || ""); }, [open, task]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-white">
            {reassign ? "Reassign Task" : "Assign Task"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-sm text-slate-400">{task?.title}</p>
          <Label className="text-slate-300">Assign to</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700 z-[60] max-h-64">
              {users.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-500">No eligible users</div>
              )}
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-white">
                  {u.name} ({u.role_type})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={() => onSubmit(userId)} disabled={!userId || saving}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Assigning..." : reassign ? "Reassign" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}