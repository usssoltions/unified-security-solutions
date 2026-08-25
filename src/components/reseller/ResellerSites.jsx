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
import { Plus, Loader2, MapPin, CheckCircle2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

/**
 * ResellerSites — list and create sites belonging to the reseller's
 * customers. New sites are auto-scoped to the selected customer (and inherit
 * the customer's reseller_id). Platform & reseller admins can create.
 */
export default function ResellerSites({ resellerId, customers, sites, onRefresh, canCreate, readOnly }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ customer_id: "", name: "", address: "", status: "active" });

  const create = async () => {
    if (!form.customer_id) { toast({ title: "Select a customer", variant: "destructive" }); return; }
    if (!form.name || !form.address) { toast({ title: "Name and address required", variant: "destructive" }); return; }
    const customer = customers.find((c) => c.id === form.customer_id);
    if (!customer) { toast({ title: "Invalid customer", variant: "destructive" }); return; }
    setSaving(true);
    try {
      await base44.entities.Site.create({
        name: form.name,
        address: form.address,
        client_name: customer.name,
        customer_id: customer.id,
        reseller_id: customer.reseller_id || resellerId, // inherit reseller scope
        status: form.status,
      });
      toast({ title: "Site created", description: form.name });
      setForm({ customer_id: "", name: "", address: "", status: "active" });
      setShowForm(false);
      onRefresh?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const customerName = (id) => customers.find((c) => c.id === id)?.name || "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-slate-400 text-sm">{sites.length} site(s) across this reseller's customers.</p>
        {canCreate && (
          <Button size="sm" onClick={() => setShowForm(!showForm)} className="bg-amber-500 hover:bg-amber-600">
            <Plus className="w-4 h-4 mr-1" /> New Site
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Label className="text-slate-300 text-xs">Customer *</Label>
                <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-slate-300 text-xs">Site Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
              <div><Label className="text-slate-300 text-xs">Address *</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-slate-950 border-slate-700 text-white mt-1" /></div>
              <div><Label className="text-slate-300 text-xs">Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={create} disabled={saving} className="bg-amber-500 hover:bg-amber-600">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />} Create Site
            </Button>
          </CardContent>
        </Card>
      )}

      {sites.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No sites yet.</p>
      ) : sites.map((s) => (
        <div key={s.id} className="flex items-center justify-between bg-slate-800/40 p-3 rounded-lg">
          <div className="min-w-0">
            <p className="text-white text-sm font-medium flex items-center gap-2"><MapPin className="w-4 h-4 text-amber-400" /> {s.name}</p>
            <p className="text-slate-500 text-xs truncate">{customerName(s.customer_id)} • {s.address || "no address"}</p>
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
  );
}