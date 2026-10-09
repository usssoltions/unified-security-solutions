import React, { useState, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * SiteCommsSetup — per-site communication destinations: normal group,
 * emergency-response group, control-room contact/group and the optional
 * wider All Personnel group with its explicit access scope. Links are
 * validated to Telegram's documented formats only; setup confirmation is a
 * MANUAL administrator step (never inferred).
 */
export default function SiteCommsSetup({ data }) {
  const sites = data?.sites || [];
  const [siteId, setSiteId] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { if (!siteId && sites.length) setSiteId(sites[0].id); }, [sites]);
  useEffect(() => {
    if (!siteId) return;
    let alive = true;
    setForm(null);
    vl360Invoke({ action: "get_site_comms", site_id: siteId })
      .then((d) => {
        if (!alive) return;
        const c = d.comms || {};
        setForm({
          control_room_label: c.control_room_label || "", control_room_dest: c.control_room_dest || "",
          group_label: c.group_label || "", group_dest: c.group_dest || "",
          emergency_label: c.emergency_label || "", emergency_dest: c.emergency_dest || "",
          wide_group_label: c.wide_group_label || "", wide_group_dest: c.wide_group_dest || "",
          wide_group_scope: c.wide_group_scope || "management",
          wide_group_site_ids: Array.isArray(c.wide_group_site_ids) ? c.wide_group_site_ids : [],
          confirmed: !!c.group_setup_confirmed,
        });
      })
      .catch(() => alive && setForm({
        control_room_label: "", control_room_dest: "", group_label: "", group_dest: "",
        emergency_label: "", emergency_dest: "", wide_group_label: "", wide_group_dest: "",
        wide_group_scope: "management", wide_group_site_ids: [], confirmed: false,
      }));
    return () => { alive = false; };
  }, [siteId]);

  const set = (k) => (e) => setForm({ ...form, [k]: e?.target?.value ?? e });
  const save = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const d = await vl360Invoke({
        action: "save_site_comms", site_id: siteId,
        control_room_label: form.control_room_label, control_room_dest: form.control_room_dest,
        group_label: form.group_label, group_dest: form.group_dest,
        emergency_label: form.emergency_label, emergency_dest: form.emergency_dest,
        wide_group_label: form.wide_group_label, wide_group_dest: form.wide_group_dest,
        wide_group_scope: form.wide_group_scope,
        wide_group_site_ids: form.wide_group_site_ids || [],
      });
      if (d?.error) throw new Error(d.error);
      setMsg("Destinations saved. Open each one to verify it reaches the correct group, then confirm setup.");
    } catch (e) { setError(e?.message || "Could not save."); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const d = await vl360Invoke({ action: "confirm_group_setup", site_id: siteId });
      if (d?.error) throw new Error(d.error);
      setForm((f) => ({ ...f, confirmed: true }));
      setMsg("Group setup confirmed.");
    } catch (e) { setError(e?.message || "Could not confirm."); } finally { setBusy(false); }
  };

  if (!sites.length) return <p className="text-xs text-slate-500">No active sites yet — create sites first.</p>;

  const field = (key, label, placeholder) => (
    <div className="space-y-1">
      <Label className="text-slate-300 text-xs">{label}</Label>
      <Input value={form[key]} onChange={set(key)} className="bg-slate-950 border-slate-700 text-white" placeholder={placeholder} />
    </div>
  );

  return (
    <div className="space-y-3">
      <Select value={siteId || ""} onValueChange={setSiteId}>
        <SelectTrigger className="bg-slate-950 border-slate-700 text-white"><SelectValue placeholder="Select site" /></SelectTrigger>
        <SelectContent>{sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
      </Select>
      {!form ? <Loader2 className="w-5 h-5 text-slate-500 animate-spin" /> : (
        <>
          <div className="grid grid-cols-1 gap-3">
            {field("control_room_label", "Control Room Label", "e.g. Control Room 1")}
            {field("control_room_dest", "Control Room Destination (Telegram link)", "https://t.me/… or tg://resolve?domain=…")}
            {field("group_label", "Site Group Label", "e.g. Main Gate Team")}
            {field("group_dest", "Site Group Destination", "https://t.me/… (created in Telegram beforehand)")}
            {field("emergency_label", "Emergency Group Label", "e.g. Armed Response / Emergency")}
            {field("emergency_dest", "Emergency-Response Group Destination", "https://t.me/…")}
            {field("wide_group_label", "Wider All Personnel Label", "Optional — e.g. All Personnel")}
            {field("wide_group_dest", "Wider Group Destination (optional)", "https://t.me/…")}
          </div>
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">Wider Group Access Scope</Label>
            <Select value={form.wide_group_scope} onValueChange={set("wide_group_scope")}>
              <SelectTrigger className="bg-slate-950 border-slate-700 text-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="management">Management only (admins, controllers, empowered supervisors)</SelectItem>
                <SelectItem value="all">Also supervisors and response officers (never guards)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-slate-500">Create and populate the wider group in Telegram beforehand, then map it here. Guards never see All Personnel actions.</p>
          </div>
          {sites.length > 1 && (
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Wider Group Covers These Sites (complete scope required)</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {sites.map((s) => {
                  const on = (form.wide_group_site_ids || []).includes(s.id);
                  return (
                    <label key={s.id} className={`flex items-center gap-2 text-xs rounded-lg px-2 py-2 border cursor-pointer ${on ? "text-sky-200 border-sky-500/50 bg-sky-500/10" : "text-slate-300 border-slate-800 bg-slate-900"}`}>
                      <input type="checkbox" checked={on} onChange={() => setForm({ ...form, wide_group_site_ids: on ? (form.wide_group_site_ids || []).filter((id) => id !== s.id) : [...(form.wide_group_site_ids || []), s.id] })} className="accent-sky-500" />
                      <span className="truncate">{s.name}</span>
                    </label>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">Only people authorised for EVERY listed site can open this wider group. Untick all if the group belongs to this site alone.</p>
            </div>
          )}
          {error && <p className="text-xs text-rose-400">{error}</p>}
          {msg && <p className="text-xs text-emerald-400">{msg}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy} className="bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save Destinations
            </Button>
            <Button onClick={confirm} disabled={busy || form.confirmed} variant="outline"
              className="border-emerald-500/40 text-emerald-300">
              {form.confirmed ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Setup Confirmed</> : "Confirm Setup (after opening each group)"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}