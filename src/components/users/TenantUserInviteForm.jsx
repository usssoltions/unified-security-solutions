import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { listSites } from "@/lib/siteApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus, ShieldCheck, Lock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getInviteRolesForCustomer, getRoleDescription } from "@/lib/roleCatalog";

/** Friendly, non-leaking messages keyed by the backend error codes. */
const FRIENDLY_ERRORS = {
  invalid_email: "Please enter a valid email address.",
  missing_first_name: "First name is required.",
  missing_role: "Please select a role.",
  missing_customer: "Please select a customer.",
  role_not_allowed: "The selected role is not available for this customer. Roles depend on the modules enabled for this customer.",
  permission_denied: "You do not have permission to invite this user.",
  customer_not_found: "The selected customer could not be found.",
  bad_customer: "That customer does not belong to the selected reseller.",
  scope_failed: "The user exists but could not be scoped. Contact support.",
  invite_service_failed: "The invitation email could not be sent right now. Please try again.",
  bad_site: "The selected site is not valid for this customer.",
  internal_error: "Invitation failed. Please try again.",
};

/** Site-scoped operational roles — these get the Site Assignment field. */
const SITE_SCOPED_ROLES = ["guard", "dispatcher"];

/**
 * TenantUserInviteForm — THE single shared tenant-user invitation form for
 * the entire platform. All invitation flows (Platform, Reseller and Customer
 * Administrator) render this one component and call the same backend contract
 * (inviteTenantUser), which resolves and validates the tenant scope from the
 * AUTHENTICATED CALLER server-side:
 *
 *  - Customer-Admin context: pass `lockedCustomer` ({ id, name }). The customer
 *    is fixed to the caller's own tenant — not selectable, no reseller
 *    selectable, platform scope never exposed. Whatever the browser submits,
 *    inviteTenantUser forces customer_id from the caller's User record and
 *    rejects/ignores any foreign scope.
 *  - Reseller context: pass `resellerId` (+ optional `customers`), as the
 *    reseller console does today.
 *  - Platform context: pass nothing (customers load across all tenants) and
 *    `allowResellerAdmin` to also allow Reseller Administrator creation.
 *
 * ROLE OPTIONS ARE MODULE-AWARE: derived from the selected customer's ENABLED
 * modules and enforced server-side by inviteTenantUser against the shared
 * tenantRoles registry (fail closed). The USS Platform Admin role never
 * appears.
 *
 * Identity fields are never cleared when the customer/role changes.
 */
