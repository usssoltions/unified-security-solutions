import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function CancelVisitDialog({ visit, open, onClose, onCancelled }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!reason.trim()) { setError("A reason is required."); return; }
    setBusy(true); setError(null);
    try {
      await base44.functions.invoke("finalizeAccessEntry", { action: "hospitality_cancel", access_data: { hospitality_visit_id: visit.id, reason: reason.trim() } });
      setReason("");
      onCancelled();
    } catch (e) {
      setError(e?.response?.data?.error || "Cancellation failed.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader><DialogTitle>Cancel abandoned visit</DialogTitle></DialogHeader>
        <p className="text-slate-400 text-sm">Access was never granted for this visit. The visit and its answers are kept; the reason and your name are recorded.</p>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="bg-slate-950 border-slate-700 text-white" />
        {error && <p className="text-rose-400 text-sm">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={submit} disabled={busy} className="flex-1 bg-rose-600 hover:bg-rose-700 active:scale-95 transition-transform">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Cancel visit
          </Button>
          <Button onClick={onClose} variant="outline" className="flex-1 border-slate-600 text-slate-300">Back</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}