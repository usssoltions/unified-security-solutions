import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Building2, Package } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import CustomerModulesModal from "@/components/reseller/CustomerModulesModal";

/**
 * ResellerCustomers — list, create and manage the customers belonging to a
 * reseller. New customers are created with reseller_id auto-set to the current
 * reseller (never manually entered). Platform & reseller admins can create.
 */
export default function ResellerCustomers({ resellerId, customers, onRefresh, canCreate, resellerLicensedKeys, readOnly }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", legal_name: "", customer_type: "security", status: "active" });
  const [modulesFor, setModulesFor] = useState(null);

  const create = async () => {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await base44.entities.Customer.create({
        ...form,
        reseller_id: resellerId, // auto-scoped — never trust manual entry
      });
      toast({ title: "Customer created", description: `${form.name} added under this reseller` });
      setForm({ name: "", legal_name: "", customer_type: "security", status: "active" });
      setShowForm(false);
      onRefresh?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (c, status) => {
    try {
      await base44.entities.Customer.update(c.id, { status });
      toast({ title: `${c.name} ${status}` });
      onRefresh?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{customers.length} customer(s) under this reseller.</p>
        {canCreate && (
          <Button size="sm" onClick={() => setShowForm(!showForm)} className="bg-emerald-500 hover:bg-emerald-600">
            <Plus className="w-4 h-4 mr-1" /> New Customer
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-slate-300 text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
              <div><Label className="text-slate-300 text-xs">Legal Name</Label><Input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
              <div><Label className="text-slate-300 text-xs">Customer Type *</Label>
                <Select value={form.customer_type} onValueChange={(v) => setForm({ ...form, customer_type: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="security">Security</SelectItem><SelectItem value="estate">Estate</SelectItem>
                    <SelectItem value="medical">Medical</SelectItem><SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="business_park">Business Park</SelectItem><SelectItem value="corporate">Corporate</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-slate-300 text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="suspended">Suspended</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded p-2">
              This customer will be automatically scoped to this reseller — no manual reseller ID required.
            </div>
            <Button onClick={create} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Create Customer
            </Button>
          </CardContent>
        </Card>
      )}

      {customers.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No customers yet. Create one to begin.</p>
      ) : customers.map((c) => (
        <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-800/40 p-3 rounded-lg">
          <div className="min-w-0">
            <p className="text-white text-sm font-medium flex items-center gap-2"><Building2 className="w-4 h-4 text-emerald-400" /> {c.name}</p>
            <p className="text-slate-500 text-xs">{c.customer_type} • {c.legal_name || "—"}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!readOnly && (
              <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => setModulesFor(c)}>
                <Package className="w-4 h-4 mr-1" /> Modules
              </Button>
            )}
            {!readOnly && c.status !== "suspended" && (
              <Button size="sm" variant="ghost" className="text-amber-400 hover:text-amber-300" onClick={() => setStatus(c, "suspended")}>Suspend</Button>
            )}
            {!readOnly && c.status === "suspended" && (
              <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300" onClick={() => setStatus(c, "active")}>Activate</Button>
            )}
            <Badge className={c.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}>{c.status}</Badge>
          </div>
        </div>
      ))}

      {modulesFor && (
        <CustomerModulesModal open={!!modulesFor} customer={modulesFor} resellerLicensedKeys={resellerLicensedKeys}
          onClose={() => setModulesFor(null)} onDone={onRefresh} />
      )}
    </div>
  );
}