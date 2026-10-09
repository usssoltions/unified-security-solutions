import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Radio, Users, User, MessageSquare, Phone } from "lucide-react";
import { openDestination } from "@/lib/vl360Api";
import DestinationOutcome from "./DestinationOutcome";

/**
 * MessagesSheet — the guard's Messages destinations: Control Room, Site Group
 * and Individual (picked from the permitted personnel list). Each opens the
 * exact configured conversation; the message is sent inside Telegram.
 */
export default function MessagesSheet({ open, onClose, currentSiteId }) {
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const go = async (type, key) => {
    setBusy(key); setOutcome(null);
    try {
      const d = await openDestination({ type, site_id: currentSiteId });
      if (d?.code) setOutcome(d); else onClose();
    } catch (e) {
      setOutcome({ code: "missing_configuration", error: e?.message || "Could not open the conversation." });
    } finally { setBusy(null); }
  };

  const items = [
    { key: "control_room", label: "Control Room", icon: Radio },
    { key: "site_group", label: "Site Group", icon: Users },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageSquare className="w-5 h-5 text-sky-400" /> Messages</DialogTitle>
          <DialogDescription className="text-slate-400">Choose a destination — the conversation opens in Telegram.</DialogDescription>
        </DialogHeader>
        {outcome && <DestinationOutcome outcome={outcome} onCallControlRoom={() => go("control_room", "control_room")} onDismiss={() => setOutcome(null)} />}
        <div className="space-y-2">
          {items.map(({ key, label, icon: Icon }) => (
            <Button key={key} onClick={() => go(key, key)} disabled={!!busy}
              className="w-full h-12 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold active:scale-[0.98]">
              {busy === key ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Icon className="w-5 h-5 mr-2 text-sky-400" />}
              {label}
            </Button>
          ))}
          <Button onClick={() => window.location.assign("/VL360Colleagues?mode=message")} disabled={!!busy}
            className="w-full h-12 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold active:scale-[0.98]">
            {busy === "individual" ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <User className="w-5 h-5 mr-2 text-sky-400" />}
            Individual
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}