import React, { useState } from "react";
import { Copy, Check, ExternalLink, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * AssistedDialDialog — the HONEST Wave Lite handoff. No documented
 * exact-number URI scheme for Wave Lite exists in Grandstream's
 * documentation and none has been physically verified on this wrapper, so
 * USS does NOT auto-open the external app and does NOT use a generic
 * telephone link (no silent SIM-dialler fallback). The number is copied for
 * pasting into Wave Lite; the limitation is marked clearly.
 */
export default function AssistedDialDialog({ open, onClose, number }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) { setCopied(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setCopied(false); onClose(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ExternalLink className="w-5 h-5 text-sky-400" /> Open in Wave Lite</DialogTitle>
          <DialogDescription className="text-slate-400">
            USS cannot dial through Wave Lite directly — assisted flow below.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            Marked limitation: exact-number handoff to the Wave Lite app is not established yet.
            USS does not open the app automatically and never uses the SIM dialler.
          </p>
        </div>
        <div className="text-center py-2">
          <p className="text-2xl font-bold text-white font-mono tracking-wide break-all">{number}</p>
        </div>
        <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
          <li>Copy the number.</li>
          <li>Open the Grandstream Wave Lite app (its own app icon, not inside USS).</li>
          <li>Paste the number and tap the call button inside Wave Lite.</li>
        </ol>
        <Button onClick={copy} className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
          {copied ? <Check className="w-5 h-5 mr-2" /> : <Copy className="w-5 h-5 mr-2" />}
          {copied ? "Number Copied" : "Copy Number"}
        </Button>
        <p className="text-[11px] text-slate-600">
          SIP credentials and registration stay inside Wave Lite. Actual outbound restrictions are enforced by your SIP provider — this USS permission does not prevent direct use of the external app.
        </p>
      </DialogContent>
    </Dialog>
  );
}