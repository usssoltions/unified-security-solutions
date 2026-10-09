import React from "react";
import { Info } from "lucide-react";

/**
 * ModuleSettings — module identity, communication policy and honest
 * limitation statements for administrators. No payment, no PBX, no Telegram
 * calling integration.
 */
export default function ModuleSettings({ data }) {
  const rows = [
    ["Module", "USS VoiceLink 360 (key: VOICELINK360)"],
    ["Licensed customers", (data?.users || []).length >= 0 ? "This customer" : "—"],
    ["Internal communication", "Telegram destination links — USS opens the exact configured conversation; calling and messaging happen inside Telegram."],
    ["External telephone calls", "Grandstream Wave Lite with your own SIP service. USS never stores SIP credentials, never builds a PBX and never opens the app automatically."],
    ["Outbound restrictions", "Enforced by your SIP provider — USS permissions govern USS features only and do not prevent direct use of Wave Lite."],
    ["Notification bot", "The existing USS Telegram notification bot remains available through the established notification service (independent of calling)."],
    ["Reliability statement", "Internet-dependent calling does not replace radio communications under all conditions; USS makes no emergency-delivery guarantees."],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide">{k}</p>
          <p className="text-sm text-slate-300 mt-1">{v}</p>
        </div>
      ))}
      <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 flex gap-2">
        <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300">
          Telegram accounts and groups are managed in Telegram. USS stores and controls access to their mappings only. Do not imply that Telegram or Wave Lite are embedded inside USS — they are external apps.
        </p>
      </div>
    </div>
  );
}