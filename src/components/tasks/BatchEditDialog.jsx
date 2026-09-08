import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil } from "lucide-react";

const SUPERVISOR_ROLES = ["dispatcher", "admin", "customer_admin"];

/**
 * EDIT a Task List (batch) — the editable production fields: Primary
 * Supervisor and additional notification recipients. Series definitions
 * propagate the change to pending occurrences server-side. Deliverable fields
 * of finished/cancelled lists are not editable (server-enforced).
 */
export default function BatchEditDialog({ open, batch, data, act, onClose }) {
  const [supervisorId, setSupervisorId] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open && batch) {
      setSupervisorId(batch.primary_supervisor_id || "");
      setRecipients(batch.additional_notification_user_ids || []);
    }
  }, [open, batch]);

  if (!batch) return null;

  const staff = data?.staff || [];
  const supervisors = staff.filter((u) => SUPERVISOR_ROLES.includes(u.role_type));
  const toggleRecipient = (id) => setRecipients((r) =>
    r.includes(id) ? r.filter((x) => x !== id) : [...r, id]);

  const save = async () => {
    setSaving(true);
    try {
      await act({
        action: "updateBatch", id: batch.id,
        primary_supervisor_id: supervisorId,
        additional_notification_user_ids: recipients,
      }, "Task list updated");
      onClose();
    } catch (_) {} finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Pencil className="w-5 h-5 text-sky-400" /> Edit Task List
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-400 -mt-1 truncate">“{batch.title}”</p>

        <div className="space-y-1.5">
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