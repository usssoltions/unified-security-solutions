import React, { useState } from "react";
import { Copy, Check, ExternalLink, AlertTriangle, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * AssistedDialDialog — Grandstream Wave Lite handoff (Wave Lite ONLY — never
 * Grandstream Wave, Linkus or the SIM dialler). CAPABILITY MATRIX (honest):
 *  - USS wrapper (native Android): the installed build's JS bridge exposes
 *    NO app-launch method, so a wrapper update is required before native
 *    launch works — the native button only appears once the bridge offers it.
 *  - Chrome/PWA: an Android intent link can attempt to open an installed app
 *    (the number is NOT passed). Attempted only on an explicit user tap.
 *  - Number prefill: UNSUPPORTED — Wave Lite publishes no documented dial
 *    intent, so the number is copied for pasting and the user taps Call
 *    inside Wave Lite (acceptable per the agreed workflow).
 *  USS never claims a call started and never opens the SIM dialler.
 */
const WAVE_LITE_PACKAGE = "com.grandstream.wave"; // Wave Lite app id — verify on the installed device (see report)

export default function AssistedDialDialog({ open, onClose, number }) {
  const [copied, setCopied] = useState(false);
  const [launchNote, setLaunchNote] = useState(null);
  const bridge = typeof window !== "undefined" ? window.AndroidBridge : null;
  const nativeLaunch = bridge && typeof bridge.launchApp === "function" ? bridge.launchApp.bind(bridge) : null;
  const inWrapper = !!bridge; // native wrapper detected (even without launch support yet)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (_) { setCopied(false); }
  };

  const openWaveLite = () => {
    setLaunchNote(null);
    if (nativeLaunch) {
      const result = String(nativeLaunch(WAVE_LITE_PACKAGE) || "");
      setLaunchNote(
        result === "opened" ? "Wave Lite opened. Paste the number and tap Call inside it."
        : result === "not_installed" ? "Wave Lite is not installed on this device."
        : "Wave Lite could not be opened. Use Copy Number instead."
      );
      return;
    }
    if (inWrapper) return; // no launch support in this wrapper build — fallback only
    // Chrome/PWA attempt (Android): opens Wave Lite if installed; the number
    // is not passed. Fails silently to the Copy Number flow if unavailable.
    try {
      window.location.href = `intent:#Intent;package=${WAVE_LITE_PACKAGE};end`;
      setLaunchNote("Android attempted to open Wave Lite. If nothing opened, use Copy Number.");
    } catch (_) {
      setLaunchNote("Wave Lite could not be opened here. Use Copy Number instead.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setCopied(false); setLaunchNote(null); onClose(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ExternalLink className="w-5 h-5 text-sky-400" /> Open in Wave Lite</DialogTitle>
          <DialogDescription className="text-slate-400">
            Grandstream Wave Lite only — USS never dials and never uses the SIM dialler.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            Marked limitation: exact-number handoff to Wave Lite is not established yet, and the number cannot be pre-filled.
            {inWrapper && !nativeLaunch ? " Launching from inside this USS build needs an app update — use Copy Number for now." : ""}
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
        {(!inWrapper || nativeLaunch) && (
          <Button onClick={openWaveLite} className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
            <Smartphone className="w-5 h-5 mr-2" />
            {nativeLaunch ? "Open Wave Lite" : "Try Opening Wave Lite (Android)"}
          </Button>
        )}
        <Button onClick={copy} className="w-full h-12 bg-slate-800 hover:bg-slate-700 text-white font-semibold active:scale-95">
          {copied ? <Check className="w-5 h-5 mr-2" /> : <Copy className="w-5 h-5 mr-2" />}
          {copied ? "Number Copied" : "Copy Number"}
        </Button>
        {launchNote && <p className="text-xs text-sky-300">{launchNote}</p>}
        <p className="text-[11px] text-slate-600">
          SIP credentials and registration stay inside Wave Lite. Actual outbound restrictions are enforced by your SIP provider — this USS permission does not prevent direct use of the external app.
        </p>
      </DialogContent>
    </Dialog>
  );
}