import React, { useState } from "react";
import { Copy, Check, Smartphone, ExternalLink, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * AssistedDialDialog — Grandstream Wave Lite handoff (Wave Lite ONLY — never
 * Grandstream Wave, Linkus or the SIM dialler). HONEST CAPABILITY STATE:
 *  - Number prefill: UNVERIFIED — Wave Lite publishes no documented dial
 *    intent that we have confirmed against the installed version, so USS
 *    does not claim prefill works and does not attempt it.
 *  - Launching the app: also UNVERIFIED — no confirmed launch mechanism
 *    exists (the wrapper build's JS bridge exposes no app-launch method, and
 *    no speculative Chrome intent scheme is attempted here). The only
 *    reliable flow today is: Copy Number, open Wave Lite from its own app
 *    icon, paste, call. USS never claims a call started and never implies
 *    the external app opened on its behalf.
 *  - The PROPOSED minimal wrapper change (for review, NOT implemented):
 *    add one guarded bridge method to MainActivity, e.g.
 *      @JavascriptInterface public String launchApp(String packageName) {
 *        // resolve via getPackageManager().getLaunchIntentForPackage(...)
 *        // return "opened" | "not_installed" | "error" — nothing else
 *      }
 *    If and when that lands AND a prefill method is verified, this dialog
 *    gains a launch button behind a real capability check — it never shows
 *    a button that implies success.
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
          <DialogTitle className="flex items-center gap-2"><ExternalLink className="w-5 h-5 text-sky-400" /> Grandstream Wave Lite</DialogTitle>
          <DialogDescription className="text-slate-400">
            Assisted handoff only — USS never dials, never claims a call started, and never uses the SIM dialler.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            Unverified capability: number prefill and automatic app launch are not confirmed on this device.
            Until verified, use the copy-and-paste flow below.
          </p>
        </div>
        <div className="text-center py-2">
          <p className="text-2xl font-bold text-white font-mono tracking-wide break-all">{number}</p>
        </div>
        <ol className="text-sm text-slate-300 space-y-2 list-decimal list-inside">
          <li>Copy the number below.</li>
          <li>Open Grandstream Wave Lite from its own app icon (not inside USS).</li>
          <li>Paste the number and tap the call button inside Wave Lite.</li>
        </ol>
        <Button onClick={copy} className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
          {copied ? <Check className="w-5 h-5 mr-2" /> : <Copy className="w-5 h-5 mr-2" />}
          {copied ? "Number Copied" : "Copy Number"}
        </Button>
        <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          SIP credentials and registration stay inside Wave Lite. Actual outbound restrictions are enforced by your SIP provider — this USS permission does not prevent direct use of the external app.
        </p>
      </DialogContent>
    </Dialog>
  );
}