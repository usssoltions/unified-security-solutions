import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Plus, Search } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PullToRefresh from "@/components/PullToRefresh";
import UserForm from "../components/users/UserForm";
import UserCard from "../components/users/UserCard";
import { getTenantUserManagementRoles, isAttendanceOnlyCustomer, ROLE_DESCRIPTIONS, getRoleDisplay } from "@/lib/roleCatalog";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { useToast } from "@/components/ui/use-toast";

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Users via getTenantUsers (server-side) — the built-in User entity only
  // allows platform admins to list users, so customer/reseller admins and
  // medical roles (reception, therapist, practice_admin) cannot reach other
  // users through User.list(). getTenantUsers returns the caller's tenant
  // users (or all users for platform oversight) with the same scoping rules.
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      const res = await base44.functions.invoke("getTenantUsers", {});
      // The SDK's invoke() returns the HTTP response wrapper — the actual
      // payload lives under .data (same normalization as every other
      // backend-function call in this app). Reading res.users directly
      // always yielded undefined → the "0 users" bug.
      const d = res?.data !== undefined ? res.data : res;
      return d?.users || [];
    },
  });

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
  const customerType = customer?.customer_type;

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
            onClick={() => { setEditingUser(null); setShowUserForm(true); }}
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

        {showUserForm && (
          <UserForm
            user={editingUser}
            roles={roles}
            onClose={() => { setShowUserForm(false); setEditingUser(null); }}
            onSuccess={() => { setShowUserForm(false); setEditingUser(null); queryClient.invalidateQueries(["allUsers"]); }}
          />
        )}
      </div>
    </PullToRefresh>
  );
}