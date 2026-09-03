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
import {
  Loader2, Building2, Users, MapPin, Package, Settings, Activity,
  ArrowLeft, Plus, CheckCircle2, UserPlus, ShieldCheck, Mail, Send, X, Smartphone,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useNavigate } from "react-router-dom";
import CustomerModulesModal from "@/components/reseller/CustomerModulesModal";
import ResellerAdminInvite from "@/components/reseller/ResellerAdminInvite";

const TABS = [
  { id: "overview", label: "Overview", icon: Building2 },
  { id: "sites", label: "Sites", icon: MapPin },
  { id: "modules", label: "Modules", icon: Package },
  { id: "users", label: "Users", icon: Users },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "audit", label: "Audit Log", icon: Activity },
];

/** Modules whose operations involve managed/registered hardware (checkpoint
 *  QR hardware, access-control kiosks, patrol devices). The Devices tab is
 *  only shown when at least one of these is enabled for the customer. */
const DEVICE_MODULES = ["ACCESS", "PATROL", "OPERATIONS", "COMPLETE_SECURITY"];

const ROLE_LABEL = {
  reseller_admin: "Reseller Administrator", customer_admin: "Customer Administrator", admin: "Operations Administrator",
  estate_manager: "Estate Manager", practice_admin: "Practice Administrator", dispatcher: "Dispatcher",
  guard: "Security Guard", reception: "Reception", therapist: "Therapist", platform_admin: "Platform Admin",
  attendance_staff: "Attendance Staff",
};

const INVITE_ERRORS = {
  invitation_not_found: "That invitation no longer exists.",
  invitation_not_pending: "That invitation is no longer pending.",
  permission_denied: "You do not have permission to manage invitations.",
};

/**
 * CustomerConsole — management console for a single customer, opened from the
 * reseller's Customers tab (or by a Platform Admin).
 *
 * PERFORMANCE MODEL:
 *  - Only the customer record blocks the initial render — the page shell
 *    appears as soon as it arrives.
 *  - Sites / module entitlements / reseller licences / audit logs load in the
 *    BACKGROUND once (never per tab switch); each list shows its own small
 *    inline loading indicator.
 *  - Users + pending invitations load separately via getTenantUsers and never
 *    block other tabs; they refresh only after an invite/resend/cancel action.
 *  - No invitation or entitlement calls run while other tabs are rendered.
 */
