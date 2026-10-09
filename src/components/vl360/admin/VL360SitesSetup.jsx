import React, { useState, useEffect } from "react";
import { Loader2, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * VL360SitesSetup — standalone site management for a VOICELINK360-only
 * Customer Administrator (the OPERATIONS SiteManagement page is unreachable
 * without that module). Minimal scoped create and active/inactive toggle
 * through the vl360Access gateway — entitlement and administrator role are
 * enforced server-side, and every site row is strictly customer-bound.
 * The existing siteAccess gateway and other customers' site management are
 * untouched.
 */
export default function VL360SitesSetup({ onChanged }) {
  const [sites, setSites] = useState(null);
  const [form, setForm] = useState({ name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    try {
      const d = await vl360Invoke({ action: "sites_list_all" });
      setSites(d?.sites || []);
    } catch (e) { setError(e?.message || "Could not load sites."); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const d = await vl360Invoke({ action: "site_save", name: form.name, address: form.address });
      if (d?.error) throw new Error(d.error);
      setMsg(`Site "${d.site?.name}" created.`);
      setForm({ name: "", address: "" });
      await load();
      onChanged?.();
    } catch (e) { setError(e?.message || "Could not save."); } finally { setBusy(false); }
  };

  const toggleStatus = async (site) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const d = await vl360Invoke({
        action: "site_save", site_id: site.id, name: site.name, address: site.address || "",
        status: site.status === "active" ? "inactive" : "active",
      });
      if (d?.error) throw new Error(d.error);
      setMsg(`Site "${site.name}" is now ${d.site?.status}.`);
      await load();
      onChanged?.();
    } catch (e) { setError(e?.message || "Could not update."); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Sites for your organisation. Create the sites your VoiceLink personnel and groups belong to, then configure them in Personnel, Controllers and Site Comms.
      </p>
      {sites === null ? <Loader2 className="w-5 h-5 text-slate-500 animate-spin" /> : sites.length === 0 ? (
        <p className="text-xs text-slate-500">No sites yet — create the first one below.</p>
      ) : (
        <div className="space-y-2">
          {sites.map((s) => (
            <div key={s.id} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
              <MapPin className="w-4 h-4 text-sky-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium truncate">{s.name}</p>
                <p className="text-xs text-slate-500 truncate">{s.address || "No address"}</p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${s.status === "active" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-slate-400 border-slate-600 bg-slate-800"}`}>
                {s.status === "active" ? "Active" : "Inactive"}
              </span>
              <Button onClick={() => toggleStatus(s)} disabled={busy} variant="outline" size="sm"
                className="border-slate-600 text-slate-300 shrink-0">
                {s.status === "active" ? "Deactivate" : "Activate"}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-sky-300 uppercase tracking-wide flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> New Site</p>
        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">Site Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-950 border-slate-700 text-white" placeholder="e.g. Main Gate House" />
        </div>
        <div className="space-y-1">
          <Label className="text-slate-300 text-xs">Address</Label>
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-slate-950 border-slate-700 text-white" placeholder="Street address" />
        </div>
        <Button onClick={save} disabled={busy || !form.name.trim() || !form.address.trim()}
          className="bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Create Site
        </Button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
    </div>
  );
}