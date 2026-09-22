import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Store, ShoppingBag, Plus, X, CheckCircle2, Clock, Package } from "lucide-react";
import BrandHeader from "@/components/branding/BrandHeader";
import {
  getEstateContext, listMenuItems, listOrders, listTickets,
  saveMenuItem, updateOrder,
} from "@/lib/estateApi";

const EMPTY_ITEM = { name: "", description: "", price: "", item_category: "", preparation_time_minutes: "", available: true };

export default function VendorPortal() {
  const [user, setUser] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const qc = useQueryClient();

  // The vendor's own profile and all vendor data are resolved SERVER-SIDE by
  // the estateAccess gateway (self-service scoped to the linked vendor).
  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    getEstateContext().then(ctx => setVendor(ctx?.my_vendor || null)).catch(() => setVendor(null));
  }, []);

  const { data: menuItems = [] } = useQuery({
    queryKey: ["vendor_menu", vendor?.id],
    queryFn: () => listMenuItems().then(r => r.menu_items),
    enabled: !!vendor, initialData: []
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["vendor_orders", vendor?.id],
    queryFn: () => listOrders().then(r => r.orders),
    enabled: !!vendor, initialData: []
  });

  const { data: tickets = [] } = useQuery({
    queryKey: ["vendor_tickets", vendor?.id],
    queryFn: () => listTickets().then(r => r.tickets),
    enabled: !!vendor, initialData: []
  });

  const addItemMutation = useMutation({
    mutationFn: (data) => saveMenuItem({
      ...data,
      price: Number(data.price),
      preparation_time_minutes: Number(data.preparation_time_minutes) || null,
    }),
    onSuccess: () => { qc.invalidateQueries(["vendor_menu"]); setShowItemForm(false); setItemForm(EMPTY_ITEM); }
  });

  const toggleItemMutation = useMutation({
    mutationFn: ({ item, available }) => saveMenuItem({
      id: item.id, name: item.name, price: item.price,
      description: item.description, item_category: item.item_category,
      preparation_time_minutes: item.preparation_time_minutes, available,
    }),
    onSuccess: () => qc.invalidateQueries(["vendor_menu"])
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ id, status }) => updateOrder(id, { status, ...(status === "delivered" ? { completed_at: new Date().toISOString() } : {}) }),
    onSuccess: () => qc.invalidateQueries(["vendor_orders"])
  });

  const orderStatusColors = {
    pending: "bg-amber-600", confirmed: "bg-sky-600", preparing: "bg-purple-600",
    ready: "bg-emerald-600", delivered: "bg-slate-600", cancelled: "bg-rose-600"
  };
  const nextStatus = { pending: "confirmed", confirmed: "preparing", preparing: "ready", ready: "delivered" };

  if (!vendor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 flex items-center justify-center">
        <Card className="bg-slate-800/50 border-slate-700 max-w-sm w-full">
          <CardContent className="p-8 text-center">
            <Store className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-white font-semibold mb-2">No vendor profile found</p>
            <p className="text-slate-400 text-sm">Contact the estate manager to set up your vendor account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeOrders = orders.filter(o => !["delivered", "cancelled"].includes(o.status));
  const revenue = orders.filter(o => o.status === "delivered").reduce((s, o) => s + (o.total || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="pt-2">
          <BrandHeader
            user={user}
            title={vendor.business_name}
            subtitle={`${vendor.category} · ${vendor.status}`}
            icon={Store}
            renderForPlatform
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-800/50 border-slate-700"><CardContent className="p-3 text-center">
            <p className="text-amber-400 text-xl font-bold">{activeOrders.length}</p>
            <p className="text-slate-400 text-xs">Active Orders</p>
          </CardContent></Card>
          <Card className="bg-slate-800/50 border-slate-700"><CardContent className="p-3 text-center">
            <p className="text-sky-400 text-xl font-bold">{menuItems.filter(m => m.available).length}</p>
            <p className="text-slate-400 text-xs">Active Items</p>
          </CardContent></Card>
          <Card className="bg-slate-800/50 border-slate-700"><CardContent className="p-3 text-center">
            <p className="text-emerald-400 text-xl font-bold">R{revenue.toFixed(0)}</p>
            <p className="text-slate-400 text-xs">Revenue</p>
          </CardContent></Card>
        </div>

        <Tabs defaultValue="orders">
          <TabsList className="grid w-full grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="orders">Orders {activeOrders.length > 0 && `(${activeOrders.length})`}</TabsTrigger>
            <TabsTrigger value="menu">Menu</TabsTrigger>
            <TabsTrigger value="tickets">Assigned</TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-3 mt-4">
            {activeOrders.map(o => (
              <Card key={o.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">Unit {o.unit_number} — {o.resident_name}</p>
                      <p className="text-slate-400 text-xs">{new Date(o.placed_at || o.created_date).toLocaleString()}</p>
                      <div className="mt-2 space-y-1">
                        {o.items?.map((item, i) => (
                          <p key={i} className="text-slate-300 text-sm">{item.quantity}× {item.item_name} — R{(item.quantity * item.unit_price).toFixed(2)}</p>
                        ))}
                      </div>
                      {o.delivery_notes && <p className="text-slate-500 text-xs mt-1">Note: {o.delivery_notes}</p>}
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-white font-bold">R{o.total?.toFixed(2)}</p>
                      <Badge className={orderStatusColors[o.status]}>{o.status}</Badge>
                    </div>
                  </div>
                  {nextStatus[o.status] && (
                    <Button size="sm" className="w-full mt-3 bg-sky-600 hover:bg-sky-700" onClick={() => updateOrderMutation.mutate({ id: o.id, status: nextStatus[o.status] })}>
                      Mark as {nextStatus[o.status]}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
            {activeOrders.length === 0 && <p className="text-slate-400 text-center py-8">No active orders</p>}
          </TabsContent>

          <TabsContent value="menu" className="space-y-3 mt-4">
            <Button onClick={() => setShowItemForm(true)} className="w-full bg-orange-500 hover:bg-orange-600"><Plus className="w-4 h-4 mr-2" />Add Menu Item</Button>

            {showItemForm && (
              <Card className="bg-slate-800 border-orange-500">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white text-sm">New Item</CardTitle>
                    <Button variant="ghost" size="icon" onClick={() => setShowItemForm(false)}><X /></Button>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Input placeholder="Item name *" value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" />
                  <Textarea placeholder="Description" value={itemForm.description} onChange={e => setItemForm({ ...itemForm, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" rows={2} />
                  <Input type="number" placeholder="Price (R) *" value={itemForm.price} onChange={e => setItemForm({ ...itemForm, price: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input placeholder="Category (e.g. Mains)" value={itemForm.item_category} onChange={e => setItemForm({ ...itemForm, item_category: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input type="number" placeholder="Prep time (min)" value={itemForm.preparation_time_minutes} onChange={e => setItemForm({ ...itemForm, preparation_time_minutes: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Button className="col-span-2 bg-orange-500 hover:bg-orange-600" onClick={() => addItemMutation.mutate(itemForm)} disabled={!itemForm.name || !itemForm.price || addItemMutation.isPending}>
                    {addItemMutation.isPending ? "Adding..." : "Add Item"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {menuItems.map(item => (
              <Card key={item.id} className={`border-slate-700 ${item.available ? "bg-slate-800/50" : "bg-slate-800/20 opacity-60"}`}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{item.name}</p>
                    <p className="text-slate-400 text-xs">{item.item_category} {item.preparation_time_minutes ? `· ${item.preparation_time_minutes}min` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-white font-bold">R{item.price}</p>
                    <Button size="sm" variant="outline" className={item.available ? "border-rose-500 text-rose-400" : "border-emerald-500 text-emerald-400"}
                      onClick={() => toggleItemMutation.mutate({ item, available: !item.available })}>
                      {item.available ? "Hide" : "Show"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="tickets" className="space-y-3 mt-4">
            {tickets.map(t => (
              <Card key={t.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-white font-semibold">{t.title}</p>
                  <p className="text-slate-400 text-sm">{t.description?.substring(0, 100)}</p>
                  <p className="text-slate-500 text-xs mt-1">Unit {t.unit_number} · {t.status}</p>
                </CardContent>
              </Card>
            ))}
            {tickets.length === 0 && <p className="text-slate-400 text-center py-8">No assigned tickets</p>}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}