export default function CustomerConsole({ customerId }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(true);          // customer shell only
  const [listsLoading, setListsLoading] = useState(false); // background lists
  const [usersLoading, setUsersLoading] = useState(false); // background users
  const [customer, setCustomer] = useState(null);
  const [sites, setSites] = useState([]);
  const [entitlements, setEntitlements] = useState([]);
  const [resellerEnts, setResellerEnts] = useState([]);
  const [users, setUsers] = useState([]);
  const [pendingInvitations, setPendingInvitations] = useState([]);
  const [inviteBusy, setInviteBusy] = useState(null);
  const [audit, setAudit] = useState([]);
  const [edit, setEdit] = useState({});
  const [saving, setSaving] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [siteForm, setSiteForm] = useState({ show: false, name: "", address: "", status: "active", saving: false });

  // Phase 1 — customer record only (blocking shell).
  const loadCustomer = useCallback(async () => {
    if (!customerId) return null;
    setLoading(true);
    try {
      const c = await base44.entities.Customer.get(customerId).catch(() => null);
      setCustomer(c);
      setEdit(c || {});
      return c;
    } catch (e) {
      toast({ title: "Failed to load customer", description: e.message, variant: "destructive" });
      return null;
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  // Phase 2a — background lists (sites, entitlements, reseller licences, audit).
  const loadLists = useCallback(async (cust) => {
    if (!customerId) return;
    const resellerId = cust?.reseller_id || customer?.reseller_id || null;
    setListsLoading(true);
    try {
      const [s, ents, rEnts, logs] = await Promise.all([
        base44.entities.Site.filter({ customer_id: customerId }).catch(() => []),
        base44.entities.ModuleEntitlement.filter({ customer_id: customerId }).catch(() => []),
        resellerId ? base44.entities.ResellerEntitlement.filter({ reseller_id: resellerId }).catch(() => []) : Promise.resolve([]),
        base44.entities.PlatformAuditLog.filter({ customer_id: customerId }).catch(() => []),
      ]);
      setSites(s || []);
      setEntitlements(ents || []);
      setResellerEnts(rEnts || []);
      setAudit((logs || []).slice().sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (e) {
      console.error("[CustomerConsole] background lists failed", e);
    } finally {
      setListsLoading(false);
    }
  }, [customerId, customer?.reseller_id]);

  // Phase 2b — users + pending invitations (separate; Users tab only consumer).
  const loadUsers = useCallback(async () => {
    if (!customerId) return;
    setUsersLoading(true);
    try {
      const res = await base44.functions.invoke("getTenantUsers", { customer_id: customerId }).catch(() => null);
      const d = res?.data || res || {};
      setUsers(d.users || []);
      setPendingInvitations(d.pending_invitations || []);
    } catch (e) {
      console.error("[CustomerConsole] users load failed", e);
    } finally {
      setUsersLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCustomer();
      if (cancelled || !c) return;
      loadLists(c);   // background — does not block the shell
      loadUsers();    // background
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const resellerLicensedKeys = resellerEnts
    .filter((e) => e.enabled && (!e.status || e.status === "active"))
    .map((e) => e.module_key);
  const activeEntitlements = entitlements.filter((e) => e.enabled && (!e.status || e.status === "active"));
  const activeModuleCount = activeEntitlements.length;
  const devicesApplicable = activeEntitlements.some((e) => DEVICE_MODULES.includes(e.module_key));
  const visibleTabs = TABS.filter((t) => t.id !== "devices" || devicesApplicable);

  const saveSettings = async () => {
    setSaving(true);
    try {
      const upd = {};
      for (const k of ["name", "app_name", "legal_name", "registration_number", "vat_number", "address", "phone", "email", "website", "status", "notes"]) {
        if (edit[k] !== customer[k]) upd[k] = edit[k];
      }
      if (Object.keys(upd).length === 0) { toast({ title: "No changes" }); setSaving(false); return; }
      const updated = await base44.entities.Customer.update(customerId, upd);
      setCustomer(updated);
      setEdit(updated);
      toast({ title: "Customer updated" });
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const createSite = async () => {
    if (!siteForm.name || !siteForm.address) { toast({ title: "Name and address required", variant: "destructive" }); return; }
    setSiteForm((f) => ({ ...f, saving: true }));
    try {
      await base44.entities.Site.create({
        name: siteForm.name,
        address: siteForm.address,
        client_name: customer.name,
        customer_id: customer.id,
        reseller_id: customer.reseller_id,
        status: siteForm.status,
      });
      toast({ title: "Site created", description: siteForm.name });
      setSiteForm({ show: false, name: "", address: "", status: "active", saving: false });
      loadLists(customer);
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
      setSiteForm((f) => ({ ...f, saving: false }));
    }
  };

  // ── Pending invitation actions (server-authorized in inviteTenantUser). ──
  const resendInvitation = async (p) => {
    setInviteBusy(p.id);
    try {
      const res = await base44.functions.invoke("inviteTenantUser", { action: "resend", pending_scope_id: p.id });
      const d = res?.data || res;
      if (d?.delivery_status === "failed" || d?.resent === false) {
        toast({ title: "Delivery Failed", description: d?.error || "The email could not be sent. The invitation was kept.", variant: "destructive" });
      } else {
        toast({ title: "Invitation re-sent", description: `Sent to ${p.email}${d?.already_outstanding ? " (an invitation was already outstanding; no duplicate created)" : ""}.` });
      }
    } catch (e) {
      console.error("[CustomerConsole] resend failed", e);
      const d = e?.response?.data || e?.data;
      toast({ title: "Resend failed", description: INVITE_ERRORS[d?.code] || d?.error || "Please try again.", variant: "destructive" });
    } finally {
      setInviteBusy(null);
      loadUsers();
    }
  };

  const cancelInvitation = async (p) => {
    if (!window.confirm(`Cancel the invitation for ${p.email}? They will not be able to join.`)) return;
    setInviteBusy(p.id);
    try {
      const res = await base44.functions.invoke("inviteTenantUser", { action: "cancel", pending_scope_id: p.id });
      const d = res?.data || res;
      if (!d?.success && d?.error) throw new Error(d.error);
      toast({ title: "Invitation cancelled", description: `${p.email} will not be able to join.` });
    } catch (e) {
      console.error("[CustomerConsole] cancel failed", e);
      const d = e?.response?.data || e?.data;
      toast({ title: "Cancel failed", description: INVITE_ERRORS[d?.code] || d?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setInviteBusy(null);
      loadUsers();
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }
  if (!customer) {
    return <div className="text-center py-20 text-slate-400">Customer not found or you do not have access.</div>;
  }

  const statusBadge = (s) => s === "active" ? "bg-emerald-500/20 text-emerald-400" : s === "suspended" ? "bg-amber-500/20 text-amber-400" : "bg-slate-500/20 text-slate-400";
  const deliveryBadge = (d) => d === "sent" ? "bg-emerald-500/20 text-emerald-400"
    : d === "failed" ? "bg-rose-500/20 text-rose-400"
    : "bg-slate-500/20 text-slate-400";

  const pendingName = (p) => p.display_name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email;

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-sky-400 hover:text-sky-300 text-sm active:scale-95 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Customers
      </button>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{customer.name}</h2>
            <p className="text-slate-400 text-xs flex items-center gap-2">
              {customer.legal_name || "—"} <Badge className={statusBadge(customer.status)}>{customer.status}</Badge>
            </p>
          </div>
        </div>
        <Button onClick={() => setModulesOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 self-start sm:self-auto">
          <Package className="w-4 h-4 mr-1" /> Manage Modules
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="bg-slate-900 border-slate-800 lg:col-span-2">
            <CardHeader><CardTitle className="text-white text-sm">Customer Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <Detail label="Name" value={customer.name} />
              <Detail label="Legal name" value={customer.legal_name} />
              <Detail label="Type" value={customer.customer_type} />
              <Detail label="Status" value={<Badge className={statusBadge(customer.status)}>{customer.status}</Badge>} />
              <Detail label="Reg. number" value={customer.registration_number} />
              <Detail label="VAT number" value={customer.vat_number} />
              <Detail label="Email" value={customer.email} />
              <Detail label="Phone" value={customer.phone} />
              <Detail label="Website" value={customer.website} />
              <Detail label="Address" value={customer.address} full />
              <Detail label="Customer ID" value={<span className="font-mono text-xs text-slate-400">{customer.id}</span>} full />
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white text-sm">Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Stat label="Sites" value={sites.length} loading={listsLoading} icon={MapPin} color="text-amber-400" />
              <Stat label="Active Users" value={users.length} loading={usersLoading} icon={Users} color="text-sky-400" />
              <Stat label="Pending Invitations" value={pendingInvitations.length} loading={usersLoading} icon={Mail} color="text-amber-400" />
              <Stat label="Active modules" value={activeModuleCount} loading={listsLoading} icon={Package} color="text-emerald-400" />
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "sites" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">
              {listsLoading ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading sites…</span> : `${sites.length} site(s) for this customer.`}
            </p>
            <Button size="sm" onClick={() => setSiteForm((f) => ({ ...f, show: !f.show }))} className="bg-amber-500 hover:bg-amber-600">
              <Plus className="w-4 h-4 mr-1" /> New Site
            </Button>
          </div>
          {siteForm.show && (
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><Label className="text-slate-300 text-xs">Site Name *</Label><Input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
                  <div><Label className="text-slate-300 text-xs">Address *</Label><Input value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
                  <div><Label className="text-slate-300 text-xs">Status</Label>
                    <Select value={siteForm.status} onValueChange={(v) => setSiteForm({ ...siteForm, status: v })}>
                      <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded p-2">
                  The site is automatically scoped to this customer and its reseller — no manual IDs required.
                </div>
                <Button onClick={createSite} disabled={siteForm.saving} className="bg-amber-500 hover:bg-amber-600">
                  {siteForm.saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Create Site
                </Button>
              </CardContent>
            </Card>
          )}
          {!listsLoading && sites.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">No sites yet. Create one to begin.</p>
          )}
          {sites.map((s) => (
            <div key={s.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium flex items-center gap-2"><MapPin className="w-4 h-4 text-amber-400" /> {s.name}</p>
                <p className="text-slate-500 text-xs truncate">{s.address || "no address"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500">{s.checkpoints?.length || 0} checkpoints</span>
                <Badge className={s.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}>
                  {s.status === "active" ? <CheckCircle2 className="w-3 h-3 mr-1" /> : null}{s.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "modules" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-slate-400 text-sm">
              {listsLoading ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading modules…</span> : `${activeModuleCount} active module(s) for this customer.`}
            </p>
            <Button onClick={() => setModulesOpen(true)} className="bg-emerald-500 hover:bg-emerald-600">
              <Package className="w-4 h-4 mr-1" /> Manage Modules
            </Button>
          </div>
          {!listsLoading && activeEntitlements.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">No modules enabled yet. Tap "Manage Modules" to allocate.</p>
          )}
          {activeEntitlements.map((e) => (
            <div key={e.id} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg">
              <p className="text-sm font-medium text-white flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> {e.module_label || e.module_key}</p>
              <Badge className="bg-emerald-500/20 text-emerald-400">Enabled</Badge>
            </div>
          ))}
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300">
                Active Users: {usersLoading ? "…" : users.length}
              </span>
              <span className="px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300">
                Pending Invitations: {usersLoading ? "…" : pendingInvitations.length}
              </span>
            </div>
            <Button size="sm" onClick={() => setInviteOpen(true)} className="bg-sky-500 hover:bg-sky-600">
              <UserPlus className="w-4 h-4 mr-1" /> Add User
            </Button>
          </div>

          {usersLoading && (
            <p className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading users…</p>
          )}

          {!usersLoading && users.length === 0 && pendingInvitations.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-8">No users yet. Invite a Customer Admin or operational user.</p>
          )}

          {users.map((u) => (
            <div key={u.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-slate-500" /> {u.display_name || u.full_name || u.email}
                </p>
                <p className="text-slate-500 text-xs">{u.email}</p>
              </div>
              <Badge className="bg-slate-700/60 text-slate-200">{ROLE_LABEL[u.role_type] || u.role_type || "—"}</Badge>
            </div>
          ))}

          {!usersLoading && pendingInvitations.map((p) => (
            <div key={p.id} className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-white text-sm font-medium flex flex-wrap items-center gap-2">
                    <Mail className="w-4 h-4 text-amber-400 shrink-0" />
                    {pendingName(p)}
                    <Badge className="bg-amber-500/20 text-amber-300">Pending Invitation</Badge>
                  </p>
                  <p className="text-slate-400 text-xs mt-0.5 break-all">{p.email}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1.5">
                    <span>Role: <span className="text-slate-300">{ROLE_LABEL[p.role_type] || p.role_type || "—"}</span></span>
                    {p.phone && <span>Mobile: <span className="text-slate-300">{p.phone}</span></span>}
                    <span>Customer: <span className="text-slate-300">{customer.name}</span></span>
                    <span className="flex items-center gap-1">Delivery:
                      <Badge className={deliveryBadge(p.delivery_status)}>
                        {p.delivery_status === "failed" ? "Delivery Failed" : p.delivery_status === "sent" ? "Sent" : "Not sent yet"}
                      </Badge>
                    </span>
                    <span>Sent: <span className="text-slate-300">{(p.sent_at || p.created_date) ? new Date(p.sent_at || p.created_date).toLocaleString() : "—"}</span></span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => resendInvitation(p)} disabled={inviteBusy === p.id}
                    className="border-slate-600 text-slate-200">
                    {inviteBusy === p.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} Resend
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => cancelInvitation(p)} disabled={inviteBusy === p.id}>
                    {inviteBusy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Cancel
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "devices" && (
        !devicesApplicable ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="text-center py-10 space-y-2">
              <Smartphone className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-slate-400 text-sm">Devices is not applicable to this customer.</p>
              <p className="text-slate-500 text-xs max-w-md mx-auto">
                None of this customer's enabled modules involve managed device registration. The Devices tab becomes available when a module that requires it (e.g. Access Control, Patrol, Operations) is enabled.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader><CardTitle className="text-white text-sm">Devices (per site)</CardTitle></CardHeader>
            <CardContent>
              {sites.length === 0 ? <p className="text-slate-500 text-sm text-center py-6">No sites — no allocated devices.</p> : (
                <div className="space-y-2">
                  {sites.map((s) => (
                    <div key={s.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
                      <div><p className="text-white text-sm">{s.name}</p><p className="text-slate-500 text-xs">{s.address || "—"}</p></div>
                      <Badge className="bg-slate-700/40 text-slate-300">{s.checkpoints?.length || 0} checkpoints</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      )}

      {tab === "settings" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Settings className="w-4 h-4 text-slate-400" /> Customer Settings</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label className="text-slate-300 text-xs">Status</Label>
              <Select value={edit.status || "active"} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
              </Select>
            </div>
            <Field label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
            <Field label="Customer-facing app name" value={edit.app_name} onChange={(v) => setEdit({ ...edit, app_name: v })} />
            <Field label="Legal name" value={edit.legal_name} onChange={(v) => setEdit({ ...edit, legal_name: v })} />
            <Field label="Registration number" value={edit.registration_number} onChange={(v) => setEdit({ ...edit, registration_number: v })} />
            <Field label="VAT number" value={edit.vat_number} onChange={(v) => setEdit({ ...edit, vat_number: v })} />
            <Field label="Email" value={edit.email} onChange={(v) => setEdit({ ...edit, email: v })} />
            <Field label="Phone" value={edit.phone} onChange={(v) => setEdit({ ...edit, phone: v })} />
            <Field label="Website" value={edit.website} onChange={(v) => setEdit({ ...edit, website: v })} />
            <Field label="Address" value={edit.address} onChange={(v) => setEdit({ ...edit, address: v })} />
            <div className="sm:col-span-2"><Label className="text-slate-300 text-xs">Notes</Label>
              <Textarea value={edit.notes || ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" rows={3} />
            </div>
            <Button onClick={saveSettings} disabled={saving} className="bg-sky-500 hover:bg-sky-600 sm:col-span-2">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Settings className="w-4 h-4 mr-1" />} Save Settings
            </Button>
          </CardContent>
        </Card>
      )}

      {tab === "audit" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader><CardTitle className="text-white text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-violet-400" /> Audit Log</CardTitle></CardHeader>
          <CardContent>
            {listsLoading ? (
              <p className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading audit entries…</p>
            ) : audit.length === 0 ? <p className="text-slate-500 text-sm text-center py-6">No audit entries yet.</p> : (
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

      {modulesOpen && (
        <CustomerModulesModal open={modulesOpen} customer={customer} resellerLicensedKeys={resellerLicensedKeys}
          onClose={() => setModulesOpen(false)} onDone={() => loadLists(customer)} />
      )}
      {inviteOpen && (
        <ResellerAdminInvite open={inviteOpen} onClose={() => setInviteOpen(false)} onDone={loadUsers}
          resellerId={customer.reseller_id} resellerName="" customers={[customer]} allowResellerAdmin={false} />
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
function Stat({ label, value, loading, icon: Icon, color }) {
  return (
    <div className="flex items-center gap-3 bg-slate-800/40 p-3 rounded-lg">
      <Icon className={`w-5 h-5 ${color}`} />
      <div>
        <p className="text-2xl font-bold text-white">{loading ? "…" : value}</p>
        <p className="text-slate-400 text-xs">{label}</p>
      </div>
    </div>
  );
}
function Field({ label, value, onChange }) {
  return (
    <div>
      <Label className="text-slate-300 text-xs">{label}</Label>
      <Input value={value || ""} onChange={(e) => onChange(e.target.value)} className="bg-slate-950 border-slate-700 text-white mt-1" />
    </div>
  );
}