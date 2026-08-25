import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  UserCog, Loader2, AlertTriangle, CheckCircle2, Shield, RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { getUserDisplayName } from "@/lib/userDisplayName";

/**
 * LegacyUserMigration — Platform Admin screen to migrate unmigrated users
 * (no customer_id / reseller_id, not a platform admin) into a tenant and
 * grant that tenant the commercial modules the user's role needs.
 *
 * Without this, legacy users land on the SetupRequired page forever. Assigning
 * a tenant alone is insufficient — the tenant must also hold the modules the
 * user's role home is gated behind. This component performs both atomically
 * via the migrateLegacyUser backend function.
 */

const MODULE_OPTIONS = [
  { key: "COMPLETE_SECURITY", label: "Complete Security", contexts: ["security"] },
  { key: "ACCESS", label: "Access Control", contexts: ["security", "estate"] },
  { key: "PATROL", label: "Patrol", contexts: ["security"] },
  { key: "OPERATIONS", label: "Operations", contexts: ["security"] },
  { key: "ESTATE", label: "Estate Management", contexts: ["estate"] },
  { key: "OCCUPATIONAL_THERAPY", label: "Occupational Therapy", contexts: ["medical"] },
  { key: "CALLING", label: "Calling", contexts: ["security", "estate", "medical"] },
  { key: "MESSAGING", label: "Messaging", contexts: ["security", "estate", "medical"] },
  { key: "NOTIFICATION_CORE", label: "Notifications", contexts: ["security", "estate", "medical"] },
  { key: "REPORTING_CORE", label: "Reporting", contexts: ["security", "estate", "medical"] },
  { key: "BARKODER_CORE", label: "Document Scanning", contexts: ["security", "estate", "medical"] },
];

// Default module bundles per customer type — pre-checks the sensible set so
// the admin doesn't have to tick every box for a typical migration.
const DEFAULT_BUNDLE = {
  security: ["COMPLETE_SECURITY", "ACCESS", "PATROL", "OPERATIONS", "CALLING", "MESSAGING", "NOTIFICATION_CORE", "REPORTING_CORE", "BARKODER_CORE"],
  estate: ["ESTATE", "ACCESS", "CALLING", "MESSAGING", "NOTIFICATION_CORE", "REPORTING_CORE", "BARKODER_CORE"],
  medical: ["OCCUPATIONAL_THERAPY", "CALLING", "MESSAGING", "NOTIFICATION_CORE", "REPORTING_CORE", "BARKODER_CORE"],
  industrial: ["COMPLETE_SECURITY", "ACCESS", "PATROL", "OPERATIONS", "NOTIFICATION_CORE", "REPORTING_CORE"],
  business_park: ["COMPLETE_SECURITY", "ACCESS", "PATROL", "NOTIFICATION_CORE", "REPORTING_CORE"],
  corporate: ["COMPLETE_SECURITY", "ACCESS", "NOTIFICATION_CORE", "REPORTING_CORE"],
  other: ["NOTIFICATION_CORE", "REPORTING_CORE"],
};

