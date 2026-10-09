import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vl360Invoke } from "@/lib/vl360Api";
import AssignmentsEditor from "./AssignmentsEditor";

const VL_ROLE_OPTIONS = [
  { value: "guard", label: "Guard" },
  { value: "supervisor", label: "Supervisor" },
  { value: "armed_response", label: "Armed Response Officer" },
  { value: "control_room_operator", label: "Control Room Operator" },
  { value: "customer_admin", label: "Customer Administrator" },
];

/**
 * PersonnelSetup — VoiceLink administration area: operational profiles,
 * VoiceLink roles, personnel IDs, individual conversation destinations and
 * site (personnel) assignments. Invitations themselves remain in User
 * Management (the existing invitation workflow).
 */
export default function PersonnelSetup({ data, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const users = data?.users || [];
  const sites = data?.sites || [];

  const openEdit = (u) => {
    setEditing(u);
    setForm({
      personnel_id: u.vl_profile?.personnel_id || "",
      vl_role: u.vl_profile?.vl_role || "guard",
      telegram_username: u.vl_profile?.telegram_username || "",
      contact_link: "", // only filled when changing the destination
    });
    setError(null); setSaved(false);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const payload = { action: "save_profile", target_user_id: editing.user_id, personnel_id: form.personnel_id, vl_role: form.vl_role, telegram_username: form.telegram_username };
      if (form.contact_link && form.contact_link.trim()) payload.contact_link = form.contact_link.trim();
      const d = await vl360Invoke(payload);
      if (d?.error) throw new Error(d.error);
      setSaved(true);
      onChanged?.();
    } catch (e) {
      setError(e?.message || "Could not save the profile.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">New people are invited in User Management (existing invitation workflow — no duplicate accounts). Here you set their VoiceLink role, personnel ID, conversation destination and site assignments.</p>
      {users.map((u) => (
        <div key={u.user_id} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{u.name}</p>
            <p className="text-xs text-slate-400 truncate">
              {u.vl_profile ? `${u.vl_profile.vl_role_label}${u.vl_profile.personnel_id ? ` · ${u.vl_profile.personnel_id}` : ""}` : "No VoiceLink profile yet"}
              {u.assignments?.length ? ` · ${u.assignments.map((a) => a.site_name).join(", ")}` : " · no sites"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => openEdit(u)} className="border-slate-600 text-slate-200 shrink-0">
            <Pencil className="w-4 h-4 mr-1" /> Configure
          </Button>
        </div>
      ))}
      {users.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No users yet — invite people in User Management.</p>}

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Configure — {editing?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">VoiceLink Operational Role</Label>
              <Select value={form.vl_role} onValueChange={(v) => setForm({ ...form, vl_role: v })}>
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VL_ROLE_OPTIONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500">A VoiceLink-specific operational role — it never changes the platform role or other modules' permissions.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Personnel ID</Label>
              <Input value={form.personnel_id} onChange={(e) => setForm({ ...form, personnel_id: e.target.value })}
                className="bg-slate-950 border-slate-700 text-white" placeholder="Only if recorded — never invented" />
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Telegram Username (prefill aid)</Label>
              <Input value={form.telegram_username} onChange={(e) => setForm({ ...form, telegram_username: e.target.value })}
                className="bg-slate-950 border-slate-700 text-white" placeholder="@username — validated and tested separately" />
              <p className="text-[11px] text-slate-500">A captured username may prefill the destination but is never treated as a working calling link.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-slate-300 text-xs">Individual Conversation Destination</Label>
              <Input value={form.contact_link} onChange={(e) => setForm({ ...form, contact_link: e.target.value })}
                className="bg-slate-950 border-slate-700 text-white" placeholder="https://t.me/… or tg://resolve?domain=…" />
              {editing?.vl_profile?.contact_link && !form.contact_link && (
                <p className="text-[11px] text-slate-500">Current: {editing.vl_profile.contact_link} ({editing.vl_profile.contact_status}) — leave blank to keep.</p>
              )}
            </div>
            {sites.length > 0 && editing && (
              <div className="space-y-1">
                <Label className="text-slate-300 text-xs">Personnel Site Assignments</Label>
                <AssignmentsEditor targetUser={editing} kind="personnel" sites={sites} current={editing.assignments || []} onSaved={onChanged} />
              </div>
            )}
            {error && <p className="text-xs text-rose-400">{error}</p>}
            {saved && <p className="text-xs text-emerald-400">Profile saved.</p>}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditing(null)} className="flex-1 border-slate-600 text-slate-300">Close</Button>
              <Button onClick={save} disabled={busy} className="flex-1 bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold">
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}