import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
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
  internal_error: "Invitation failed. Please try again.",
};

/**
 * ResellerAdminInvite — modal to invite a tenant-scoped user.
 *
 * ROLE OPTIONS ARE MODULE-AWARE: they are derived from the modules ENABLED for
 * the selected customer (fetched server-side via manageCustomerEntitlement
 * "list" so reseller admins see the truth even where client-side RLS can't
 * read ModuleEntitlement), using the central module→role registry in
 * src/lib/roleCatalog.js (mirrored + ENFORCED server-side in
 * base44/shared/tenantRoles.ts by inviteTenantUser). The USS Platform Admin
 * role never appears.
 *
 * Customer scoping: only customers of the fixed reseller are offered; when a
 * single customer is in context (opened from a customer console) it is
 * preselected and locked. Identity fields are never cleared when the
 * customer/role changes.
 */
export default function ResellerAdminInvite({
  open, onClose, resellerId, resellerName, customers = [], allowResellerAdmin, onDone,
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [customerList, setCustomerList] = useState(customers || []);
  // null = not loaded yet for the selected customer; [] = loaded (none enabled)
  const [enabledModuleKeys, setEnabledModuleKeys] = useState(null);

  const singleCustomer = customerList.length === 1;
  const blankForm = {
    first_name: "", last_name: "", email: "", phone: "",
    role_type: allowResellerAdmin ? "reseller_admin" : "customer_admin",
    customer_id: singleCustomer ? customerList[0].id : "",
    status: "active",
  };
  const [form, setForm] = useState(blankForm);

  const reset = () => setForm({
    ...blankForm,
    customer_id: singleCustomer ? (customerList[0]?.id || "") : "",
  });

  // When no customers were passed in (reseller Users tab), load the reseller's
  // own customers — RLS scopes reseller admins to their reseller; Platform
  // Admins see the fixed reseller's customers.
  useEffect(() => {
    if (!open) return;
    if ((customers || []).length > 0 || !resellerId) return;
    let alive = true;
    base44.entities.Customer.filter({ reseller_id: resellerId })
      .then((list) => { if (alive) setCustomerList(list || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open, resellerId]);

  // Preselect the single in-context customer once the list resolves.
  useEffect(() => {
    if (customerList.length === 1 && !form.customer_id) {
      setForm((f) => ({ ...f, customer_id: customerList[0].id }));
    }
  }, [customerList]);

  // Fetch the selected customer's ENABLED modules server-side (authoritative
  // for both the role options here and the backend validation).
  useEffect(() => {
    if (!open || !form.customer_id) { setEnabledModuleKeys(null); return; }
    let alive = true;
    setEnabledModuleKeys(null);
    base44.functions.invoke("manageCustomerEntitlement", { action: "list", customer_id: form.customer_id })
      .then((res) => {
        const d = res?.data || res;
        if (alive) setEnabledModuleKeys(d?.module_keys || []);
      })
      .catch(() => { if (alive) setEnabledModuleKeys([]); });
    return () => { alive = false; };
  }, [open, form.customer_id]);

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
  }, [enabledModuleKeys]);

  const isResellerAdminRole = form.role_type === "reseller_admin";
  const needsCustomer = !isResellerAdminRole;
  const rolesLoading = needsCustomer && enabledModuleKeys === null;

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
        reseller_id: resellerId,
        customer_id: needsCustomer ? form.customer_id : null,
        phone: form.phone.trim() || undefined,
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
      console.error("[ResellerAdminInvite] invitation failed", e);
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
            {resellerName && <span className="text-slate-400 text-sm font-normal">· {resellerName}</span>}
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
              onValueChange={(v) => setForm({ ...form, role_type: v })}
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
          <div><Label className="text-slate-300 text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isResellerAdminRole && (
            <div>
              <Label className="text-slate-300 text-xs flex items-center gap-1.5">
                Customer *
                {singleCustomer && <Lock className="w-3 h-3 text-slate-500" />}
              </Label>
              <Select
                value={form.customer_id}
                onValueChange={(v) => setForm({ ...form, customer_id: v })}
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
          )}
          <div className="sm:col-span-2 flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg p-2.5">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300">
              Reseller assignment is fixed to <span className="text-white font-medium">{resellerName || "this reseller"}</span>.
              The invitee receives a non-platform role and is scoped to this reseller{needsCustomer ? " and the selected customer" : ""}. The USS Platform Admin role is never granted.
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