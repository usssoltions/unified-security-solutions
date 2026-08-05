import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2 } from "lucide-react";

export default function AddDestinationModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "", contact_person: "", telephone: "", email: "", address: "", unit: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await base44.entities.Destination.create({ ...form, active: true });
      onCreated?.();
      setForm({ name: "", contact_person: "", telephone: "", email: "", address: "", unit: "", notes: "" });
      onClose?.();
    } catch (e) {
      console.warn("[destination] create failed", e?.message || e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">Add Destination</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-slate-400 text-xs">Name *</Label>
            <Input value={form.name} onChange={set("name")} className="bg-slate-800 border-slate-700 text-white" placeholder="e.g. Unit 12 / Clubhouse / ABC Pty" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-400 text-xs">Contact Person</Label>
              <Input value={form.contact_person} onChange={set("contact_person")} className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Unit</Label>
              <Input value={form.unit} onChange={set("unit")} className="bg-slate-800 border-slate-700 text-white" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-slate-400 text-xs">Telephone</Label>
              <Input value={form.telephone} onChange={set("telephone")} className="bg-slate-800 border-slate-700 text-white" />
            </div>
            <div>
              <Label className="text-slate-400 text-xs">Email</Label>
              <Input value={form.email} onChange={set("email")} className="bg-slate-800 border-slate-700 text-white" />
            </div>
          </div>
          <div>
            <Label className="text-slate-400 text-xs">Address</Label>
            <Input value={form.address} onChange={set("address")} className="bg-slate-800 border-slate-700 text-white" />
          </div>
          <div>
            <Label className="text-slate-400 text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} className="bg-slate-800 border-slate-700 text-white" rows={2} />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" onClick={onClose} className="flex-1 border-slate-600 text-slate-300">Cancel</Button>
          <Button onClick={submit} disabled={saving || !form.name.trim()} className="flex-1 bg-emerald-500 hover:bg-emerald-600">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save Destination
          </Button>
        </div>
      </div>
    </div>
  );
}