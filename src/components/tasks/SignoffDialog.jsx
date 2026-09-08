import React, { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import TaskSignaturePad from "./TaskSignaturePad";

/**
 * SIGN-OFF 1 — Guard/assigned user completion. The task is NOT completed
 * here: it moves to 'awaiting Control Room verification'. Signature always
 * required; notes/evidence when configured on the task.
 */
export default function SignoffDialog({ open, task, onClose, onSubmit, saving }) {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState(null);
  const [evidenceUrl, setEvidenceUrl] = useState(null);
  const [uploading, setUploading] = useState(false);

  React.useEffect(() => {
    if (!open) return;
    setNotes(task?.completion_notes || "");
    setSignature(null);
    setEvidenceUrl(task?.completion_evidence_url || null);
  }, [open, task]);

  const uploadEvidence = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await base44.integrations.Core.UploadFile({ file });
      const url = res?.file_url || res?.data?.file_url;
      if (!url) throw new Error("Upload failed");
      setEvidenceUrl(url);
    } catch (e) {
      toast({ title: "Evidence upload failed — please try again", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const notesRequired = !!task?.completion_notes_required;
  const evidenceRequired = !!task?.evidence_required;
  const valid = signature && (!notesRequired || notes.trim()) && (!evidenceRequired || evidenceUrl);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white">Complete & Sign Off</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-slate-400">{task?.title}</p>
          <p className="text-xs text-violet-300/80 bg-violet-500/10 border border-violet-500/25 rounded-lg px-3 py-2">
            Signing off does NOT mark this task completed — the Control Room Operator must
            review and verify it before final completion.
          </p>

          <div className="space-y-1.5">
            <Label className="text-slate-300">
              Completion notes {notesRequired ? "(required)" : "(optional)"}
            </Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="What was done / outcome"
              className="bg-slate-800 border-slate-700 text-white resize-none" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-slate-300">
              Evidence {evidenceRequired ? "(required)" : "(optional)"}
            </Label>
            <div className="flex items-center gap-2">
              <label className="h-11 px-4 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 text-sm flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" /> {uploading ? "Uploading..." : evidenceUrl ? "Replace file" : "Attach photo/file"}
                <input type="file" className="hidden" accept="image/*,application/pdf"
                  onChange={(e) => uploadEvidence(e.target.files?.[0])} disabled={uploading} />
              </label>
              {evidenceUrl && <span className="text-xs text-emerald-400">Attached ✓</span>}
            </div>
          </div>

          <TaskSignaturePad onChange={setSignature} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="bg-slate-800 border-slate-700 text-slate-200">Cancel</Button>
          <Button onClick={() => onSubmit({
            completion_notes: notes.trim() || undefined,
            evidence_url: evidenceUrl || undefined,
            signature,
          })} disabled={!valid || saving || uploading}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white">
            {saving ? "Submitting..." : "Sign Off for Verification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}