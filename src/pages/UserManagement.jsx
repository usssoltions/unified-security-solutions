import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Users, Plus, Search, AlertTriangle, Send, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PullToRefresh from "@/components/PullToRefresh";
import UserForm from "../components/users/UserForm";
import UserCard from "../components/users/UserCard";
import TenantUserInviteForm from "@/components/users/TenantUserInviteForm";
import AccountRemovalRequestsPanel from "@/components/account/AccountRemovalRequestsPanel";
import { getTenantUserManagementRoles, isAttendanceOnlyCustomer, ROLE_DESCRIPTIONS, getRoleDisplay } from "@/lib/roleCatalog";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { useToast } from "@/components/ui/use-toast";

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  // Unified invitation flow: every caller scope (Platform, Reseller,
  // Customer Administrator) uses the ONE shared TenantUserInviteForm +
  // inviteTenantUser backend contract. The form locks the customer to the
  // caller's own tenant for Customer Administrators.
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Users via getTenantUsers (server-side) — the built-in User entity only
  // allows platform admins to list users, so customer/reseller admins and
  // medical roles (reception, therapist, practice_admin) cannot reach other
  // users through User.list(). getTenantUsers returns the caller's tenant
  // users (or all users for platform oversight) with the same scoping rules.
  const { data: usersPayload = {}, isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getTenantUsers", {});
      // The SDK's invoke() returns the HTTP response wrapper — the actual
      // payload lives under .data (same normalization as every other
      // backend-function call in this app). Reading res.users directly
      // always yielded undefined → the "0 users" bug.
      const d = res?.data !== undefined ? res.data : res;
      return d || {};
    },
  });
  const users = usersPayload?.users || [];
  // PROVISIONING DIAGNOSTICS: invitations awaiting acceptance, and sign-ups
  // that could not be linked to any invitation ("Account Setup Incomplete").
  const pendingInvitations = usersPayload?.pending_invitations || [];
  const incompleteAccounts = usersPayload?.incomplete_accounts || [];

  // Resolve the current user's tenant type so the role set adapts to the
  // industry vertical (Medical vs Security). Platform admins (no customer)
  // fall back to the Security role set but still see every user.
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: async () => base44.auth.me(),
    retry: false,
  });

  const customerId = currentUser?.customer_id;
  const { data: customer } = useQuery({
    queryKey: ["customer", customerId],
    queryFn: async () => customerId ? base44.entities.Customer.get(customerId) : null,
    enabled: !!customerId,
  });

  const isPlatformAdmin = isPlatformAdminUser(currentUser);

  // AUTHORITATIVE SERVER-SIDE TENANT CONTEXT — session tokens on real devices
  // do not reliably carry custom User fields (customer_id/reseller_id), and
  // direct entity reads are RLS-gated on those same token fields, so BOTH the
  // raw user object and the Customer.get() read can silently resolve empty for
  // a real Customer Administrator. That was the root cause of the Add User
  // form falling back to the platform/reseller branch ("No customers
  // available" + "Loading available roles…" forever + the reseller banner):
  // lockedCustomer never resolved. getGuardLandingConfig resolves the CALLER's
  // own tenant SERVER-SIDE and returns only their own customer's id, name,
  // type and licensed modules — the same authoritative resolver the
  // module-entitlements hook already falls back to.
  const { data: tenantContext, isLoading: tenantContextLoading } = useQuery({
    queryKey: ["tenant_context", currentUser?.id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getGuardLandingConfig", {});
      const d = res?.data !== undefined ? res.data : res;
      return d || {};
    },
    enabled: !!currentUser && !isPlatformAdmin,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
  const effectiveCustomerId = customerId || tenantContext?.customer_id || null;
  const customerType = customer?.customer_type || tenantContext?.customer_type || null;

  // Module-entitlement role catalogue: the roles offered in this tenant's
  // user management (filters, counters, Add/Edit role dropdowns) derive from
  // the customer's ENABLED modules — never from a generic customer_type. An
  // Attendance Register / SecureScan-only customer offers exactly Customer
  // Administrator and Attendance Staff.
  const { data: entitlements = [] } = useModuleEntitlements(currentUser?.id, customerId);
  const enabledModuleKeys = (entitlements || [])
    .filter(e => e.enabled && (!e.status || e.status === "active"))
    .map(e => e.module_key);
  const attendanceOnly = isAttendanceOnlyCustomer(enabledModuleKeys);
  const roles = getTenantUserManagementRoles(enabledModuleKeys, customerType);

  const { toast } = useToast();

  // Tenant admins REMOVE ACCESS (scope/role cleared, global User retained —
  // Base44 does not permit deleting the platform authentication User);
  // platform admins may hard-delete. The server enforces tenant scope and
  // last-admin protection; failures surface as toasts.
  const removeUserMutation = useMutation({
    mutationFn: async ({ user, action }) => {
      const res = await base44.functions.invoke('manageUser', { action, target_user_id: user.id });
      const d = res?.data !== undefined ? res.data : res;
      if (d?.error) throw new Error(d.error);
      return d;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries(["allUsers"]);
      toast({
        title: vars.action === 'delete' ? 'User permanently deleted' : 'User access removed',
        description: `${vars.user.full_name || vars.user.email} can no longer access this account.`,
      });
    },
    onError: (e) => {
      toast({
        title: 'Could not remove user',
        description: e?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  // PROVISIONING REPAIR — the near-match invitation is DIAGNOSTIC ONLY. The
  // admin must explicitly confirm the intended address in the dialog; a fresh
  // invitation is sent to that exact address and the scope is applied ONLY
  // after the invitee verifies it through the invitation flow (server-side,
  // on sign-in). Access is never granted to an account because its email
  // resembles an invitation address.
  const [repairBusy, setRepairBusy] = useState(null);
  const [repairTarget, setRepairTarget] = useState(null);
  const [repairAddress, setRepairAddress] = useState('');
  const openRepairDialog = (acc) => {
    setRepairTarget(acc);
    setRepairAddress(acc.email || '');
  };
  const repairIncomplete = async () => {
    const acc = repairTarget;
    if (!acc) return;
    const mi = acc.matched_invitation || {};
    const invitedEmail = repairAddress.trim().toLowerCase();
    if (!mi.role_type || !invitedEmail) return;
    setRepairBusy(acc.user_id);
    try {
      const res = await base44.functions.invoke('inviteTenantUser', {
        action: 'invite',
        email: invitedEmail,
        role_type: mi.role_type,
        customer_id: mi.customer_id || undefined,
        site_id: mi.site_id || undefined,
        first_name: (acc.full_name || '').trim().split(/\s+/)[0] || undefined,
        repair: true,
      });
      const d = res?.data || res;
      if (d?.error) throw new Error(d.error);
      if (d?.repair_queued) {
        toast({ title: 'Invitation sent', description: `${invitedEmail} must sign in through the invitation flow — their access is applied then, and only to that account.` });
      } else {
        toast({ title: 'Invitation sent', description: `${invitedEmail} will be scoped when they accept.` });
      }
      setRepairTarget(null);
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
    } catch (e) {
      toast({ title: 'Could not repair account', description: e?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setRepairBusy(null);
    }
  };
  const resendPending = async (p) => {
    setRepairBusy(p.id);
    try {
      const res = await base44.functions.invoke('inviteTenantUser', { action: 'resend', pending_scope_id: p.id });
      const d = res?.data || res;
      if (d?.error) throw new Error(d.error);
      if (d?.delivery_status === 'failed') {
        toast({ title: 'Delivery failed', description: d?.error || 'The email could not be sent. The invitation was kept — try again.', variant: 'destructive' });
      } else {
        toast({ title: 'Invitation re-sent', description: `Sent to ${p.email}.` });
      }
      queryClient.invalidateQueries({ queryKey: ['allUsers'] });
    } catch (e) {
      toast({ title: 'Could not resend', description: e?.message || 'Please try again.', variant: 'destructive' });
    } finally {
      setRepairBusy(null);
    }
  };

  const handleEdit = (user) => { setEditingUser(user); setShowUserForm(true); };
  const handleRemove = (user) => {
    const roleLabel = getRoleDisplay(user.role_type) || user.role_type || 'User';
    const confirmMsg =
      `Remove User Access?\n\n` +
      `${user.full_name || user.display_name || user.email}\n` +
      `${user.email}\n` +
      `${roleLabel}\n\n` +
      `This user will no longer be able to access this customer account. Attendance and worker records captured previously will remain intact.`;
    if (!window.confirm(confirmMsg)) return;
    removeUserMutation.mutate({ user, action: isPlatformAdmin ? 'delete' : 'remove_access' });
  };

  const filterUsers = (roleValue) => {
    let filtered = users;
    if (roleValue === "all") {
      if (isPlatformAdmin) {
        // Platform oversight sees every user across all tenants/industries.
        filtered = users;
      } else {
        // Show only the roles relevant to this tenant type.
        const roleValues = new Set(roles.map(r => r.value));
        filtered = users.filter(u => roleValues.has(u.role_type) || (!u.role_type && roleValues.has("admin")));
      }
    } else if (roleValue === "admin_no_role") {
      filtered = users.filter(u => u.role_type === "admin" || !u.role_type);
    } else {
      filtered = users.filter(u => u.role_type === roleValue);
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(u =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.badge_number?.toLowerCase().includes(q)
      );
    }
    return filtered;
  };

  const userStats = {
    total: isPlatformAdmin ? users.length : users.filter(u => roles.some(r => r.value === u.role_type)).length,
    ...Object.fromEntries(roles.map(r => [r.value, users.filter(u => u.role_type === r.value).length])),
  };

  return (
    <PullToRefresh onRefresh={async () => { await queryClient.invalidateQueries({ queryKey: ['allUsers'] }); }}>
      <div className="min-h-screen p-4 lg:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center shrink-0">
              <Users className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-white">User Management</h1>
              <p className="text-slate-400">
                {attendanceOnly ? "Attendance Register users" : (customerType === "medical" ? "Medical practice users" : "Security operations users")}
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              // FAIL-CLOSED INVITATION GATE: a customer/reseller administrator
              // whose tenant context cannot be established can never open the
              // form (so it can never submit an incorrectly scoped invitation).
              if (!isPlatformAdmin && !effectiveCustomerId) {
                toast({
                  title: tenantContextLoading ? "Still confirming your organisation…" : "Could not confirm your organisation",
                  description: tenantContextLoading
                    ? "Add User opens once your tenant context is confirmed — please try again in a moment."
                    : "Invitations stay blocked until your organisation can be verified. Please retry or contact support.",
                  variant: tenantContextLoading ? "default" : "destructive",
                });
                return;
              }
              setShowInviteForm(true);
            }}
            className="bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
          >
            <Plus className="w-5 h-5 mr-2" /> Add User
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center">
                <Users className="w-8 h-8 text-sky-400 mx-auto mb-2" />
                <p className="text-2xl font-bold text-white">{userStats.total}</p>
                <p className="text-sm text-slate-400">Total Users</p>
              </div>
            </CardContent>
          </Card>
          {roles.slice(0, 4).map(r => (
            <Card key={r.value} className="bg-slate-800/50 border-slate-700">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{userStats[r.value] || 0}</p>
                  <p className="text-sm text-slate-400">{r.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Setup needs attention — pending invitations + blocked sign-ups */}
        {(pendingInvitations.length > 0 || incompleteAccounts.length > 0) && (
          <Card className="bg-amber-500/10 border-amber-500/30">
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                <h3 className="text-white font-semibold">Setup needs attention</h3>
              </div>
              {incompleteAccounts.map((acc) => (
                <div key={acc.user_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 border border-amber-500/20 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{acc.full_name || acc.email}</p>
                    <p className="text-xs text-slate-400 truncate">
                      Signed up as {acc.email} but never linked to an invitation
                      {acc.matched_invitation?.email ? ` · closest invitation: ${acc.matched_invitation.email} (${acc.matched_invitation.role_type})` : ''}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openRepairDialog(acc)} disabled={repairBusy === acc.user_id} className="bg-amber-500 hover:bg-amber-600 text-slate-950 shrink-0">
                    <RefreshCw className={`w-4 h-4 mr-1 ${repairBusy === acc.user_id ? 'animate-spin' : ''}`} />
                    Send invite &amp; fix
                  </Button>
                </div>
              ))}
              {pendingInvitations.map((p) => (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/60 border border-slate-700 rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{p.display_name || p.email}</p>
                    <p className="text-xs text-slate-400 truncate">{p.email} · {p.role_type}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={p.delivery_status === 'failed' ? 'destructive' : 'secondary'}>
                      {p.delivery_status === 'failed' ? 'Delivery failed' : 'Awaiting acceptance'}
                    </Badge>
                    <Button size="sm" variant="outline" onClick={() => resendPending(p)} disabled={repairBusy === p.id} className="border-slate-600 text-slate-200">
                      <Send className="w-4 h-4 mr-1" /> Resend
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Search */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by name, email, or badge number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-900 border-slate-700 text-white"
              />
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="bg-slate-800/50 flex-wrap h-auto gap-1">
            <TabsTrigger value="all">All ({userStats.total})</TabsTrigger>
            {roles.map(r => (
              <TabsTrigger key={r.value} value={r.value}>{r.label}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent key="all" value="all" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {isLoading ? (
                <p className="text-slate-400 col-span-full text-center py-8">Loading users...</p>
              ) : filterUsers("all").length === 0 ? (
                <p className="text-slate-400 col-span-full text-center py-8">No users found</p>
              ) : (
                filterUsers("all").map(u => (
                  <UserCard key={u.id} user={u} onEdit={handleEdit} onDelete={handleRemove} />
                ))
              )}
            </div>
          </TabsContent>

          {roles.map(r => (
            <TabsContent key={r.value} value={r.value} className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filterUsers(r.value).length === 0 ? (
                  <p className="text-slate-400 col-span-full text-center py-8">No {r.label.toLowerCase()}s found</p>
                ) : (
                  filterUsers(r.value).map(u => (
                    <UserCard key={u.id} user={u} onEdit={handleEdit} onDelete={handleRemove} />
                  ))
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {/* Account Removal Requests — server-scoped review area
            (customer admins: own customer; reseller admins: own scope;
            platform admins: oversight) */}
        <AccountRemovalRequestsPanel />

        {showUserForm && editingUser && (
          <UserForm
            user={editingUser}
            roles={roles}
            onClose={() => { setShowUserForm(false); setEditingUser(null); }}
            onSuccess={() => { setShowUserForm(false); setEditingUser(null); queryClient.invalidateQueries(["allUsers"]); }}
          />
        )}

        {showInviteForm && (
          <TenantUserInviteForm
            open={showInviteForm}
            onClose={() => setShowInviteForm(false)}
            onDone={() => queryClient.invalidateQueries(["allUsers"])}
            // SERVER-RESOLVED LOCKED CUSTOMER: prefer the authoritative tenant
            // context (works even when the session token / RLS reads come back
            // empty on real devices) and fall back to the direct Customer read.
            lockedCustomer={!isPlatformAdmin && effectiveCustomerId
              ? { id: effectiveCustomerId, name: tenantContext?.customer_name || customer?.name || "" }
              : undefined}
            resellerId={!isPlatformAdmin && !effectiveCustomerId ? currentUser?.reseller_id : undefined}
            allowResellerAdmin={isPlatformAdmin}
            draftOwnerId={currentUser?.id}
          />
        )}

        {repairTarget && (
          <Dialog open={!!repairTarget} onOpenChange={(o) => { if (!o) setRepairTarget(null); }}>
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
              <DialogHeader>
                <DialogTitle>Confirm the intended address</DialogTitle>
                <DialogDescription className="text-slate-400">
                  The similar invitation shown is diagnostic only — access is never granted by resemblance.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 space-y-1">
                  <p className="text-slate-300">Blocked sign-up: <span className="text-white">{repairTarget.full_name || repairTarget.email}</span></p>
                  <p className="text-slate-400 text-xs">Closest invitation: {repairTarget.matched_invitation?.email || '—'} · role {repairTarget.matched_invitation?.role_type || '—'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Send a fresh invitation to this exact address</label>
                  <Input value={repairAddress} onChange={(e) => setRepairAddress(e.target.value)} className="bg-slate-900 border-slate-700 text-white" autoComplete="off" />
                </div>
                <p className="text-xs text-slate-400">
                  Access is applied only after the invitee verifies this address by signing in through the invitation flow.
                  {repairAddress.trim().toLowerCase() !== (repairTarget.email || '').toLowerCase() && ' This is a different address — a brand-new invitation will be created and the blocked account stays unscoped.'}
                </p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setRepairTarget(null)} className="border-slate-600 text-slate-200">Cancel</Button>
                <Button
                  onClick={repairIncomplete}
                  disabled={repairBusy === repairTarget.user_id || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(repairAddress.trim())}
                  className="bg-amber-500 hover:bg-amber-600 text-slate-950"
                >
                  {repairBusy === repairTarget.user_id ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
                  Send invitation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </PullToRefresh>
  );
}