export default function TenantUserInviteForm({
  open, onClose, onDone,
  resellerId, resellerName, customers = [], allowResellerAdmin,
  lockedCustomer,
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [customerList, setCustomerList] = useState(
    lockedCustomer ? [lockedCustomer] : (customers || [])
  );
  // null = not loaded yet for the selected customer; [] = loaded (none enabled)
  const [enabledModuleKeys, setEnabledModuleKeys] = useState(null);

  const customerLocked = !!lockedCustomer;
  const singleCustomer = customerLocked || customerList.length === 1;
  const initialCustomerId = lockedCustomer?.id || (singleCustomer ? customerList[0]?.id : "");
  const blankForm = {
    first_name: "", last_name: "", email: "", phone: "",
    role_type: allowResellerAdmin ? "reseller_admin" : "customer_admin",
    customer_id: initialCustomerId || "",
    site_id: "",
    status: "active",
  };
  const [form, setForm] = useState(blankForm);

  const reset = () => setForm({ ...blankForm, customer_id: initialCustomerId || "" });

  // Load the selectable customers (reseller context: the reseller's own;
  // platform context: all tenants the caller may read).
  useEffect(() => {
    if (!open || customerLocked) return;
    if ((customers || []).length > 0) return;
    let alive = true;
    const load = resellerId
      ? base44.entities.Customer.filter({ reseller_id: resellerId })
      : base44.entities.Customer.list();
    load
      .then((list) => { if (alive) setCustomerList(list || []); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerLocked, resellerId]);

  // Preselect the single in-context customer once the list resolves.
  useEffect(() => {
    if (customerList.length === 1 && !form.customer_id) {
      setForm((f) => ({ ...f, customer_id: customerList[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerList]);

  // Fetch the selected customer's ENABLED modules — authoritative for both
  // the role options here and the backend validation. Customer admins read
  // their OWN customer's entitlements directly (RLS-scoped, same as the
  // module-entitlements hook); reseller/platform context resolves via
  // manageCustomerEntitlement (authoritative even where client RLS can't
  // read ModuleEntitlement).
  useEffect(() => {
    if (!open || !form.customer_id) { setEnabledModuleKeys(null); return; }
    let alive = true;
    setEnabledModuleKeys(null);
    const fetchKeys = customerLocked
      ? base44.entities.ModuleEntitlement.filter({ customer_id: form.customer_id, enabled: true })
          .then((ents) => (ents || []).map((e) => e.module_key))
      : base44.functions.invoke("manageCustomerEntitlement", { action: "list", customer_id: form.customer_id })
          .then((res) => { const d = res?.data || res; return d?.module_keys || []; });
    fetchKeys
      .then((keys) => { if (alive) setEnabledModuleKeys(keys); })
      .catch(() => { if (alive) setEnabledModuleKeys([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerLocked, form.customer_id]);

  const roles = getInviteRolesForCustomer(enabledModuleKeys || [], { allowResellerAdmin });

  // If the selected role is no longer valid for the current customer's
  // modules (e.g. customer changed), fall back to Customer Administrator.
  // Only the ROLE is reset — identity fields are preserved.
  useEffect(() => {
    if (!enabledModuleKeys) return;
    if (form.role_type === "reseller_admin") return;
    if (!roles.some((r) => r.value === form.role_type)) {
      setForm((f) => ({ ...f, role_type: "customer_admin" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledModuleKeys]);

  const isResellerAdminRole = form.role_type === "reseller_admin";
  const needsCustomer = !isResellerAdminRole;
  const rolesLoading = needsCustomer && enabledModuleKeys === null;

  // Site options for site-scoped operational roles — the SELECTED customer's
  // active sites only, via the secure siteAccess gateway (never cross-tenant;
  // the server re-validates the site→customer relationship on submit).
  const [sites, setSites] = useState(null);
  useEffect(() => {
    if (!open || !needsCustomer || !form.customer_id) { setSites(null); return; }
    let alive = true;
    setSites(null);
    listSites({ customer_id: form.customer_id })
      .then((list) => {
        if (!alive) return;
        const active = (list || []).filter((s) => s.status === "active");
        setSites(active);
        // Single-site customers: preselect it, keeping the assignment explicit
        // and visible in the dropdown.
        if (active.length === 1) {
          setForm((f) => (f.site_id ? f : { ...f, site_id: active[0].id }));
        }
      })
      .catch(() => { if (alive) setSites([]); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form.customer_id, needsCustomer]);

  const showSiteField = needsCustomer && SITE_SCOPED_ROLES.includes(form.role_type);

  const submit = async () => {
    if (!form.first_name.trim()) { toast({ title: "First name is required", variant: "destructive" }); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Please enter a valid email address", variant: "destructive" }); return;
    }
    if (!form.role_type) { toast({ title: "Please select a role", variant: "destructive" }); return; }
    if (needsCustomer && !form.customer_id) { toast({ title: "Please select a customer", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("inviteTenantUser", {
        action: "invite",
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        role_type: form.role_type,
        // Customer-Admin context never submits a reseller scope — the server
        // resolves it from the Customer record and forces the caller's own
        // customer_id regardless of what this payload contains.
        reseller_id: customerLocked ? undefined : resellerId,
        customer_id: needsCustomer ? form.customer_id : null,
        phone: form.phone.trim() || undefined,
        site_id: showSiteField && form.site_id ? form.site_id : undefined,
        user_status: form.status,
      });
      const d = res?.data || res;
      if (d?.success) {
        if (d.rescoped) toast({ title: "Existing user re-scoped", description: `${form.email} already existed and was updated to ${form.role_type}.` });
        else if (d.already_pending) toast({ title: "Invitation already pending", description: `Scoping updated for ${form.email}. No duplicate invite sent.` });
        else toast({ title: "Invitation sent", description: `${form.email} will be scoped as ${form.role_type} when they accept.` });
        reset();
        onDone?.();
        onClose?.();
        return;
      }
      // 2xx but not success (e.g. partial delivery) — friendly message, form retained.
      throw new Error(FRIENDLY_ERRORS[d?.code] || d?.error || "Invitation failed. Please try again.");
    } catch (e) {
      // Log full detail for diagnostics, but never surface raw transport errors.
      console.error("[TenantUserInviteForm] invitation failed", e);
      const d = e?.response?.data || e?.data;
      let msg = (d?.code && FRIENDLY_ERRORS[d?.code]) || d?.error || e?.message || "Invitation failed. Please try again.";
      if (/status code|network error|request failed/i.test(msg)) msg = "Invitation failed. Please try again.";
      toast({ title: "Failed to invite", description: msg, variant: "destructive" });
      // Form data is intentionally retained so the admin can retry.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose?.(); } }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-sky-400" />
            {isResellerAdminRole ? "Add Reseller Administrator" : "Add User"}
            {customerLocked
              ? (lockedCustomer?.name && <span className="text-slate-400 text-sm font-normal">· {lockedCustomer.name}</span>)
              : (resellerName && <span className="text-slate-400 text-sm font-normal">· {resellerName}</span>)}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div><Label className="text-slate-300 text-xs">First Name *</Label>
            <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Last Name</Label>
            <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div><Label className="text-slate-300 text-xs">Mobile Number</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-slate-300 text-xs flex items-center gap-1.5">
              Role *
              {needsCustomer && (
                <span className="text-slate-500 font-normal">
                  {rolesLoading ? " — loading available roles…" : " — based on this customer's enabled modules"}
                </span>
              )}
            </Label>
            <Select
              value={form.role_type}
              onValueChange={(v) => setForm((f) => ({ ...f, role_type: v, site_id: SITE_SCOPED_ROLES.includes(v) ? f.site_id : "" }))}
              disabled={rolesLoading}
            >
              <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.role_type && !rolesLoading && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {getRoleDescription(form.role_type, enabledModuleKeys || [])}
              </p>
            )}
          </div>
          {showSiteField && (
            <div className="sm:col-span-2">
              <Label className="text-slate-300 text-xs">Site Assignment</Label>
              <Select
                value={form.site_id || "none"}
                onValueChange={(v) => setForm((f) => ({ ...f, site_id: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">All customer sites (no fixed site)</SelectItem>
                  {(sites || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                Only this customer's active sites are offered. The site is applied automatically when the invitee accepts.
              </p>
            </div>
          )}
          <div><Label className="text-slate-300 text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
              <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isResellerAdminRole && (
            customerLocked ? (
              <div>
                <Label className="text-slate-300 text-xs flex items-center gap-1.5">
                  Customer
                  <Lock className="w-3 h-3 text-slate-500" />
                </Label>
                <div className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 mt-1">
                  <span className="text-sm text-white">{lockedCustomer?.name || "Your organisation"}</span>
                  <p className="text-xs text-slate-500 mt-0.5">Fixed to your organisation — not selectable.</p>
                </div>
              </div>
            ) : (
              <div>
                <Label className="text-slate-300 text-xs flex items-center gap-1.5">
                  Customer *
                  {singleCustomer && <Lock className="w-3 h-3 text-slate-500" />}
                </Label>
                <Select
                  value={form.customer_id}
                  onValueChange={(v) => setForm((f) => ({ ...f, customer_id: v, site_id: "" }))}
                  disabled={singleCustomer}
                >
                  <SelectTrigger className="bg-slate-950 border-slate-700 mt-1">
                    <SelectValue placeholder={customerList.length === 0 ? "No customers available" : "Select customer"} />
                  </SelectTrigger>
                  <SelectContent>
                    {customerList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )
          )}
          <div className="sm:col-span-2 flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300">
              {customerLocked ? (
                <>
                  Customer assignment is fixed to <span className="text-white font-medium">{lockedCustomer?.name || "your organisation"}</span>.
                  The invitee is scoped automatically to your organisation — never to another customer or reseller — and the role is limited to the modules enabled for your organisation. The USS Platform Admin role is never granted.
                </>
              ) : (
                <>
                  Reseller assignment is fixed to <span className="text-white font-medium">{resellerName || "this reseller"}</span>.
                  The invitee receives a non-platform role and is scoped to this reseller{needsCustomer ? " and the selected customer" : ""}. The USS Platform Admin role is never granted.
                </>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose?.(); }} className="text-slate-300">Cancel</Button>
          <Button onClick={submit} disabled={saving || rolesLoading} className="bg-sky-500 hover:bg-sky-600">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}