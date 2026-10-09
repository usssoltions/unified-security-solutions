import React, { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { vl360Invoke, vl360Key } from "@/lib/vl360Api";

/**
 * OperationalContacts — labelled telephone numbers for the dialler's
 * Operational Contacts list. Stored as strings (leading zeroes preserved).
 */
export default function OperationalContacts() {
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { data, refetch, isLoading } = useQuery({
    queryKey: vl360Key(["phone_contacts"]),
    queryFn: async () => vl360Invoke({ action: "phone_contacts_list" }),
  });
  const contacts = data?.contacts || [];

  const add = async () => {
    setBusy(true); setError(null);
    try {
      const d = await vl360Invoke({ action: "phone_contact_save", label, number });
      if (d?.error) throw new Error(d.error);
      setLabel(""); setNumber("");
      await refetch();
    } catch (e) { setError(e?.message || "Could not save the contact."); } finally { setBusy(false); }
  };

  const remove = async (c) => {
    setBusy(true); setError(null);
    try {
      await vl360Invoke({ action: "phone_contact_delete", contact_id: c.id });
      await refetch();
    } catch (e) { setError(e?.message || "Could not delete."); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="bg-slate-950 border-slate-700 text-white" placeholder="e.g. Control Room Landline" />
        </div>
        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">Number (leading zeroes preserved)</Label>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} className="bg-slate-950 border-slate-700 text-white font-mono" placeholder="021 555 0100 / +27…" />
        </div>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <Button size="sm" onClick={add} disabled={busy || !label.trim() || !number.trim()} className="bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />} Add Contact
      </Button>
      {isLoading ? <Loader2 className="w-5 h-5 text-slate-500 animate-spin" /> : (
        <div className="space-y-2">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 gap-2">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium truncate">{c.label}</p>
                <p className="text-slate-400 text-xs font-mono">{c.number}</p>
              </div>
              <Button size="icon" variant="outline" onClick={() => remove(c)} className="border-rose-500/30 text-rose-400 shrink-0">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No operational contacts yet.</p>}
        </div>
      )}
    </div>
  );
}