export default function LegacyUserMigration({ user }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [entitlements, setEntitlements] = useState([]);
  const [migratingId, setMigratingId] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // getAllUsers returns all users for a platform admin.
      const res = await base44.functions.invoke("getAllUsers", {});
      const allUsers = res?.data?.users || res?.users || [];
      const [c, e] = await Promise.all([
        base44.entities.Customer.list().catch(() => []),
        base44.entities.ModuleEntitlement.list().catch(() => []),
      ]);
      setUsers(allUsers);
      setCustomers(c || []);
      setEntitlements(e || []);
    } catch (err) {
      toast({ title: "Failed to load", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Unmigrated = no tenant AND not a platform admin (platform admins are
  // intentionally tenant-free).
  const legacyUsers = useMemo(() => {
    return users.filter(u => {
      const isPlatform = u.role_type === "platform_admin" || u.admin_level === "platform";
      if (isPlatform) return false;
      return !u.customer_id && !u.reseller_id;
    });
  }, [users]);

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <UserCog className="w-5 h-5 text-sky-400" /> Legacy User Migration
          </CardTitle>
          <p className="text-slate-400 text-xs mt-1">
            Users with no tenant assignment (and not Platform Admins) are stuck on the
            "Account Setup Required" page. Assign each to a Customer and grant the
            Customer the modules the user's role needs — both happen atomically.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge className="bg-amber-500/20 text-amber-400">
              <AlertTriangle className="w-3 h-3 mr-1" /> {legacyUsers.length} unmigrated
            </Badge>
            <Button size="sm" variant="outline" onClick={loadData} className="border-slate-700 text-slate-300">
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
          </div>

          {legacyUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2" />
              <p className="text-slate-300 text-sm font-medium">All users are migrated</p>
              <p className="text-slate-500 text-xs">No legacy users without a tenant assignment.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {legacyUsers.map(u => (
                <LegacyUserRow
                  key={u.id}
                  user={u}
                  customers={customers}
                  entitlements={entitlements}
                  migrating={migratingId === u.id}
                  onMigrate={async (customerId, resellerId, moduleKeys, moduleContext) => {
                    setMigratingId(u.id);
                    try {
                      const res = await base44.functions.invoke("migrateLegacyUser", {
                        target_user_id: u.id,
                        customer_id: customerId,
                        reseller_id: resellerId,
                        module_keys: moduleKeys,
                        module_context: moduleContext,
                      });
                      const d = res?.data || res;
                      toast({
                        title: "User migrated",
                        description: `${u.email} → tenant. Modules granted: ${d?.granted_modules?.length || 0}.`,
                      });
                      await loadData();
                    } catch (err) {
                      toast({ title: "Migration failed", description: err.message, variant: "destructive" });
                    } finally {
                      setMigratingId(null);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4 flex items-start gap-3">
          <Shield className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-400 space-y-1">
            <p className="text-slate-300 font-medium">How migration works</p>
            <p>• Assigns the user's <code className="text-sky-400">customer_id</code>, <code className="text-sky-400">reseller_id</code>, and <code className="text-sky-400">module_context</code>.</p>
            <p>• Grants the Customer any selected modules it doesn't already hold (existing licences are never downgraded).</p>
            <p>• Every migration is recorded in the Platform Audit Log.</p>
            <p>• The user must reload the app after migration to pick up the new navigation.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LegacyUserRow({ user, customers, entitlements, migrating, onMigrate }) {
  const [customerId, setCustomerId] = useState("");
  const [selectedModules, setSelectedModules] = useState([]);

  const selectedCustomer = customers.find(c => c.id === customerId);
  const customerType = selectedCustomer?.customer_type || "other";
  const customerResellerId = selectedCustomer?.reseller_id || null;

  // Pre-check the default bundle for the customer type when the customer changes.
  useEffect(() => {
    if (!customerId) { setSelectedModules([]); return; }
    const bundle = DEFAULT_BUNDLE[customerType] || DEFAULT_BUNDLE.other;
    setSelectedModules(bundle);
  }, [customerId, customerType]);

  // Modules the customer already holds — shown as "already granted".
  const existingCustomerModules = useMemo(() => {
    return new Set(entitlements.filter(e => e.customer_id === customerId).map(e => e.module_key));
  }, [entitlements, customerId]);

  const toggleModule = (key) => {
    setSelectedModules(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleMigrate = () => {
    if (!customerId) return;
    onMigrate(customerId, customerResellerId, selectedModules, undefined);
  };

  const modulesForContext = MODULE_OPTIONS.filter(m => m.contexts.includes(customerType));

  return (
    <div className="bg-slate-800/40 p-4 rounded-lg space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-medium truncate">{getUserDisplayName(user)}</p>
          <p className="text-slate-500 text-xs truncate">{user.email}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className="text-slate-300 border-slate-600">{user.role_type || "—"}</Badge>
          <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">No tenant</Badge>
        </div>
      </div>

      <div>
        <Label className="text-slate-400 text-xs">Assign to Customer</Label>
        <Select value={customerId} onValueChange={setCustomerId}>
          <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1">
            <SelectValue placeholder="Select customer…" />
          </SelectTrigger>
          <SelectContent>
            {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.customer_type})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {customerId && (
        <div className="space-y-2">
          <Label className="text-slate-400 text-xs">
            Modules to grant {selectedCustomer?.name} (pre-checked by default for {customerType})
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {modulesForContext.map(m => {
              const already = existingCustomerModules.has(m.key);
              const checked = selectedModules.includes(m.key);
              return (
                <label
                  key={m.key}
                  className={`flex items-center gap-2 p-2 rounded-md border text-sm cursor-pointer transition-colors ${
                    already
                      ? "bg-emerald-500/10 border-emerald-500/30 text-slate-300"
                      : checked
                        ? "bg-sky-500/10 border-sky-500/40 text-white"
                        : "bg-slate-900/50 border-slate-700 text-slate-400"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    disabled={already}
                    onCheckedChange={() => !already && toggleModule(m.key)}
                  />
                  <span className="flex-1">{m.label}</span>
                  {already && <span className="text-[10px] text-emerald-400 font-medium">granted</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}

      <Button
        onClick={handleMigrate}
        disabled={migrating || !customerId}
        className="w-full bg-sky-500 hover:bg-sky-600"
      >
        {migrating
          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Migrating…</>
          : <><CheckCircle2 className="w-4 h-4 mr-2" /> Migrate User & Grant Modules</>}
      </Button>
    </div>
  );
}