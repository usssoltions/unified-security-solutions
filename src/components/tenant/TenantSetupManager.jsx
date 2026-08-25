import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, Plus, Loader2, MapPin, Database, Play, AlertTriangle,
  CheckCircle2, ArrowRight, RefreshCw, FileText, Shield, UserCog,
} from "lucide-react";
// ArrowRight already imported above (used by migration action + reseller links).
import { useToast } from "@/components/ui/use-toast";
import LegacyUserMigration from "@/components/tenant/LegacyUserMigration";

/**
 * TenantSetupManager — Platform Admin tool to:
 *  1. Create Resellers (optional)
 *  2. Create Customers (direct or under a reseller)
 *  3. View all Sites with current ownership + dependent record counts
 *  4. Assign each Site to a Customer/Reseller explicitly (no auto-assignment)
 *  5. Dry-run migration preview
 *  6. Execute deterministic migration with audit trail
 *  7. Review ambiguous records
 *
 * Platform admin only. No assumptions about ownership.
 */
export default function TenantSetupManager({ user }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [resellers, setResellers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sites, setSites] = useState([]);
  const [activeTab, setActiveTab] = useState("tenants");

  // Forms
  const [showResellerForm, setShowResellerForm] = useState(false);
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [resellerForm, setResellerForm] = useState({ name: "", legal_name: "", support_email: "", status: "active" });
  const [customerForm, setCustomerForm] = useState({ name: "", legal_name: "", customer_type: "security", reseller_id: "direct", status: "active" });

  // Migration
  const [preview, setPreview] = useState(null);
  const [migrating, setMigrating] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [r, c, s] = await Promise.all([
        base44.entities.Reseller.list().catch(() => []),
        base44.entities.Customer.list().catch(() => []),
        base44.entities.Site.list().catch(() => []),
      ]);
      setResellers(r || []);
      setCustomers(c || []);
      setSites(s || []);
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const createReseller = async () => {
    if (!resellerForm.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    try {
      await base44.entities.Reseller.create(resellerForm);
      toast({ title: "Reseller created", description: resellerForm.name });
      setResellerForm({ name: "", legal_name: "", support_email: "", status: "active" });
      setShowResellerForm(false);
      loadData();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const createCustomer = async () => {
    if (!customerForm.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    try {
      const payload = {
        ...customerForm,
        reseller_id: customerForm.reseller_id === "direct" ? null : customerForm.reseller_id,
      };
      await base44.entities.Customer.create(payload);
      toast({ title: "Customer created", description: customerForm.name });
      setCustomerForm({ name: "", legal_name: "", customer_type: "security", reseller_id: "direct", status: "active" });
      setShowCustomerForm(false);
      loadData();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const assignSite = async (siteId, customerId, resellerId) => {
    if (!customerId) { toast({ title: "Select a Customer first", variant: "destructive" }); return; }
    try {
      const reseller = resellerId === "direct" || resellerId === "" ? null : resellerId;
      await base44.entities.Site.update(siteId, { customer_id: customerId, reseller_id: reseller });
      toast({ title: "Site assigned", description: "Ownership updated" });
      loadData();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const res = await base44.functions.invoke("prepareTenantMigration", { mode: "preview" });
      setPreview(res?.data || res);
    } catch (e) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  };

  const runMigration = async () => {
    if (!preview) { toast({ title: "Run preview first", variant: "destructive" }); return; }
    const derivable = preview?.summary?.derivable || 0;
    if (derivable === 0) { toast({ title: "Nothing to migrate", description: "No deterministically derivable records" }); return; }
    if (!window.confirm(`Backfill tenant IDs on ${derivable} records? This is deterministic and audited. No records will be deleted.`)) return;
    setMigrating(true);
    try {
      const res = await base44.functions.invoke("prepareTenantMigration", { mode: "execute" });
      const d = res?.data || res;
      toast({ title: "Migration complete", description: `${d?.summary?.derivable || 0} records backfilled. Run: ${d?.migration_run_id}` });
      setPreview(null);
      loadData();
    } catch (e) {
      toast({ title: "Migration failed", description: e.message, variant: "destructive" });
    } finally {
      setMigrating(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  const TabButton = ({ id, label, icon: Icon }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        activeTab === id ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <TabButton id="tenants" label="Tenants" icon={Building2} />
        <TabButton id="sites" label="Site Assignment" icon={MapPin} />
        <TabButton id="users" label="User Migration" icon={UserCog} />
        <TabButton id="migration" label="Data Migration" icon={Database} />
      </div>

      {/* ===== TENANTS TAB ===== */}
      {activeTab === "tenants" && (
        <div className="space-y-4">
          {/* Resellers */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-sky-400" /> Resellers</CardTitle>
                <p className="text-slate-400 text-xs mt-1">Optional partner organizations. A direct customer does not need one.</p>
              </div>
              <Button size="sm" onClick={() => setShowResellerForm(!showResellerForm)} className="bg-sky-500 hover:bg-sky-600">
                <Plus className="w-4 h-4 mr-1" /> New Reseller
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {showResellerForm && (
                <div className="bg-slate-800/50 p-4 rounded-lg space-y-3 mb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-slate-300 text-xs">Name *</Label><Input value={resellerForm.name} onChange={e => setResellerForm({ ...resellerForm, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white mt-1" /></div>
                    <div><Label className="text-slate-300 text-xs">Legal Name</Label><Input value={resellerForm.legal_name} onChange={e => setResellerForm({ ...resellerForm, legal_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white mt-1" /></div>
                    <div><Label className="text-slate-300 text-xs">Support Email</Label><Input value={resellerForm.support_email} onChange={e => setResellerForm({ ...resellerForm, support_email: e.target.value })} className="bg-slate-900 border-slate-700 text-white mt-1" /></div>
                    <div><Label className="text-slate-300 text-xs">Status</Label>
                      <Select value={resellerForm.status} onValueChange={v => setResellerForm({ ...resellerForm, status: v })}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={createReseller} className="bg-emerald-500 hover:bg-emerald-600">Create Reseller</Button>
                </div>
              )}
              {resellers.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">No resellers yet. Create one if you have partner organizations.</p>
              ) : (
                resellers.map(r => (
                  <Link key={r.id} to={`/ResellerManagement?id=${r.id}`} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg hover:bg-slate-800 hover:border-sky-500/40 border border-transparent transition-colors group">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium group-hover:text-sky-400 flex items-center gap-1.5">
                        {r.name}
                        <ArrowRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-sky-400 transition-colors" />
                      </p>
                      <p className="text-slate-500 text-xs truncate">{r.legal_name || "—"} • {r.support_email || "no email"}</p>
                    </div>
                    <Badge className={r.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}>{r.status}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Customers */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-emerald-400" /> Customers</CardTitle>
                <p className="text-slate-400 text-xs mt-1">Direct (Platform → Customer) or Reseller (Platform → Reseller → Customer).</p>
              </div>
              <Button size="sm" onClick={() => setShowCustomerForm(!showCustomerForm)} className="bg-emerald-500 hover:bg-emerald-600">
                <Plus className="w-4 h-4 mr-1" /> New Customer
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {showCustomerForm && (
                <div className="bg-slate-800/50 p-4 rounded-lg space-y-3 mb-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-slate-300 text-xs">Name *</Label><Input value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white mt-1" /></div>
                    <div><Label className="text-slate-300 text-xs">Legal Name</Label><Input value={customerForm.legal_name} onChange={e => setCustomerForm({ ...customerForm, legal_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white mt-1" /></div>
                    <div><Label className="text-slate-300 text-xs">Customer Type *</Label>
                      <Select value={customerForm.customer_type} onValueChange={v => setCustomerForm({ ...customerForm, customer_type: v })}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="security">Security</SelectItem><SelectItem value="estate">Estate</SelectItem>
                          <SelectItem value="medical">Medical</SelectItem><SelectItem value="industrial">Industrial</SelectItem>
                          <SelectItem value="business_park">Business Park</SelectItem><SelectItem value="corporate">Corporate</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label className="text-slate-300 text-xs">Reseller (direct = no reseller)</Label>
                      <Select value={customerForm.reseller_id} onValueChange={v => setCustomerForm({ ...customerForm, reseller_id: v })}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="direct">Direct (no reseller)</SelectItem>
                          {resellers.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={createCustomer} className="bg-emerald-500 hover:bg-emerald-600">Create Customer</Button>
                </div>
              )}
              {customers.length === 0 ? (
                <p className="text-slate-500 text-sm text-center py-6">No customers yet. Create one to begin tenancy setup.</p>
              ) : (
                customers.map(c => {
                  const r = resellers.find(x => x.id === c.reseller_id);
                  return (
                    <div key={c.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
                      <div>
                        <p className="text-white text-sm font-medium">{c.name}</p>
                        <p className="text-slate-500 text-xs">{c.customer_type} • {r ? `via ${r.name}` : "Direct"}</p>
                      </div>
                      <Badge className={c.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}>{c.status}</Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ===== SITE ASSIGNMENT TAB ===== */}
      {activeTab === "sites" && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2"><MapPin className="w-5 h-5 text-amber-400" /> Site Assignment</CardTitle>
            <p className="text-slate-400 text-xs mt-1">Explicitly assign each existing Site to a Customer (and optional Reseller). No auto-assignment.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {sites.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No sites found.</p>
            ) : sites.map(s => (
              <SiteAssignmentRow key={s.id} site={s} customers={customers} resellers={resellers} onAssign={assignSite} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ===== USER MIGRATION TAB ===== */}
      {activeTab === "users" && (
        <LegacyUserMigration user={user} />
      )}

      {/* ===== MIGRATION TAB ===== */}
      {activeTab === "migration" && (
        <div className="space-y-4">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Database className="w-5 h-5 text-violet-400" /> Migration Dry-Run Preview</CardTitle>
              <p className="text-slate-400 text-xs mt-1">
                Analyzes all records lacking <code className="text-sky-400">customer_id</code> and determines which can be safely derived.
                Writes nothing in preview mode.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-4">
                <Button onClick={runPreview} disabled={previewing} className="bg-sky-500 hover:bg-sky-600">
                  {previewing ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analyzing...</> : <><Play className="w-4 h-4 mr-1" /> Run Dry-Run Preview</>}
                </Button>
                {preview && (
                  <Button onClick={runMigration} disabled={migrating || (preview?.summary?.derivable || 0) === 0} className="bg-emerald-500 hover:bg-emerald-600">
                    {migrating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Migrating...</> : <><ArrowRight className="w-4 h-4 mr-1" /> Execute Migration ({preview.summary.derivable} records)</>}
                  </Button>
                )}
              </div>

              {preview && (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <SummaryCard label="Total Scanned" value={preview.summary.total_records_scanned} color="text-sky-400" />
                    <SummaryCard label="Already Scoped" value={preview.summary.already_scoped} color="text-emerald-400" icon={CheckCircle2} />
                    <SummaryCard label="Deterministically Derivable" value={preview.summary.derivable} color="text-violet-400" icon={ArrowRight} />
                    <SummaryCard label="Ambiguous (needs review)" value={preview.summary.ambiguous} color="text-amber-400" icon={AlertTriangle} />
                  </div>

                  {preview.summary.sites_without_customer > 0 && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg flex items-start gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-amber-400 text-sm font-medium">{preview.summary.sites_without_customer} sites have no customer_id</p>
                        <p className="text-slate-400 text-xs mt-1">Assign sites in the Site Assignment tab before migrating. Records linked to these sites cannot be derived.</p>
                      </div>
                    </div>
                  )}

                  {/* Per-entity breakdown */}
                  <div className="bg-slate-800/50 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium text-slate-400 border-b border-slate-700">
                      <span>Entity</span><span className="text-right">Total</span><span className="text-right">Scoped</span><span className="text-right">Derivable</span><span className="text-right">Ambiguous</span>
                    </div>
                    {Object.entries(preview.per_entity).map(([ent, e]) => (
                      <div key={ent} className="grid grid-cols-5 gap-2 px-3 py-2 text-sm text-slate-300 border-b border-slate-800 last:border-0">
                        <span className="font-medium text-white">{ent}</span>
                        <span className="text-right">{e.total ?? "—"}</span>
                        <span className="text-right text-emerald-400">{e.already_scoped ?? "—"}</span>
                        <span className="text-right text-violet-400">{e.derivable ?? "—"}</span>
                        <span className="text-right text-amber-400">{e.ambiguous ?? "—"}</span>
                      </div>
                    ))}
                  </div>

                  {/* Sample ambiguous records */}
                  {Object.entries(preview.per_entity).some(([, e]) => e.sample_ambiguous?.length > 0) && (
                    <div className="space-y-3">
                      <h4 className="text-white text-sm font-medium flex items-center gap-2"><FileText className="w-4 h-4 text-amber-400" /> Sample Ambiguous Records (for manual review)</h4>
                      {Object.entries(preview.per_entity).filter(([, e]) => e.sample_ambiguous?.length > 0).map(([ent, e]) => (
                        <div key={ent} className="bg-slate-800/40 p-3 rounded-lg">
                          <p className="text-slate-300 text-xs font-medium mb-2">{ent} — {e.ambiguous} ambiguous</p>
                          <div className="space-y-2">
                            {e.sample_ambiguous.map(a => (
                              <div key={a.id} className="bg-slate-900/60 p-2 rounded text-xs">
                                <p className="text-slate-400">Record: <span className="text-slate-300 font-mono">{a.id?.slice(0, 12)}...</span></p>
                                {a.hints?.map((h, i) => <p key={i} className="text-slate-500 ml-3">• {h}</p>)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4 flex items-start gap-3">
              <Shield className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-400 space-y-1">
                <p className="text-slate-300 font-medium">Migration Safety</p>
                <p>• Deterministic only: records derivable via site_id → Site.customer_id or relational User → customer_id.</p>
                <p>• Never overwrites an existing valid customer_id.</p>
                <p>• Never deletes records. Ambiguous records remain for manual review.</p>
                <p>• Every change is logged to PlatformAuditLog with a migration_run_id.</p>
                <p>• Conflicting relational ownership → left ambiguous (no guess).</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SiteAssignmentRow({ site, customers, resellers, onAssign }) {
  const [customerId, setCustomerId] = useState(site.customer_id || "");
  const [resellerId, setResellerId] = useState(site.reseller_id || "direct");
  const [saving, setSaving] = useState(false);

  const dependentCount = (site.checkpoints?.length || 0);
  const hasCustomer = Boolean(site.customer_id);
  const customerName = customers.find(c => c.id === site.customer_id)?.name;

  const save = async () => {
    setSaving(true);
    await onAssign(site.id, customerId, resellerId);
    setSaving(false);
  };

  // Filter resellers based on selected customer's reseller
  const selectedCustomer = customers.find(c => c.id === customerId);
  const applicableResellers = resellers;

  return (
    <div className="bg-slate-800/40 p-3 rounded-lg">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-white text-sm font-medium">{site.name}</p>
          <p className="text-slate-500 text-xs">{site.address || "no address"}</p>
        </div>
        {hasCustomer ? (
          <Badge className="bg-emerald-500/20 text-emerald-400 shrink-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Assigned</Badge>
        ) : (
          <Badge className="bg-amber-500/20 text-amber-400 shrink-0"><AlertTriangle className="w-3 h-3 mr-1" /> Unassigned</Badge>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div>
          <Label className="text-slate-400 text-xs">Customer</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
            <SelectContent>
              {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-400 text-xs">Reseller</Label>
          <Select value={resellerId} onValueChange={setResellerId}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct (none)</SelectItem>
              {applicableResellers.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={save} disabled={saving || !customerId} size="sm" className="bg-sky-500 hover:bg-sky-600">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />} Assign
        </Button>
      </div>
      {hasCustomer && <p className="text-slate-500 text-xs mt-2">Current: {customerName} {selectedCustomer?.reseller_id ? `(via ${resellers.find(r => r.id === selectedCustomer.reseller_id)?.name || "reseller"})` : "(direct)"}</p>}
    </div>
  );
}

function SummaryCard({ label, value, color, icon: Icon }) {
  return (
    <div className="bg-slate-800/50 p-3 rounded-lg">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className={`w-3.5 h-3.5 ${color}`} />}
        <p className="text-slate-400 text-xs">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value ?? 0}</p>
    </div>
  );
}