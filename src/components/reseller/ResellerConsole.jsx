import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Building2, Users, MapPin, Package, Palette, Settings, Shield, Activity, Eye, Save, Hash, MapPinned } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import ResellerCustomers from "@/components/reseller/ResellerCustomers";
import ResellerSites from "@/components/reseller/ResellerSites";
import ResellerUsers from "@/components/reseller/ResellerUsers";
import ResellerModules from "@/components/reseller/ResellerModules";

const TABS = [
  { id: "overview", label: "Overview", icon: Building2 },
  { id: "customers", label: "Customers", icon: Users },
  { id: "sites", label: "Sites", icon: MapPin },
  { id: "users", label: "Users", icon: Users },
  { id: "modules", label: "Licences & Modules", icon: Package },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "devices", label: "Devices", icon: MapPinned },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "audit", label: "Audit Log", icon: Activity },
];

export default function ResellerConsole({ resellerId, viewer, viewAs }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [reseller, setReseller] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [entitlements, setEntitlements] = useState([]);
  const [audit, setAudit] = useState([]);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(false);

  const readOnly = !!viewAs;
  const canLicense = viewer === "platform" && !viewAs;
  const canCreateResellerAdmin = viewer === "platform" && !viewAs;
  const canManage = !viewAs;
  const canManageStatus = viewer === "platform" && !viewAs;
  const resellerLicensedKeys = entitlements
    .filter((e) => e.enabled && (!e.status || e.status === "active"))
    .map((e) => e.module_key);

  const load = useCallback(async () => {
    if (!resellerId) return;
    setLoading(true);
    try {
      // TEMPORARY DIAGNOSTIC: run Reseller.get UNSUPPRESSED so the real RLS
      // result/error is captured instead of swallowed by .catch(()=>null).
      // Persisted to PlatformAuditLog for server-side inspection. Remove after
      // the reseller-admin "Reseller not found" issue is resolved.
      let r = null;
      const rGetCapture = { resellerId, ok: false, value: null, error: null, status: null, ts: new Date().toISOString() };
      try {
        r = await base44.entities.Reseller.get(resellerId);
        rGetCapture.ok = !!r;
        rGetCapture.value = r ? { id: r.id, name: r.name, status: r.status } : null;
      } catch (e) {
        rGetCapture.error = String(e?.message || e);
        rGetCapture.status = e?.status;
      }
      try {
        await base44.entities.PlatformAuditLog.create({
          event_type: "reseller.get_capture",
          action: "reseller_get_diagnostic",
          entity_name: "Reseller",
          entity_id: resellerId,
          new_values: JSON.stringify(rGetCapture),
          notes: `Reseller.get(${resellerId}) -> ${rGetCapture.ok ? "found" : rGetCapture.error ? "error" : "null"}`,
        });
      } catch (_) {}

      const [c, s, ents, logs, uRes] = await Promise.all([
        base44.entities.Customer.filter({ reseller_id: resellerId }).catch(() => []),
        base44.entities.Site.filter({ reseller_id: resellerId }).catch(() => []),
        base44.entities.ResellerEntitlement.filter({ reseller_id: resellerId }).catch(() => []),
        base44.entities.PlatformAuditLog.filter({ reseller_id: resellerId }).catch(() => []),
        base44.functions.invoke("getTenantUsers", { reseller_id: resellerId }).catch(() => ({ data: { users: [] } })),
      ]);
      setReseller(r);
      setEdit(r || {});
      setCustomers(c || []);
      setSites(s || []);
      setEntitlements(ents || []);
      setAudit((logs || []).slice().sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
      setUsers((uRes?.data?.users) || (uRes?.users) || []);
    } catch (e) {
      toast({ title: "Failed to load reseller", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [resellerId]);

  useEffect(() => { load(); }, [load]);

  const saveReseller = async (fields) => {
    setSaving(true);
    try {
      const upd = {};
      for (const k of Object.keys(fields)) if (fields[k] !== reseller[k]) upd[k] = fields[k];
      if (Object.keys(upd).length === 0) { toast({ title: "No changes" }); setSaving(false); return; }
      const updated = await base44.entities.Reseller.update(resellerId, upd);
      setReseller(updated);
      setEdit(updated);
      toast({ title: "Reseller updated" });
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }
  if (!reseller) {
    return <div className="text-center py-20 text-slate-400">Reseller not found.</div>;
  }

  const statusBadge = (s) => s === "active" ? "bg-emerald-500/20 text-emerald-400" : s === "suspended" ? "bg-amber-500/20 text-amber-400" : "bg-slate-500/20 text-slate-400";

  return (
    <div className="space-y-4">
      {viewAs && (
        <div className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
          <Eye className="w-5 h-5 text-violet-400 shrink-0" />
          <div className="text-sm">
            <p className="text-violet-300 font-medium">Viewing as Reseller — read only</p>
            <p className="text-slate-400 text-xs">You are previewing this reseller's experience. Your actual permissions are unchanged. This action is audited.</p>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{reseller.name}</h2>
            <p className="text-slate-400 text-xs flex items-center gap-2">
              <Hash className="w-3 h-3" /> {reseller.id?.slice(0, 12)}…
              <Badge className={statusBadge(reseller.status)}>{reseller.status}</Badge>
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
            <CardHeader><CardTitle className="text-white text-sm">Reseller Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Detail label="Trading name" value={reseller.name} />
              <Detail label="Legal name" value={reseller.legal_name} />
              <Detail label="Status" value={<Badge className={statusBadge(reseller.status)}>{reseller.status}</Badge>} />
              <Detail label="Support email" value={reseller.support_email} />
              <Detail label="Contact person" value={reseller.support_name} />
              <Detail label="Contact number" value={reseller.support_phone} />
              <Detail label="Address" value={reseller.address} full />
              <Detail label="Reg. number" value={reseller.registration_number} />
              <Detail label="VAT number" value={reseller.vat_number} />
              <Detail label="Website" value={reseller.website} />
              <Detail label="Created" value={reseller.created_date ? new Date(reseller.created_date).toLocaleString() : "—"} />
              <Detail label="Reseller ID" value={<span className="font-mono text-xs text-slate-400">{reseller.id}</span>} full />
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white text-sm">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Stat label="Customers" value={customers.length} icon={Users} color="text-emerald-400" />
              <Stat label="Sites" value={sites.length} icon={MapPin} color="text-amber-400" />
              <Stat label="Users" value={users.length} icon={Users} color="text-sky-400" />
              <Stat label="Licensed modules" value={resellerLicensedKeys.length} icon={Package} color="text-violet-400" />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "customers" && (
        <ResellerCustomers resellerId={resellerId} customers={customers} onRefresh={load}
          canCreate={canManage} resellerLicensedKeys={resellerLicensedKeys} readOnly={readOnly} />
      )}
      {tab === "sites" && (
        <ResellerSites resellerId={resellerId} customers={customers} sites={sites} onRefresh={load} canCreate={canManage} readOnly={readOnly} />
      )}
      {tab === "users" && (
        <ResellerUsers resellerId={resellerId} resellerName={reseller.name} users={users} onRefresh={load}
          canCreateResellerAdmin={canCreateResellerAdmin} canInvite={canManage} readOnly={readOnly} />
      )}
      {tab === "modules" && (
        <ResellerModules resellerId={resellerId} resellerEntitlements={entitlements} onRefresh={load} canLicense={canLicense} />
      )}

      {tab === "branding" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Palette className="w-4 h-4 text-sky-400" /> White-label Branding</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="App / business name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} disabled={readOnly} />
            <Field label="Logo URL" value={edit.logo_url} onChange={(v) => setEdit({ ...edit, logo_url: v })} disabled={readOnly} />
            <Field label="Primary color" value={edit.primary_color} onChange={(v) => setEdit({ ...edit, primary_color: v })} disabled={readOnly} />
            <Field label="Accent color" value={edit.accent_color} onChange={(v) => setEdit({ ...edit, accent_color: v })} disabled={readOnly} />
            <Field label="Support name" value={edit.support_name} onChange={(v) => setEdit({ ...edit, support_name: v })} disabled={readOnly} />
            <Field label="Support email" value={edit.support_email} onChange={(v) => setEdit({ ...edit, support_email: v })} disabled={readOnly} />
            <Field label="Support phone" value={edit.support_phone} onChange={(v) => setEdit({ ...edit, support_phone: v })} disabled={readOnly} />
            <Field label="Website" value={edit.website} onChange={(v) => setEdit({ ...edit, website: v })} disabled={readOnly} />
            {!readOnly && <Button onClick={() => saveReseller(edit)} disabled={saving} className="bg-sky-500 hover:bg-sky-600 sm:col-span-2">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save Branding
            </Button>}
          </CardContent>
        </Card>
      )}

      {tab === "devices" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><MapPinned className="w-4 h-4 text-amber-400" /> Devices (per site)</CardTitle></CardHeader>
          <CardContent>
            {sites.length === 0 ? <p className="text-slate-500 text-sm text-center py-6">No sites — no allocated devices.</p> : (
              <div className="space-y-2">
                {sites.map((s) => (
                  <div key={s.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
                    <div><p className="text-white text-sm">{s.name}</p><p className="text-slate-500 text-xs">{customers.find((c) => c.id === s.customer_id)?.name || "—"}</p></div>
                    <Badge className="bg-slate-700/40 text-slate-300">{s.checkpoints?.length || 0} checkpoints</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "settings" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Settings className="w-4 h-4 text-slate-400" /> Reseller Settings</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className="text-slate-300 text-xs">Status</Label>
              <Select value={edit.status || "active"} onValueChange={(v) => setEdit({ ...edit, status: v })} disabled={!canManageStatus}>
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
              {!canManageStatus && <p className="text-xs text-slate-500 mt-1">Only Platform Admin can change status.</p>}
            </div>
            <Field label="Legal name" value={edit.legal_name} onChange={(v) => setEdit({ ...edit, legal_name: v })} disabled={readOnly} />
            <Field label="Registration number" value={edit.registration_number} onChange={(v) => setEdit({ ...edit, registration_number: v })} disabled={readOnly} />
            <Field label="VAT number" value={edit.vat_number} onChange={(v) => setEdit({ ...edit, vat_number: v })} disabled={readOnly} />
            <div className="sm:col-span-2"><Label className="text-slate-300 text-xs">Notes</Label>
              <Textarea value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} disabled={readOnly} className="bg-slate-950 border-slate-700 text-white mt-1" rows={3} />
            </div>
            {!readOnly && <Button onClick={() => saveReseller(edit)} disabled={saving} className="bg-sky-500 hover:bg-sky-600 sm:col-span-2">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save Settings
            </Button>}
          </CardContent>
        </Card>
      )}

      {tab === "audit" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-violet-400" /> Audit Log</CardTitle></CardHeader>
          <CardContent>
            {audit.length === 0 ? <p className="text-slate-500 text-sm text-center py-6">No audit entries yet.</p> : (
              <div className="space-y-2 max-h-[28rem] overflow-y-auto pr-1">
                {audit.slice(0, 100).map((a) => (
                  <div key={a.id} className="bg-slate-800/40 p-3 rounded-lg">
                    <div className="flex items-center justify-between">
                      <p className="text-white text-sm font-medium">{a.action || a.event_type}</p>
                      <span className="text-xs text-slate-500">{a.created_date ? new Date(a.created_date).toLocaleString() : ""}</span>
                    </div>
                    <p className="text-slate-400 text-xs">{a.user_name || a.user_id?.slice(0, 8)} • {a.notes || ""}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Detail({ label, value, full }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-slate-500 text-xs">{label}</p>
      <div className="text-slate-200 text-sm mt-0.5">{value || "—"}</div>
    </div>
  );
}
function Stat({ label, value, icon: Icon, color }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg">
      <Icon className={`w-5 h-5 ${color}`} />
      <div><p className="text-2xl font-bold text-white">{value}</p><p className="text-slate-400 text-xs">{label}</p></div>
    </div>
  );
}
function Field({ label, value, onChange, disabled }) {
  return (
    <div>
      <Label className="text-slate-300 text-xs">{label}</Label>
      <Input value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="bg-slate-950 border-slate-700 text-white mt-1 disabled:opacity-60" />
    </div>
  );
}