import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Users, X, CheckCircle2, Building2, Plus, AlertCircle, ShoppingCart } from "lucide-react";

const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
// Two [start,end) ranges on the same day overlap if aStart < bEnd && bStart < aEnd.
const overlaps = (aStart, aEnd, bStart, bEnd) => toMin(aStart) < toMin(bEnd) && toMin(bStart) < toMin(aEnd);

// Hourly slots the estate offers for bookings.
const SLOT_START = 8;
const SLOT_END = 20;
const generateSlots = () => {
  const slots = [];
  for (let h = SLOT_START; h < SLOT_END; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00-${String(h + 1).padStart(2, "0")}:00`);
  }
  return slots;
};
const slotToRange = (slot) => slot.split("-");

export default function ResidentBookings() {
  const [user, setUser] = useState(null);
  const [cart, setCart] = useState([]); // [{ venue, booking_date, start_time, end_time, guest_count, purpose, special_requirements }]
  const [date, setDate] = useState("");
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: venues = [] } = useQuery({
    queryKey: ["venues_active"],
    queryFn: () => base44.entities.Venue.filter({ status: "active" }),
    initialData: [],
  });

  const { data: myBookings = [] } = useQuery({
    queryKey: ["my_bookings_list", user?.id],
    queryFn: () => base44.entities.VenueBooking.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: [],
  });

  // All bookings (to detect conflicts across the whole estate on a date).
  const { data: allBookings = [] } = useQuery({
    queryKey: ["all_venue_bookings"],
    queryFn: () => base44.entities.VenueBooking.list("-created_date", 500),
    initialData: [],
  });

  // Existing bookings for a venue on a date that count as "taken" (pending or approved).
  const bookingsFor = (venueId, bookingDate) =>
    allBookings.filter((b) => b.venue_id === venueId && b.booking_date === bookingDate && ["pending", "approved"].includes(b.status));

  // Conflicting bookings for a cart item's time range.
  const conflictsFor = (item) =>
    bookingsFor(item.venue.id, item.booking_date).filter((b) => overlaps(item.start_time, item.end_time, b.start_time, b.end_time));

  // Available slots for a venue+date (not overlapping any taken booking).
  const availableSlots = (venueId, bookingDate) => {
    const taken = bookingsFor(venueId, bookingDate);
    return generateSlots().filter((slot) => {
      const [s, e] = slotToRange(slot);
      return !taken.some((b) => overlaps(s, e, b.start_time, b.end_time));
    });
  };

  const addToCart = (venue) => {
    if (cart.some((c) => c.venue.id === venue.id)) return;
    setCart((prev) => [...prev, {
      venue, booking_date: date || "", start_time: "", end_time: "",
      guest_count: "", purpose: "", special_requirements: "",
    }]);
  };
  const removeFromCart = (venueId) => setCart((prev) => prev.filter((c) => c.venue.id !== venueId));
  const updateCartItem = (venueId, field, value) =>
    setCart((prev) => prev.map((c) => (c.venue.id === venueId ? { ...c, [field]: value } : c)));

  const bookMutation = useMutation({
    mutationFn: async () => {
      // Final guard: block any conflicting items before creating anything.
      const conflicting = cart.filter((c) => conflictsFor(c).length > 0);
      if (conflicting.length > 0) {
        throw new Error(`${conflicting.length} booking(s) conflict with existing reservations. Please pick an available slot.`);
      }
      // Server-side collision validation for each cart item.
      for (const c of cart) {
        try {
          const { data: collision } = await base44.functions.invoke('checkVenueCollision', {
            venue_id: c.venue.id,
            booking_date: c.booking_date,
            start_time: c.start_time,
            end_time: c.end_time,
          });
          if (collision?.has_collision) {
            throw new Error(`${c.venue.name} is already booked for this time slot.`);
          }
        } catch (e) {
          if (e.message?.includes('already booked')) throw e;
          // If collision check fails (network/permission), fall through to client-side guard.
        }
      }
      const payload = cart.map((c) => ({
        venue_id: c.venue.id,
        venue_name: c.venue.name,
        resident_id: user.id,
        resident_name: user.display_name || user.full_name,
        unit_number: user.unit_number,
        booking_date: c.booking_date,
        start_time: c.start_time,
        end_time: c.end_time,
        guest_count: Number(c.guest_count) || 1,
        purpose: c.purpose,
        special_requirements: c.special_requirements,
        booking_fee: c.venue.booking_fee,
        deposit: c.venue.deposit_required,
        status: "pending",
        payment_status: "unpaid",
        collision_checked: true,
      }));
      return await base44.entities.VenueBooking.bulkCreate(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_bookings_list"]);
      qc.invalidateQueries(["all_venue_bookings"]);
      setCart([]);
      setDate("");
      alert("Booking request(s) submitted! Awaiting approval.");
    },
    onError: (e) => alert(e.message || "Booking failed."),
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.VenueBooking.update(id, { status: "cancelled" }),
    onSuccess: () => { qc.invalidateQueries(["my_bookings_list"]); qc.invalidateQueries(["all_venue_bookings"]); },
  });

  const statusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", rejected: "bg-rose-600", cancelled: "bg-slate-600", completed: "bg-sky-600" };
  const categoryIcons = { clubhouse: "🏛️", pool: "🏊", gym: "💪", tennis_court: "🎾", braai_area: "🔥", conference_room: "📋", sports_field: "⚽", other: "🏢" };

  const cartValid = cart.length > 0 && cart.every((c) => c.booking_date && c.start_time && c.end_time && c.purpose && conflictsFor(c).length === 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="pt-2 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-purple-400" /> Book a Venue
          </h1>
          {cart.length > 0 && (
            <Badge className="bg-purple-600"><ShoppingCart className="w-3 h-3 mr-1" /> {cart.length} in cart</Badge>
          )}
        </div>

        {/* Date picker — shared across the cart */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-3">
            <label className="text-slate-400 text-xs mb-1 block">Booking Date</label>
            <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setCart((prev) => prev.map((c) => ({ ...c, booking_date: e.target.value }))); }} min={new Date().toISOString().split("T")[0]} className="bg-slate-900 border-slate-700 text-white" />
          </CardContent>
        </Card>

        {/* Venue selection — multi-select into cart */}
        <div>
          <h2 className="text-white font-semibold mb-3">Available Facilities (tap to add)</h2>
          <div className="grid grid-cols-2 gap-3">
            {venues.map((v) => {
              const inCart = cart.some((c) => c.venue.id === v.id);
              return (
                <Card
                  key={v.id}
                  className={`cursor-pointer transition-all ${inCart ? "border-purple-500 bg-purple-500/10" : "bg-slate-800/50 border-slate-700 hover:border-slate-600"}`}
                  onClick={() => (inCart ? removeFromCart(v.id) : addToCart(v))}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="text-2xl mb-1">{categoryIcons[v.category] || "🏢"}</div>
                      {inCart && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
                    </div>
                    <p className="text-white font-medium text-sm">{v.name}</p>
                    <p className="text-slate-400 text-xs capitalize">{v.category?.replace("_", " ")}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                      <Users className="w-3 h-3" /> {v.capacity} max
                    </div>
                    {v.booking_fee > 0 ? <p className="text-sky-400 text-xs mt-1">R{v.booking_fee} fee</p> : <p className="text-emerald-400 text-xs mt-1">Free</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Cart — per-venue booking details + availability */}
        {cart.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-white font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-purple-400" /> Booking Cart ({cart.length})</h2>
            {cart.map((c) => {
              const conflicts = c.booking_date ? conflictsFor(c) : [];
              const slots = c.booking_date ? availableSlots(c.venue.id, c.booking_date) : [];
              return (
                <Card key={c.venue.id} className="bg-slate-800 border-purple-500/50">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-base">{c.venue.name}</CardTitle>
                      <Button variant="ghost" size="icon" onClick={() => removeFromCart(c.venue.id)}><X className="w-4 h-4" /></Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-slate-400 text-xs mb-1 block">Start Time *</label>
                        <Input type="time" value={c.start_time} onChange={(e) => updateCartItem(c.venue.id, "start_time", e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                      </div>
                      <div>
                        <label className="text-slate-400 text-xs mb-1 block">End Time *</label>
                        <Input type="time" value={c.end_time} onChange={(e) => updateCartItem(c.venue.id, "end_time", e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                      </div>
                    </div>
                    <Input type="number" placeholder={`Guests (max ${c.venue.capacity})`} value={c.guest_count} onChange={(e) => updateCartItem(c.venue.id, "guest_count", e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                    <Input placeholder="Purpose / event *" value={c.purpose} onChange={(e) => updateCartItem(c.venue.id, "purpose", e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                    <Textarea placeholder="Special requirements..." value={c.special_requirements} onChange={(e) => updateCartItem(c.venue.id, "special_requirements", e.target.value)} className="bg-slate-900 border-slate-700 text-white" rows={2} />

                    {/* Conflict / availability feedback */}
                    {c.booking_date && c.start_time && c.end_time && conflicts.length > 0 && (
                      <div className="flex items-start gap-2 p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">Already booked for this time slot</p>
                          <p>Existing: {conflicts.map((b) => `${b.start_time}–${b.end_time}`).join(", ")}</p>
                          <p className="mt-1">Available slots on {c.booking_date}:</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {slots.length > 0 ? slots.map((s) => (
                              <button key={s} type="button" onClick={() => { const [st, et] = slotToRange(s); updateCartItem(c.venue.id, "start_time", st); updateCartItem(c.venue.id, "end_time", et); }} className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30">{s}</button>
                            )) : <span className="text-rose-300">Fully booked — try another date.</span>}
                          </div>
                        </div>
                      </div>
                    )}
                    {c.booking_date && c.start_time && c.end_time && conflicts.length === 0 && (
                      <div className="flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-300">
                        <CheckCircle2 className="w-4 h-4" /> Time slot is available
                      </div>
                    )}
                    {c.booking_date && !c.start_time && (
                      <div className="text-xs text-slate-400">
                        <p className="mb-1">Available slots on {c.booking_date}:</p>
                        <div className="flex flex-wrap gap-1">
                          {slots.length > 0 ? slots.map((s) => (
                            <button key={s} type="button" onClick={() => { const [st, et] = slotToRange(s); updateCartItem(c.venue.id, "start_time", st); updateCartItem(c.venue.id, "end_time", et); }} className="px-2 py-1 rounded bg-slate-700 text-slate-200 hover:bg-slate-600">{s}</button>
                          )) : <span className="text-rose-300">Fully booked — try another date.</span>}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <Button className="w-full bg-purple-600 hover:bg-purple-700 h-12" onClick={() => bookMutation.mutate()} disabled={!cartValid || bookMutation.isPending}>
              {bookMutation.isPending ? "Submitting..." : `Request ${cart.length} Booking(s)`}
            </Button>
            {!cartValid && cart.length > 0 && <p className="text-xs text-amber-300 text-center">Complete all fields and resolve any conflicts for every venue.</p>}
          </div>
        )}

        {/* My Bookings */}
        {myBookings.length > 0 && (
          <div>
            <h2 className="text-white font-semibold mb-3">My Bookings</h2>
            <div className="space-y-2">
              {myBookings.map((b) => (
                <Card key={b.id} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">{b.venue_name}</p>
                      <p className="text-slate-400 text-sm">{b.booking_date} • {b.start_time} – {b.end_time}</p>
                      <p className="text-slate-500 text-xs">{b.purpose}</p>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Badge className={statusColors[b.status]}>{b.status}</Badge>
                      {b.status === "pending" && (
                        <Button size="sm" variant="outline" className="border-rose-500 text-rose-400 h-6 text-xs" onClick={() => cancelMutation.mutate(b.id)}>Cancel</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}