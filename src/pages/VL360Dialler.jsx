import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import AssistedDialDialog from "@/components/vl360/AssistedDialDialog";
import { Button } from "@/components/ui/button";
import { Loader2, Delete, ClipboardPaste, PhoneCall, Contact } from "lucide-react";
import { vl360Invoke, vl360Key } from "@/lib/vl360Api";

/**
 * VL360Dialler — external telephone dialler (authorised users only, per-user
 * permission enforced here AND server-side). Numeric entry, paste, delete,
 * Call Number and Operational Contacts. The handoff is the honest assisted
 * flow (no auto-launch, no SIM fallback, no chargeable calls in tests).
 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "0"];

export default function VL360Dialler() {
  const ctx = useVL360();
  const [number, setNumber] = useState("");
  const [showAssisted, setShowAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [error, setError] = useState(null);

  const externalCalling = !!(ctx.data?.profile?.external_calling_enabled);

  const { data: contactsData, refetch: refetchContacts } = useQuery({
    queryKey: vl360Key(["phone_contacts"]),
    queryFn: async () => vl360Invoke({ action: "phone_contacts_list" }),
    enabled: externalCalling,
  });
  const contacts = contactsData?.contacts || [];

  const callNumber = async () => {
    setError(null);
    if (!/^[0-9+()\- ]{3,24}$/.test(number.trim()) || !/\d/.test(number)) {
      setError("The number contains unsupported characters or is too short.");
      return;
    }
    setBusy(true);
    try {
      // Server validates + records the dial attempt (no call is placed).
      const d = await vl360Invoke({ action: "log_dial", number: number.trim() });
      if (d?.error) { setError(d.error); return; }
      setShowAssisted(true);
    } catch (e) {
      setError(e?.message || "Could not start the dial flow.");
    } finally { setBusy(false); }
  };

  return (
    <VL360Shell ctx={ctx} title="Dial Telephone Number" subtitle="External calls via Wave Lite">
      {!externalCalling ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="text-sm text-amber-200">External telephone calling is not enabled for your profile. Ask your administrator under Telephone Permissions.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">{error}</p>}
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 min-h-[64px] flex items-center justify-between gap-2">
            <p className="text-2xl font-bold text-white font-mono tracking-wide break-all flex-1">{number || <span className="text-slate-600 text-base font-normal">Enter number</span>}</p>
            <div className="flex gap-1 shrink-0">
              <Button variant="outline" size="icon" onClick={async () => {
                try { const t = await navigator.clipboard.readText(); if (t) setNumber((n) => (n + t).slice(0, 24)); } catch (_) {}
              }} className="border-slate-600 text-slate-300" title="Paste">
                <ClipboardPaste className="w-5 h-5" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => setNumber((n) => n.slice(0, -1))}
                className="border-slate-600 text-slate-300" title="Delete">
                <Delete className="w-5 h-5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {KEYS.map((k) => (
              <Button key={k} onClick={() => setNumber((n) => (n + k).slice(0, 24))} variant="outline"
                className="h-14 text-xl font-semibold border-slate-700 text-white bg-slate-900 hover:bg-slate-800 active:scale-95">
                {k}
              </Button>
            ))}
            <Button onClick={() => setContactsOpen(true)} variant="outline"
              className="h-14 border-slate-700 text-sky-400 bg-slate-900 hover:bg-slate-800 active:scale-95 text-sm font-semibold">
              <Contact className="w-5 h-5 mr-1" /> Contacts
            </Button>
          </div>
          <Button onClick={callNumber} disabled={!!busy || !number.trim()}
            className="w-full h-14 bg-sky-500 hover:bg-sky-600 text-slate-950 text-base font-semibold active:scale-[0.98]">
            {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <PhoneCall className="w-5 h-5 mr-2" />}
            Call Number
          </Button>
          <p className="text-[11px] text-slate-600">
            The number is copied for Wave Lite — USS does not place the call and records only that a dial flow was shown.
          </p>
        </div>
      )}

      <AssistedDialDialog open={showAssisted} onClose={() => setShowAssisted(false)} number={number.trim()} />

      {contactsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setContactsOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-sm p-4 space-y-2 max-h-[70dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <p className="text-white font-semibold">Operational Contacts</p>
            {contacts.length === 0 && <p className="text-slate-500 text-sm py-4 text-center">No operational contacts configured yet.</p>}
            {contacts.map((c) => (
              <button key={c.id} onClick={() => { setNumber(c.number); setContactsOpen(false); }}
                className="w-full text-left bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 active:scale-[0.98]">
                <p className="text-white text-sm font-medium truncate">{c.label}</p>
                <p className="text-slate-400 text-xs font-mono">{c.number}</p>
              </button>
            ))}
            <Button variant="ghost" onClick={() => setContactsOpen(false)} className="w-full text-slate-400">Close</Button>
          </div>
        </div>
      )}
    </VL360Shell>
  );
}