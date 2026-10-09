import React, { useState } from "react";
import { Loader2, Phone, Video, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DestinationOutcome from "./DestinationOutcome";
import { openDestination } from "@/lib/vl360Api";

/**
 * ColleagueActionsSheet — after selecting a colleague: Voice Call, Video Call
 * and Send Message. All three open THAT person's configured conversation; the
 * user completes the call or message inside Telegram. No ringing or
 * connected states are simulated and no call outcome is claimed.
 */
export default function ColleagueActionsSheet({ colleague, onClose }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!colleague) return null;

  const go = async () => {
    setBusy("x");
    setError(null);
    try {
      const d = await openDestination({ type: "individual", user_id: colleague.user_id });
      if (d?.code) setError(d);
      else onClose();
    } catch (e) {
      setError({ code: "missing_configuration", error: e?.message || "Could not open the conversation." });
    } finally {
      setBusy(null);
    }
  };

  const options = [
    { key: "voice", label: "Voice Call", icon: Phone },
    { key: "video", label: "Video Call", icon: Video },
    { key: "message", label: "Send Message", icon: MessageSquare },
  ];

  return (
    <Dialog open={!!colleague} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle>{colleague.name}</DialogTitle>
          <DialogDescription className="text-slate-400">
            {colleague.vl_role_label}{colleague.personnel_id ? ` · ${colleague.personnel_id}` : ""}
            {colleague.site_name ? ` · ${colleague.site_name}` : ""}
          </DialogDescription>
        </DialogHeader>
        {error && <DestinationOutcome outcome={error} onDismiss={() => setError(null)} />}
        <div className="space-y-2">
          {options.map(({ key, label, icon: Icon }) => (
            <Button key={key} onClick={go} disabled={!!busy} className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
              {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Icon className="w-5 h-5 mr-2" />}
              {label}
            </Button>
          ))}
          <p className="text-xs text-slate-500 text-center pt-1">
            Opens the conversation. Tap Call or Video inside Telegram.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}