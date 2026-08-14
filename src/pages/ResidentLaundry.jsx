import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShirtIcon, Plus, X, Trash2, Clock, Calendar } from "lucide-react";

const TIME_SLOTS = ["08:00 - 10:00", "10:00 - 12:00", "12:00 - 14:00", "14:00 - 16:00", "16:00 - 18:00"];
const ITEM_TYPES = ["Shirts", "Trousers", "Suits", "Dresses", "Bedding", "Curtains", "Other"];
const SERVICES = [
  { value: "wash", label: "Wash" },
  { value: "dry_clean", label: "Dry Clean" },
  { value: "iron", label: "Iron Only" },
  { value: "wash_iron", label: "Wash & Iron" },
];

const statusColors = {
  scheduled: "bg-amber-600", picked_up: "bg-sky-600", processing: "bg-purple-600",
  ready: "bg-indigo-600", delivered: "bg-emerald-600", cancelled: "bg-rose-600",
};

export default function ResidentLaundry() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    pickup_date: "", pickup_time_slot: "", vendor_id: "", special_instructions: "",
  });
  const [items, setItems] = useState([{ type: "Shirts", quantity: 1, service: "wash" }]);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: vendors = [] } = useQuery({
    queryKey: ["laundry_vendors"],
    queryFn: () => base44.entities.Vendor.filter({ category: "laundry", status: "active" }),
    initialData: [],
  });

  const { data: myRequests = [] } = useQuery({
    queryKey: ["my_laundry", user?.id],
    queryFn: () => base44.entities.LaundryRequest.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const vendor = vendors.find((v) => v.id === data.vendor_id);
      const created = await base44.entities.LaundryRequest.create({
        ...data,
        vendor_name: vendor?.business_name || "",
        resident_id: user.id,
        resident_name: user.display_name || user.full_name,
        unit_number: user.unit_number,
        status: "scheduled",
        payment_status: "unpaid",
      });
      // Notify admins + estate management so the request is actioned.
      try {
        await base44.functions.invoke("notifyAdminsLaundry", {
          requestId: created.id,
          residentName: user.display_name || user.full_name,
          unitNumber: user.unit_number,
          pickupDate: data.pickup_date,
          pickupSlot: data.pickup_time_slot,
          vendorName: vendor?.business_name || "Unassigned",
          itemCount: data.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
          instructions: data.special_instructions,
        });
      } catch (e) { console.warn("laundry notify failed", e?.message || e); }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_laundry"]);
      setShowForm(false);
      setForm({ pickup_date: "", pickup_time_slot: "", vendor_id: "", special_instructions: "" });
      setItems([{ type: "Shirts", quantity: 1, service: "wash" }]);
      alert("Laundry pickup scheduled! Admin & estate management have been notified.");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.LaundryRequest.update(id, { status: "cancelled" }),
    onSuccess: () => qc.invalidateQueries(["my_laundry"]),
  });

  const updateItem = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, { type: "Shirts", quantity: 1, service: "wash" }]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShirtIcon className="w-6 h-6 text-pink-400" /> Laundry Service
          </h1>
          <Button onClick={() => setShowForm(true)} className="bg-pink-500 hover:bg-pink-600">
            <Plus className="w-4 h-4 mr-2" /> Request Pickup
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-pink-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Schedule Laundry Pickup</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Pickup Date *</label>
                  <Input type="date" value={form.pickup_date} onChange={(e) => setForm({ ...form, pickup_date: e.target.value })} min={new Date().toISOString().split("T")[0]} className="bg-slate-900 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Pickup Slot *</label>
                  <Select value={form.pickup_time_slot} onValueChange={(v) => setForm({ ...form, pickup_time_slot: v })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Select slot" /></SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {vendors.length > 0 && (
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Laundry Vendor</label>
                  <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Auto-assign" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.business_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <label className="text-slate-400 text-xs mb-1 block">Items</label>
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select value={it.type} onValueChange={(v) => updateItem(idx, "type", v)}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white flex-1 h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ITEM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="number" min="1" value={it.quantity} onChange={(e) => updateItem(idx, "quantity", e.target.value)} className="bg-slate-900 border-slate-700 text-white w-16 h-10" />
                      <Select value={it.service} onValueChange={(v) => updateItem(idx, "service", v)}>
                        <SelectTrigger className="bg-slate-900 border-slate-700 text-white flex-1 h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SERVICES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Button size="icon" variant="ghost" className="text-rose-400" onClick={() => removeItem(idx)} disabled={items.length === 1}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="mt-2 border-slate-600 text-sky-300" onClick={addItem}><Plus className="w-4 h-4 mr-1" /> Add item</Button>
              </div>

              <Textarea placeholder="Special instructions (stains, delicate items, etc.)" value={form.special_instructions} onChange={(e) => setForm({ ...form, special_instructions: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={2} />

              <Button
                className="w-full bg-pink-600 hover:bg-pink-700"
                onClick={() => createMutation.mutate({ ...form, items })}
                disabled={!form.pickup_date || !form.pickup_time_slot || createMutation.isPending}
              >
                {createMutation.isPending ? "Submitting..." : "Schedule Pickup"}
              </Button>
            </CardContent>
          </Card>
        )}

        {myRequests.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <ShirtIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No laundry requests yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myRequests.map((r) => (
              <Card key={r.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-white font-semibold">{r.vendor_name || "Vendor unassigned"}</p>
                      <p className="text-slate-400 text-xs mt-1 flex items-center gap-1"><Calendar className="w-3 h-3" /> Pickup: {r.pickup_date} • {r.pickup_time_slot}</p>
                      <p className="text-slate-400 text-xs mt-1">{(r.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0)} item(s)</p>
                      {r.special_instructions && <p className="text-slate-500 text-xs mt-1 italic">"{r.special_instructions}"</p>}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Badge className={statusColors[r.status] || "bg-slate-600"}>{r.status?.replace("_", " ")}</Badge>
                      {r.status === "scheduled" && (
                        <Button size="sm" variant="outline" className="border-rose-500 text-rose-400 h-6 text-xs" onClick={() => cancelMutation.mutate(r.id)}>Cancel</Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}