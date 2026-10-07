import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { listCustomersForSites, listSites } from "@/lib/siteApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, UserPlus, ShieldCheck, Lock, AlertTriangle, RotateCcw } from "lucide-react";
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
  guard_requires_site: "Security Guard requires a site assignment. Select the site this guard will work at.",
  internal_error: "Invitation failed. Please try again.",
};

/** Site-scoped operational roles — these get the Site Assignment field. */
const SITE_SCOPED_ROLES = ["guard", "dispatcher"];

/** Fields preserved in the session-scoped draft (NEVER any credential/secret). */
const DRAFT_FIELDS = ["first_name", "last_name", "email", "phone", "role_type", "customer_id", "site_id", "status"];

/** Draft storage key — scoped to the authenticated user AND the customer context. */
const draftKeyFor = (ownerId, scopeId) => `uss_invite_draft:${ownerId || "anon"}:${scopeId || "general"}`;

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
 * tenantRoles registry (fail closed). The Platform Admin role never
 * appears. Role loading has explicit loading / error / retry states — a load
 * failure NEVER silently substitutes a role and submission stays blocked.
 *
 * MODAL SAFETY (mobile): outside/backdrop clicks and touches can NEVER close
 * the form; Escape, Cancel, Close and the Android back button route through
 * the unsaved-changes guard. Unfinished entries are auto-saved to a
 * session-scoped draft (keyed by user + customer) and restored on reopen with
 * the role revalidated against the current server permissions.
 *
 * Identity fields are never cleared when the customer/role changes.
 */
