import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Loader2, Building2, Package, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import CustomerModulesModal from "@/components/reseller/CustomerModulesModal";

/**
 * ResellerCustomers — list, create and manage the customers belonging to a
 * reseller. New customers are created with reseller_id auto-set to the current
 * reseller (never manually entered). Platform & reseller admins can create.
 */
export default function ResellerCustomers({ resellerId, customers, onRefresh, canCreate, resellerLicensedKeys, readOnly }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", legal_name: "", customer_type: "security", status: "active", device_limit: "" });
  const [modulesFor, setModulesFor] = useState(null);

  const create = async () => {
    if (!form.name) { toast({ title: "Name required", variant: "destructive" }); return; }
    // COMPULSORY Allowed Devices — client-side validation is UX only; the
    // customerAccess gateway enforces it server-side (and forces this
    // reseller's scope regardless of the payload).
    const dl = Number(form.device_limit);
    if (!form.device_limit || !Number.isInteger(dl) || dl < 1) {
      toast({ title: "Allowed Devices required", description: "Enter a whole number of licensed device installations (minimum 1).", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("customerAccess", {
        action: "create",
        name: form.name,
        legal_name: form.legal_name || undefined,
        customer_type: form.customer_type,
        status: form.status,
        device_limit: dl,
        reseller_id: resellerId, // auto-scoped — never trust manual entry
      });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Customer creation failed");
      toast({ title: "Customer created", description: `${form.name} added under this reseller — ${dl} licensed device(s)` });
      setForm({ name: "", legal_name: "", customer_type: "security", status: "active", device_limit: "" });
      setShowForm(false);
      onRefresh?.();
    } catch (e) {
      const d = e?.response?.data || e?.data;
      toast({ title: "Failed", description: d?.error || e?.message || "Customer creation failed", variant: "destructive" });
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
              <div><Label className="text-slate-300 text-xs">Allowed Devices *</Label>
                <Input type="number" min="1" step="1" value={form.device_limit} onChange={(e) => setForm({ ...form, device_limit: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" />
                <p className="text-slate-500 text-xs mt-1">Licensed device installations (whole number, minimum 1). Compulsory — creation is blocked without it.</p>
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
          {/* Full card is tappable to open Customer Management. The buttons
              below stop propagation so Modules / Suspend / Activate remain
              independent actions. */}
          <button
            type="button"
            onClick={() => navigate(`/CustomerManagement?customer=${c.id}`)}
            className="flex items-center gap-2 min-w-0 text-left active:scale-[0.98] transition-transform flex-1"
          >
            <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{c.name}</p>
              <p className="text-slate-500 text-xs truncate">{c.customer_type} • {c.legal_name || "—"} • {c.device_limit == null
                ? <span className="text-amber-400">Device allowance requires configuration</span>
                : `Devices: ${c.device_limit}`}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 ml-auto sm:ml-0" />
          </button>
          <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
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