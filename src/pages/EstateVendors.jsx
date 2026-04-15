import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingBag, Plus, X, Phone, Star, Store } from "lucide-react";

const EMPTY_FORM = { business_name: "", contact_name: "", email: "", phone: "", category: "restaurant", description: "", delivery_available: false, delivery_fee: "", minimum_order: "", operating_hours: "", status: "active" };

export default function EstateVendors() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();

  const { data: vendors = [] } = useQuery({ queryKey: ["all_vendors"], queryFn: () => base44.entities.Vendor.list(), initialData: [] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Vendor.create({ ...data, delivery_fee: Number(data.delivery_fee) || 0, minimum_order: Number(data.minimum_order) || 0 }),
    onSuccess: () => { qc.invalidateQueries(["all_vendors"]); setShowForm(false); setForm(EMPTY_FORM); }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Vendor.update(id, { status }),
    onSuccess: () => qc.invalidateQueries(["all_vendors"])
  });

  const statusColors = { active: "bg-emerald-600", inactive: "bg-slate-600", suspended: "bg-rose-600" };
  const catColors = { restaurant: "bg-orange-600", shop: "bg-green-600", laundry: "bg-pink-600", other: "bg-slate-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">Vendors ({vendors.length})</h1>
          <Button onClick={() => setShowForm(true)} className="bg-orange-500 hover:bg-orange-600"><Plus className="w-4 h-4 mr-2" />Add Vendor</Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Vendor</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Input placeholder="Business name *" value={form.business_name} onChange={e => setForm({ ...form, business_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" />
              <Input placeholder="Contact name" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Phone *" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["restaurant", "shop", "laundry", "plumbing", "electrical", "landscaping", "cleaning", "security", "other"].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Operating hours" value={form.operating_hours} onChange={e => setForm({ ...form, operating_hours: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" rows={2} />
              <Input type="number" placeholder="Delivery fee (R)" value={form.delivery_fee} onChange={e => setForm({ ...form, delivery_fee: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input type="number" placeholder="Min order (R)" value={form.minimum_order} onChange={e => setForm({ ...form, minimum_order: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Button className="col-span-2 bg-orange-500 hover:bg-orange-600" onClick={() => createMutation.mutate(form)} disabled={!form.business_name || !form.phone || createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Vendor"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vendors.map(v => (
            <Card key={v.id} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <Store className="w-6 h-6 text-slate-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-white font-semibold">{v.business_name}</p>
                      <Badge className={statusColors[v.status]}>{v.status}</Badge>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Badge className={catColors[v.category] || "bg-slate-600"}>{v.category}</Badge>
                      {v.rating && <span className="text-amber-400 text-xs flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400" />{v.rating}</span>}
                    </div>
                    <p className="text-slate-400 text-sm mt-1">{v.phone}</p>
                    {v.operating_hours && <p className="text-slate-500 text-xs">{v.operating_hours}</p>}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {v.status !== "active" ? (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1" onClick={() => updateStatusMutation.mutate({ id: v.id, status: "active" })}>Activate</Button>
                  ) : (
                    <Button size="sm" variant="outline" className="border-rose-500 text-rose-400 flex-1" onClick={() => updateStatusMutation.mutate({ id: v.id, status: "suspended" })}>Suspend</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {vendors.length === 0 && <p className="text-slate-400 text-center py-8 col-span-2">No vendors yet</p>}
        </div>
      </div>
    </div>
  );
}