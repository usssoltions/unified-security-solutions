import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ShoppingBag, Plus, Minus, ShoppingCart, X, Clock, CheckCircle2 } from "lucide-react";

export default function ResidentOrders() {
  const [user, setUser] = useState(null);
  const [cart, setCart] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const qc = useQueryClient();

  const urlParams = new URLSearchParams(window.location.search);
  const orderType = urlParams.get("type") || "restaurant";

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors_by_type", orderType],
    queryFn: () => base44.entities.Vendor.filter({ category: orderType, status: "active" }),
    initialData: []
  });

  const { data: menuItems = [] } = useQuery({
    queryKey: ["menu_items", orderType],
    queryFn: () => base44.entities.MenuItem.filter({ category: orderType, available: true }),
    initialData: []
  });

  const { data: myOrders = [] } = useQuery({
    queryKey: ["my_orders", user?.id],
    queryFn: () => base44.entities.Order.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const placeMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) return;
      const vendor = vendors[0];
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
      const deliveryFee = vendor?.delivery_fee || 0;
      return await base44.entities.Order.create({
        resident_id: user.id,
        resident_name: user.full_name,
        unit_number: user.unit_number,
        vendor_id: vendor?.id || "",
        vendor_name: vendor?.business_name || "",
        order_type: orderType,
        items: cart.map(item => ({ item_id: item.id, item_name: item.name, quantity: item.qty, unit_price: item.price })),
        subtotal,
        delivery_fee: deliveryFee,
        total: subtotal + deliveryFee,
        delivery_address: `Unit ${user.unit_number}`,
        delivery_notes: deliveryNotes,
        placed_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_orders"]);
      setCart([]);
      setShowCart(false);
      alert("Order placed successfully!");
    }
  });

  const addToCart = (item) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeFromCart = (itemId) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === itemId);
      if (existing?.qty === 1) return prev.filter(c => c.id !== itemId);
      return prev.map(c => c.id === itemId ? { ...c, qty: c.qty - 1 } : c);
    });
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);

  const typeLabels = { restaurant: "Restaurant", shop: "Shop", laundry: "Laundry" };
  const statusColors = { pending: "bg-amber-600", confirmed: "bg-sky-600", preparing: "bg-purple-600", ready: "bg-emerald-500", delivered: "bg-emerald-600", cancelled: "bg-rose-600" };

  const groupedByVendor = vendors.map(v => ({
    vendor: v,
    items: menuItems.filter(m => m.vendor_id === v.id)
  })).filter(g => g.items.length > 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-32">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">{typeLabels[orderType] || "Order"}</h1>
          {cartCount > 0 && (
            <Button onClick={() => setShowCart(true)} className="bg-orange-500 hover:bg-orange-600 relative">
              <ShoppingCart className="w-4 h-4 mr-2" />
              Cart ({cartCount}) — R{cartTotal.toFixed(2)}
            </Button>
          )}
        </div>

        {/* Menu */}
        {groupedByVendor.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <ShoppingBag className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No {orderType} vendors available</p>
            </CardContent>
          </Card>
        ) : groupedByVendor.map(({ vendor, items }) => (
          <div key={vendor.id}>
            <div className="flex items-center gap-3 mb-3">
              {vendor.logo_url && <img src={vendor.logo_url} alt="" className="w-10 h-10 rounded-full object-cover" />}
              <div>
                <p className="text-white font-semibold">{vendor.business_name}</p>
                <p className="text-slate-400 text-xs">{vendor.operating_hours} • {vendor.delivery_available ? "Delivery available" : "Pickup only"}</p>
              </div>
            </div>
            <div className="space-y-2">
              {items.map(item => {
                const inCart = cart.find(c => c.id === item.id);
                return (
                  <Card key={item.id} className="bg-slate-800/50 border-slate-700">
                    <CardContent className="p-3 flex items-center gap-3">
                      {item.photo_url && <img src={item.photo_url} alt={item.name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />}
                      <div className="flex-1">
                        <p className="text-white font-medium">{item.name}</p>
                        <p className="text-slate-400 text-xs line-clamp-1">{item.description}</p>
                        {item.preparation_time_minutes && <p className="text-slate-500 text-xs flex items-center gap-1 mt-1"><Clock className="w-3 h-3" /> ~{item.preparation_time_minutes}min</p>}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-white font-bold">R{item.price?.toFixed(2)}</p>
                        {inCart ? (
                          <div className="flex items-center gap-2">
                            <Button size="icon" className="w-7 h-7 bg-slate-700" onClick={() => removeFromCart(item.id)}><Minus className="w-3 h-3" /></Button>
                            <span className="text-white w-4 text-center">{inCart.qty}</span>
                            <Button size="icon" className="w-7 h-7 bg-orange-500" onClick={() => addToCart(item)}><Plus className="w-3 h-3" /></Button>
                          </div>
                        ) : (
                          <Button size="sm" className="bg-orange-500 hover:bg-orange-600" onClick={() => addToCart(item)}>Add</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}

        {/* My Orders */}
        {myOrders.length > 0 && (
          <div>
            <h2 className="text-white font-semibold mb-3">My Orders</h2>
            <div className="space-y-2">
              {myOrders.filter(o => o.order_type === orderType).slice(0, 5).map(o => (
                <Card key={o.id} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm">{o.vendor_name}</p>
                      <p className="text-slate-400 text-xs">{o.items?.length} items • R{o.total?.toFixed(2)}</p>
                      <p className="text-slate-500 text-xs">{new Date(o.placed_at || o.created_date).toLocaleString()}</p>
                    </div>
                    <Badge className={statusColors[o.status]}>{o.status}</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cart Modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end">
          <Card className="w-full bg-slate-800 border-slate-700 rounded-t-2xl">
            <CardHeader className="border-b border-slate-700 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Your Cart</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowCart(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
              {cart.map(item => (
                <div key={item.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-white">{item.name}</p>
                    <p className="text-slate-400 text-sm">R{item.price?.toFixed(2)} × {item.qty}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="icon" className="w-7 h-7 bg-slate-700" onClick={() => removeFromCart(item.id)}><Minus className="w-3 h-3" /></Button>
                    <span className="text-white w-4 text-center">{item.qty}</span>
                    <Button size="icon" className="w-7 h-7 bg-orange-500" onClick={() => addToCart(item)}><Plus className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
              <Input placeholder="Delivery notes..." value={deliveryNotes} onChange={e => setDeliveryNotes(e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
              <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                <p className="text-white font-bold text-lg">Total: R{cartTotal.toFixed(2)}</p>
                <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => placeMutation.mutate()} disabled={placeMutation.isPending}>
                  {placeMutation.isPending ? "Placing..." : "Place Order"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}