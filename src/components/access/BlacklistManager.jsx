import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { can, PERMISSIONS } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ban, User, Car, Plus, Search, Trash2, Power, PowerOff } from "lucide-react";
import { getUserDisplayName } from "@/lib/userDisplayName";
import { getTenantContextFromUser } from "@/hooks/useTenantContext";

const REASONS = [
  { value: "trespassing", label: "Trespassing" },
  { value: "theft", label: "Theft" },
  { value: "vandalism", label: "Vandalism" },
  { value: "assault", label: "Assault" },
  { value: "blacklisted_by_client", label: "Blacklisted by client" },
  { value: "suspicious_activity", label: "Suspicious activity" },
  { value: "non_payment", label: "Non-payment" },
  { value: "other", label: "Other" },
];
const SEVERITY = ["low", "medium", "high", "critical"];
const severityColor = { low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", critical: "bg-rose-600" };

const norm = (v) => (v || "").toUpperCase().replace(/\s+/g, "");

export default function BlacklistManager() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [kind, setKind] = useState("person");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", identifier: "", reason: "other", severity: "medium", notes: "", expiry_date: "" });
  const [busy, setBusy] = useState(false);

  const { data: entries = [] } = useQuery({
    queryKey: ["blacklist_entries"],
    queryFn: () => base44.entities.BlacklistEntry.list("-created_date", 200),
  });

  const refresh = () => qc.invalidateQueries(["blacklist_entries"]);

  const canAddPerson = can(user, PERMISSIONS.BLACKLIST_ADD_PERSON);
  const canAddVehicle = can(user, PERMISSIONS.BLACKLIST_ADD_VEHICLE);
  const canEditPerson = can(user, PERMISSIONS.BLACKLIST_EDIT_PERSON);
  const canEditVehicle = can(user, PERMISSIONS.BLACKLIST_EDIT_VEHICLE);
  const canAdd = kind === "person" ? canAddPerson : canAddVehicle;
  const canToggle = kind === "person" ? canEditPerson : canEditVehicle;

  const add = async () => {
    const value = norm(form.identifier);
    if (!value) return;
    setBusy(true);
    try {
      const { reseller_id: _resellerId, customer_id: _customerId } = getTenantContextFromUser(user);
      await base44.entities.BlacklistEntry.create({
        customer_id: _customerId,
        reseller_id: _resellerId,
        entry_type: kind,
        name: form.name.trim(),
        identifier_type: kind === "person" ? "sa_id" : "vehicle_registration",
        identifier_value: value,
        reason: form.reason,
        severity: form.severity,
        notes: form.notes.trim(),
        active: true,
        expiry_date: form.expiry_date || "",
        added_by_id: user?.id,
        added_by_name: getUserDisplayName(user),
      });
      setForm({ name: "", identifier: "", reason: "other", severity: "medium", notes: "", expiry_date: "" });
      refresh();
    } catch (e) {
      console.warn("[blacklist] add failed", e?.message || e);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (entry) => {
    if (!canToggle) return;
    const nowActive = !entry.active;
    try {
      await base44.entities.BlacklistEntry.update(entry.id, {
        active: nowActive,
        deactivated_by_id: nowActive ? "" : (user?.id || ""),
        deactivated_by_name: nowActive ? "" : getUserDisplayName(user),
        deactivated_at: nowActive ? "" : new Date().toISOString(),
      });
      refresh();
    } catch (e) { console.warn(e); }
  };

  const remove = async (entry) => {
    if (!canToggle) return;
    try { await base44.entities.BlacklistEntry.delete(entry.id); refresh(); } catch (e) { console.warn(e); }
  };

  const filtered = entries
    .filter((e) => e.entry_type === kind)
    .filter((e) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (e.name || "").toLowerCase().includes(q) || (e.identifier_value || "").toLowerCase().includes(q) || (e.reason || "").toLowerCase().includes(q);
    });

  return (
    <section className="rounded-2xl border border-rose-500/30 bg-slate-800/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Ban className="w-5 h-5 text-rose-400" />
        <h2 className="text-white font-semibold">Blacklist</h2>
        <Badge className="bg-slate-700">{entries.filter((e) => e.active).length} active</Badge>
      </div>

      {/* People / Vehicles tabs */}
      <div className="flex gap-2">
        <button onClick={() => setKind("person")} className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold ${kind === "person" ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
          <User className="w-4 h-4" /> People
        </button>
        <button onClick={() => setKind("vehicle")} className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold ${kind === "vehicle" ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
          <Car className="w-4 h-4" /> Vehicles
        </button>
      </div>

      {/* Add form */}
      {canAdd ? (
        <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-3 space-y-2">
          <Input placeholder={kind === "person" ? "Full name" : "Vehicle owner / label"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
          <Input placeholder={kind === "person" ? "SA ID / licence number" : "Vehicle registration (e.g. ABC123GP)"} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.reason} onValueChange={(v) => setForm({ ...form, reason: v })}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10"><SelectValue /></SelectTrigger>
              <SelectContent>{REASONS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white h-10 capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>{SEVERITY.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
          <Textarea placeholder="Notes / incident reference" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-slate-900 border-slate-700 text-white min-h-[60px]" />
          <Button onClick={add} disabled={busy || !norm(form.identifier)} className="w-full bg-rose-500 hover:bg-rose-600">
            <Plus className="w-4 h-4 mr-1" /> Add {kind === "person" ? "person" : "vehicle"} to blacklist
          </Button>
        </div>
      ) : (
        <p className="text-slate-500 text-xs text-center">Your role cannot add {kind} blacklist entries.</p>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input placeholder="Search name, ID, reg, reason…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9 bg-slate-900 border-slate-700 text-white text-sm" />
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map((e) => (
          <div key={e.id} className={`rounded-xl border p-3 ${e.active ? "border-rose-500/30 bg-rose-500/5" : "border-slate-800 bg-slate-900/40 opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white text-sm font-medium truncate">{e.name || "—"}</p>
                  <Badge className={`${severityColor[e.severity] || "bg-slate-600"} text-[10px] capitalize`}>{e.severity}</Badge>
                  {!e.active && <Badge className="bg-slate-700 text-[10px]">INACTIVE</Badge>}
                </div>
                <p className="text-slate-300 text-xs font-mono mt-0.5">{e.identifier_value}</p>
                <p className="text-slate-400 text-xs capitalize">{(REASONS.find((r) => r.value === e.reason)?.label) || e.reason}{e.expiry_date ? ` • expires ${e.expiry_date}` : ""}</p>
                {e.notes && <p className="text-slate-500 text-xs mt-1">{e.notes}</p>}
              </div>
              {canToggle && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => toggle(e)} title={e.active ? "Deactivate" : "Reactivate"} className={`w-8 h-8 rounded-lg flex items-center justify-center ${e.active ? "bg-slate-800 text-amber-400" : "bg-slate-800 text-emerald-400"}`}>
                    {e.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </button>
                  <button onClick={() => remove(e)} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-rose-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">No {kind} blacklist entries.</p>
        )}
      </div>
    </section>
  );
}