import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, Search, Phone, Mail, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function EstateProperties() {
  const [user, setUser] = useState(null);
  const [properties, setProperties] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    unit_number: "", address: "", property_type: "house",
    owner_name: "", owner_email: "", owner_phone: "",
    tenant_name: "", tenant_email: "", tenant_phone: "",
    occupancy_status: "owner_occupied", levy_amount: "", site_id: "",
    bedrooms: "", bathrooms: "", notes: "",
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }
      const [props, sts] = await Promise.all([
        base44.entities.Property.filter({ customer_id: cid }).catch(() => []),
        base44.entities.Site.filter({ customer_id: cid }).catch(() => []),
      ]);
      setProperties(props);
      setSites(sts);
    } catch (e) {
      console.error("Failed to load properties:", e);
    } finally {
      setLoading(false);
    }
  };

  const filtered = properties.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.unit_number?.toLowerCase().includes(q) || p.owner_name?.toLowerCase().includes(q) ||
      p.address?.toLowerCase().includes(q) || p.tenant_name?.toLowerCase().includes(q);
  });

  const handleSave = async () => {
    if (!formData.unit_number) return;
    setSaving(true);
    try {
      const site = sites.find(s => s.id === formData.site_id);
      await base44.entities.Property.create({
        ...formData,
        customer_id: user.customer_id,
        levy_amount: formData.levy_amount ? parseFloat(formData.levy_amount) : null,
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
        bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
        site_name: site?.name || "",
        status: "active",
      });
      setShowForm(false);
      setFormData({ unit_number: "", address: "", property_type: "house", owner_name: "", owner_email: "", owner_phone: "", tenant_name: "", tenant_email: "", tenant_phone: "", occupancy_status: "owner_occupied", levy_amount: "", site_id: "", bedrooms: "", bathrooms: "", notes: "" });
      await loadData();
    } catch (e) {
      console.error("Failed to create property:", e);
      alert("Failed to create property: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const occupancyColors = {
    owner_occupied: "bg-emerald-500/20 text-emerald-400",
    tenant_occupied: "bg-sky-500/20 text-sky-400",
    vacant: "bg-amber-500/20 text-amber-400",
    unlisted: "bg-slate-500/20 text-slate-400",
  };

  const levyColors = {
    current: "bg-emerald-500/20 text-emerald-400",
    arrears: "bg-rose-500/20 text-rose-400",
    paid_advance: "bg-sky-500/20 text-sky-400",
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Properties</h1>
              <p className="text-slate-400 text-sm">{properties.length} units registered</p>
            </div>
          </div>
          <Button className="bg-sky-500 hover:bg-sky-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Property
          </Button>
        </div>

        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <Input placeholder="Search by unit, owner, tenant, or address..."
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-slate-900 border-slate-700 text-white" />
        </div>

        {filtered.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">{searchQuery ? "No properties found" : "No properties registered yet"}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(p => (
              <Card key={p.id} className="bg-slate-900 border-slate-800 hover:border-sky-500/30 transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-sky-500/20 rounded-lg flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <p className="text-white font-medium text-sm">Unit {p.unit_number}</p>
                        {p.address && <p className="text-slate-400 text-xs truncate">{p.address}</p>}
                      </div>
                    </div>
                    <Badge className={`text-xs ${occupancyColors[p.occupancy_status] || occupancyColors.unlisted}`}>
                      {(p.occupancy_status || "").replace(/_/g, " ")}
                    </Badge>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {p.owner_name && <p className="text-slate-400">Owner: {p.owner_name}</p>}
                    {p.tenant_name && <p className="text-slate-400">Tenant: {p.tenant_name}</p>}
                    {p.levy_amount && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Levy: R{p.levy_amount}</span>
                        <Badge className={`text-xs ${levyColors[p.levy_status] || levyColors.current}`}>{p.levy_status}</Badge>
                      </div>
                    )}
                    {(p.bedrooms || p.bathrooms) && (
                      <p className="text-slate-400">{p.bedrooms ? `${p.bedrooms} bed` : ""} {p.bathrooms ? `• ${p.bathrooms} bath` : ""}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-white">Add Property</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Unit Number *</Label>
                <Input value={formData.unit_number} onChange={(e) => setFormData({ ...formData, unit_number: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Property Type</Label>
                <Select value={formData.property_type} onValueChange={(v) => setFormData({ ...formData, property_type: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {["house", "townhouse", "apartment", "vacant_stand", "commercial", "other"].map(t =>
                      <SelectItem key={t} value={t} className="text-white">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Address</Label>
              <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Owner Name</Label>
                <Input value={formData.owner_name} onChange={(e) => setFormData({ ...formData, owner_name: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Owner Phone</Label>
                <Input value={formData.owner_phone} onChange={(e) => setFormData({ ...formData, owner_phone: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Tenant Name</Label>
                <Input value={formData.tenant_name} onChange={(e) => setFormData({ ...formData, tenant_name: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Tenant Phone</Label>
                <Input value={formData.tenant_phone} onChange={(e) => setFormData({ ...formData, tenant_phone: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-slate-300 text-sm">Levy (R)</Label>
                <Input type="number" value={formData.levy_amount} onChange={(e) => setFormData({ ...formData, levy_amount: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Beds</Label>
                <Input type="number" value={formData.bedrooms} onChange={(e) => setFormData({ ...formData, bedrooms: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">Baths</Label>
                <Input type="number" value={formData.bathrooms} onChange={(e) => setFormData({ ...formData, bathrooms: e.target.value })}
                  className="bg-slate-800 border-slate-700 text-white mt-1" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formData.unit_number} className="bg-sky-500 hover:bg-sky-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Add Property
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}