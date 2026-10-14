import React, { useState } from "react";
import { Loader2, Phone, Video, MessageSquare } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import DestinationOutcome from "./DestinationOutcome";
import { openDestination } from "@/lib/vl360Api";

/**
 * ControlRoomActionsSheet — the guard's Control Room contact offers the same
 * three choices as an individual colleague (Voice Call, Video Call, Send
 * Message). All three resolve the site's configured Control Room Destination
 * and open THAT conversation; the user starts the call or video inside
 * Telegram. No ringing or connected states are simulated and no call outcome
 * is claimed.
 */
export default function ControlRoomActionsSheet({ siteId, open, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!open) return null;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await openDestination({ type: "control_room", site_id: siteId || undefined });
      if (d?.code) setError(d);
      else onClose();
    } catch (e) {
      setError({ code: "missing_configuration", error: e?.message || "Could not open the conversation." });
    } finally {
      setBusy(false);
    }
  };

  const options = [
    { label: "Voice Call", icon: Phone },
    { label: "Video Call", icon: Video },
    { label: "Send Message", icon: MessageSquare },
  ];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle>Control Room</DialogTitle>
          <DialogDescription className="text-slate-400">Your site's configured control-room contact</DialogDescription>
        </DialogHeader>
        {error && <DestinationOutcome outcome={error} onDismiss={() => setError(null)} />}
        <div className="space-y-2">
          {options.map(({ label, icon: Icon }) => (
            <Button key={label} onClick={go} disabled={busy}
              className="w-full h-12 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
              {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Icon className="w-5 h-5 mr-2" />}
              {label}
            </Button>
          ))}
          <p className="text-xs text-slate-500 text-center pt-1">
            Opens the Control Room conversation. Start the call or video inside Telegram.
          </p>
          <p className="text-xs text-slate-500 text-center">
            After your conversation, use Recent Apps to return to USS.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}