export default function TenantUserInviteForm({
  open, onClose, onDone,
  resellerId, resellerName, customers = [], allowResellerAdmin,
  lockedCustomer,
  draftOwnerId,
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [customerList, setCustomerList] = useState(
    lockedCustomer ? [lockedCustomer] : (customers || [])
  );
  // null = not loaded yet for the selected customer; [] = loaded (none enabled)
  const [enabledModuleKeys, setEnabledModuleKeys] = useState(null);
  // 'loading' | 'ready' | 'error' — the authoritative role-loading state.
  const [rolesLoadState, setRolesLoadState] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);

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
  // Restored draft metadata (for the restore banner + saved-at display).
  const [draftMeta, setDraftMeta] = useState(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Draft scope: customer-locked context → the locked customer; selectable
  // contexts → the owner's single general draft slot.
  const draftScopeId = customerLocked ? (lockedCustomer?.id || "none") : "general";
  const clearDraft = () => {
    try { sessionStorage.removeItem(draftKeyFor(draftOwnerId, draftScopeId)); } catch (_) {}
    setDraftMeta(null);
  };

  const reset = () => setForm({ ...blankForm, customer_id: initialCustomerId || "" });

  const isDirty = JSON.stringify(form) !== JSON.stringify(blankForm);

  // ── Intentional-close guard (unsaved changes) ────────────────────────────
  const requestClose = () => {
    if (isDirty) { setShowDiscardDialog(true); return; }
    clearDraft();
    reset();
    onClose?.();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Load the selectable customers (reseller context: the reseller's own;
  // platform context: all tenants the caller may read).
  useEffect(() => {
    if (!open || customerLocked) return;
    if ((customers || []).length > 0) return;
    let alive = true;
    // Authoritative customer options via the siteAccess gateway — scoped
    // server-side (reseller admin: own reseller; platform admin: all). The
    // optional resellerId narrowing happens within the authorised set only.
    listCustomersForSites()
      .then((d) => {
        if (!alive) return;
        const customers = (d && d.customers) || [];
        setCustomerList(resellerId ? customers.filter(c => c.reseller_id === resellerId) : customers);
      })
      .catch(() => {});
    return () => { alive = false; };

  }, [open, customerLocked, resellerId]);

  // Preselect the single in-context customer once the list resolves.
  useEffect(() => {
    if (customerList.length === 1 && !form.customer_id) {
      setForm((f) => ({ ...f, customer_id: customerList[0].id }));
    }

  }, [customerList]);

  // ── Draft restore (on open) ──────────────────────────────────────────────
  // Session-scoped storage keyed by the authenticated user + customer — one
  // administrator's draft is never readable by another user or tenant. The
  // restored ROLE and CUSTOMER are revalidated against the current server
  // permissions below (invalid role falls back visibly, never silently into
  // an unlicensed one).
  useEffect(() => {
    if (!open) return;
    let restored = null;
    try { restored = JSON.parse(sessionStorage.getItem(draftKeyFor(draftOwnerId, draftScopeId)) || "null"); } catch (_) {}
    if (!restored) return;
    const hasContent = restored.first_name || restored.last_name || restored.email || restored.phone;
    if (!hasContent) return;
    setForm((f) => ({
      ...f,
      first_name: restored.first_name || "",
      last_name: restored.last_name || "",
      email: restored.email || "",
      phone: restored.phone || "",
      role_type: restored.role_type || f.role_type,
      site_id: restored.site_id || "",
      status: restored.status || "active",
      customer_id: customerLocked ? (lockedCustomer?.id || f.customer_id) : (restored.customer_id || f.customer_id),
    }));
    setDraftMeta(restored);

  }, [open, draftOwnerId, draftScopeId]);

  // ── Draft autosave (only while dirty) ────────────────────────────────────
  useEffect(() => {
    if (!open || !isDirty) return;
    try {
      sessionStorage.setItem(draftKeyFor(draftOwnerId, draftScopeId), JSON.stringify({
        ...Object.fromEntries(DRAFT_FIELDS.map((k) => [k, form[k]])),
        saved_at: new Date().toISOString(),
      }));
    } catch (_) { /* draft storage is best-effort — never blocks the form */ }
  }, [open, isDirty, form, draftOwnerId, draftScopeId]);

  // Fetch the selected customer's ENABLED modules — authoritative for both
  // the role options here and the backend validation. Customer admins resolve
  // via their own direct read first, then the SERVER-SIDE authoritative
  // resolver (getGuardLandingConfig — the caller's own tenant, no broadened
  // access). A total failure surfaces as an explicit error + retry state:
  // roles are NEVER silently substituted and submission stays blocked until
  // the available roles are actually confirmed.
  useEffect(() => {
    if (!open || !form.customer_id) { setEnabledModuleKeys(null); setRolesLoadState("loading"); return; }
    let alive = true;
    setRolesLoadState("loading");
    const fetchKeys = customerLocked
      ? (async () => {
          // Direct entitlement reads can return [] when the session token does
          // not carry custom user fields (RLS {{user.data.customer_id}} → null)
          // — the documented module-entitlements hook defect.
          try {
            const ents = await base44.entities.ModuleEntitlement.filter({ customer_id: form.customer_id, enabled: true });
            const keys = (ents || []).map((e) => e.module_key).filter(Boolean);
            if (keys.length) return keys;
          } catch (_) { /* fall through to the server-side resolver */ }
          try {
            const res = await base44.functions.invoke("getGuardLandingConfig", {});
            const d = res?.data || res;
            if (d?.resolved && Array.isArray(d.module_keys)) return d.module_keys;
          } catch (_) { /* fall through to the error state */ }
          throw new Error("role_sources_unavailable");
        })()
      : base44.functions.invoke("manageCustomerEntitlement", { action: "list", customer_id: form.customer_id })
          .then((res) => { const d = res?.data || res; return d?.module_keys || []; });
    fetchKeys
      .then((keys) => { if (!alive) return; setEnabledModuleKeys(keys); setRolesLoadState("ready"); })
      .catch(() => { if (!alive) return; setEnabledModuleKeys(null); setRolesLoadState("error"); });
    return () => { alive = false; };

  }, [open, customerLocked, form.customer_id, retryKey]);

  const roles = getInviteRolesForCustomer(enabledModuleKeys || [], { allowResellerAdmin });

  // If the selected role is no longer valid for the current customer's
  // modules (e.g. customer changed, or a RESTORED draft role must be
  // revalidated), fall back to Customer Administrator. Only the ROLE is
  // reset — identity fields are preserved. This runs ONLY on a confirmed
  // role list (never on a load failure, which blocks instead).
  useEffect(() => {
    if (rolesLoadState !== "ready") return;
    if (form.role_type === "reseller_admin") return;
    if (!roles.some((r) => r.value === form.role_type)) {
      setForm((f) => ({ ...f, role_type: "customer_admin" }));
    }

  }, [rolesLoadState, enabledModuleKeys]);

  const isResellerAdminRole = form.role_type === "reseller_admin";
  const needsCustomer = !isResellerAdminRole;
  const rolesLoading = needsCustomer && rolesLoadState !== "ready";

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

  }, [open, form.customer_id, needsCustomer]);

  const showSiteField = needsCustomer && SITE_SCOPED_ROLES.includes(form.role_type);

  // ── ANDROID BACK / BROWSER BACK GUARD ────────────────────────────────────
  // While the form is open, a back press does NOT navigate away (which would
  // destroy the form): a history sentinel is re-sealed and the unsaved-changes
  // guard is shown instead. The Layout's global hardware-back seal skips
  // navigation while __ussModalGuardActive is set (the form owns the press).
  useEffect(() => {
    if (!open) return;
    window.__ussModalGuardActive = true;
    window.history.pushState({ ussInviteGuard: true }, "");
    const onPop = () => {
      window.history.pushState({ ussInviteGuard: true }, "");
      requestCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.__ussModalGuardActive = false;
      window.removeEventListener("popstate", onPop);
    };
  }, [open]);

  const submit = async () => {
    if (!form.first_name.trim()) { toast({ title: "First name is required", variant: "destructive" }); return; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Please enter a valid email address", variant: "destructive" }); return;
    }
    if (!form.role_type) { toast({ title: "Please select a role", variant: "destructive" }); return; }
    if (rolesLoadState !== "ready") { toast({ title: "Roles are not confirmed yet", description: "Wait for the available roles to load (or retry) before sending the invitation.", variant: "destructive" }); return; }
    if (needsCustomer && !form.customer_id) { toast({ title: "Please select a customer", variant: "destructive" }); return; }
    // Security Guard REQUIRES a site — an invitation that cannot result in a
    // valid site-scoped account is never sent (the server enforces the same
    // rule authoritatively for every inviter class).
    if (form.role_type === "guard" && !form.site_id) {
      toast({ title: "Site required", description: "Security Guard requires a site assignment. Select the site this guard will work at.", variant: "destructive" });
      return;
    }
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
        else if (d.already_pending) {
          if (d.resend_outcome === "failed") {
            toast({ title: "Delivery failed", description: `The invitation for ${form.email} could not be sent. The invitation was kept — try again.`, variant: "destructive", duration: 10000 });
          } else if (d.resend_outcome === "already_outstanding") {
            toast({ title: "Invitation already pending", description: `Scoping updated for ${form.email}. The platform reports an invitation already outstanding — no duplicate created. If no email arrived, use Resend on the pending invitation card.`, duration: 10000 });
          } else {
            toast({ title: "Invitation re-sent", description: `Scoping updated for ${form.email} and the invitation email was re-dispatched (no duplicate created).` });
          }
        }
        else toast({ title: "Invitation sent", description: `${form.email} will be scoped as ${form.role_type} when they accept.` });
        // NEAR-MISS WARNING (non-blocking): a blocked, never-scoped account
        // already exists for a near-identical address — usually the same
        // invitee who signed up with a typo'd address earlier.
        if (Array.isArray(d.similar_accounts) && d.similar_accounts.length > 0) {
          toast({
            title: "Check the address",
            description: `An unregistered account already exists for ${d.similar_accounts.join(', ')}. If that was meant to be this invitee, invite that exact address instead.`,
            variant: "destructive",
            duration: 10000,
          });
        }
        // Successful invitation — the draft served its purpose; clear it so a
        // stale draft can never produce a duplicate invitation.
        clearDraft();
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) requestClose(); }}>
      {/* MOBILE SAFETY: outside/backdrop taps and focus/pointer events can
          NEVER dismiss the form; Escape routes through the unsaved-changes
          guard instead of discarding silently. */}
      <DialogContent
        className="bg-slate-900 border-slate-700 text-white max-w-lg max-h-[90dvh] flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { e.preventDefault(); requestClose(); }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-sky-400" />
            {isResellerAdminRole ? "Add Reseller Administrator" : "Add User"}
            {customerLocked
              ? (lockedCustomer?.name && <span className="text-slate-400 text-sm font-normal">· {lockedCustomer.name}</span>)
              : (resellerName && <span className="text-slate-400 text-sm font-normal">· {resellerName}</span>)}
          </DialogTitle>
        </DialogHeader>

        {draftMeta && (
          <div className="flex items-start justify-between gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
            <p className="text-xs text-amber-200">
              Unsaved draft restored
              {draftMeta.saved_at ? ` (saved ${new Date(draftMeta.saved_at).toLocaleTimeString()})` : ""}.
              The role and customer are revalidated against your organisation's current permissions.
            </p>
            <button
              onClick={() => { clearDraft(); reset(); }}
              className="text-xs text-amber-300 underline shrink-0"
            >Discard draft</button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2 overflow-y-auto overscroll-contain flex-1 min-h-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
                  {rolesLoadState === "error"
                    ? ""
                    : !form.customer_id
                      ? " — select a customer first"
                      : rolesLoading
                        ? " — loading available roles…"
                        : " — based on this customer's enabled modules"}
                </span>
              )}
            </Label>
            {rolesLoadState === "error" ? (
              <div className="flex items-center gap-2 mt-1 bg-rose-500/10 border border-rose-500/30 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <p className="text-xs text-rose-200 flex-1">
                  Could not load the available roles. Submission stays blocked until the roles are confirmed — nothing has been substituted.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="border-rose-500/40 text-rose-200 shrink-0"
                ><RotateCcw className="w-3 h-3 mr-1" />Retry</Button>
              </div>
            ) : (
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
            )}
            {form.role_type && rolesLoadState === "ready" && (
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {getRoleDescription(form.role_type, enabledModuleKeys || [])}
              </p>
            )}
          </div>
          {showSiteField && (
            <div className="sm:col-span-2">
              <Label className="text-slate-300 text-xs">
                Site Assignment{form.role_type === "guard" ? " *" : ""}
              </Label>
              <Select
                value={form.role_type === "guard" ? form.site_id : (form.site_id || "none")}
                onValueChange={(v) => setForm((f) => ({ ...f, site_id: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue placeholder={form.role_type === "guard" ? "Select the site this guard works at" : "Select a site"} /></SelectTrigger>
                <SelectContent>
                  {form.role_type !== "guard" && (
                    <SelectItem value="none">All sites for this customer (no fixed site)</SelectItem>
                  )}
                  {(sites || []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500 mt-1">
                {form.role_type === "guard"
                  ? "Security Guards require a site — the invitation cannot be sent without one. The site is applied automatically when the invitee accepts."
                  : "Only this customer's active sites are offered. The site is applied automatically when the invitee accepts."}
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
                  The invitee is scoped automatically to your organisation — never to another customer or reseller — and the role is limited to the modules enabled for your organisation. The Platform Admin role is never granted.
                </>
              ) : (
                <>
                  Reseller assignment is fixed to <span className="text-white font-medium">{resellerName || "this reseller"}</span>.
                  The invitee receives a non-platform role and is scoped to this reseller{needsCustomer ? " and the selected customer" : ""}. The Platform Admin role is never granted.
                </>
              )}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={requestClose} className="text-slate-300">Cancel</Button>
          <Button onClick={submit} disabled={saving || rolesLoading} className="bg-sky-500 hover:bg-sky-600">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* UNSAVED-CHANGES GUARD — shown for Cancel, Close (X), Escape and the
          Android/browser back press whenever data has been entered. Nothing
          is discarded automatically. */}
      <Dialog open={showDiscardDialog}>
        <DialogContent
          className="bg-slate-900 border-slate-700 text-white max-w-sm"
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Discard this unfinished invitation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-400">
            Your entered details are kept as a session draft if you save and close or keep editing.
          </p>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowDiscardDialog(false)} className="border-slate-600 text-slate-200">Continue Editing</Button>
            <Button variant="outline" onClick={() => { setShowDiscardDialog(false); onClose?.(); }} className="border-slate-600 text-slate-200">Save Draft &amp; Close</Button>
            <Button variant="destructive" onClick={() => { clearDraft(); reset(); setShowDiscardDialog(false); onClose?.(); }}>Discard Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}