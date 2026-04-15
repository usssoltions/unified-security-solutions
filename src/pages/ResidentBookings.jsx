import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Users, X, CheckCircle2, Building2, Plus } from "lucide-react";

export default function ResidentBookings() {
  const [user, setUser] = useState(null);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [form, setForm] = useState({ booking_date: "", start_time: "", end_time: "", guest_count: "", purpose: "", special_requirements: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: venues = [] } = useQuery({
    queryKey: ["venues_active"],
    queryFn: () => base44.entities.Venue.filter({ status: "active" }),
    initialData: []
  });

  const { data: myBookings = [] } = useQuery({
    queryKey: ["my_bookings_list", user?.id],
    queryFn: () => base44.entities.VenueBooking.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const bookMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.VenueBooking.create({
        ...data,
        venue_id: selectedVenue.id,
        venue_name: selectedVenue.name,
        resident_id: user.id,
        resident_name: user.full_name,
        unit_number: user.unit_number,
        booking_fee: selectedVenue.booking_fee,
        deposit: selectedVenue.deposit_required
      });
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_bookings_list"]);
      setSelectedVenue(null);
      setForm({ booking_date: "", start_time: "", end_time: "", guest_count: "", purpose: "", special_requirements: "" });
      alert("Booking request submitted! Awaiting approval.");
    }
  });

  const cancelMutation = useMutation({
    mutationFn: (id) => base44.entities.VenueBooking.update(id, { status: "cancelled" }),
    onSuccess: () => qc.invalidateQueries(["my_bookings_list"])
  });

  const statusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", rejected: "bg-rose-600", cancelled: "bg-slate-600", completed: "bg-sky-600" };
  const categoryIcons = { clubhouse: "🏛️", pool: "🏊", gym: "💪", tennis_court: "🎾", braai_area: "🔥", conference_room: "📋", sports_field: "⚽", other: "🏢" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-6 h-6 text-purple-400" /> Book a Venue
          </h1>
        </div>

        {/* Venue Selection */}
        <div>
          <h2 className="text-white font-semibold mb-3">Available Facilities</h2>
          <div className="grid grid-cols-2 gap-3">
            {venues.map(v => (
              <Card
                key={v.id}
                className={`cursor-pointer transition-all ${selectedVenue?.id === v.id ? "border-purple-500 bg-purple-500/10" : "bg-slate-800/50 border-slate-700 hover:border-slate-600"}`}
                onClick={() => setSelectedVenue(selectedVenue?.id === v.id ? null : v)}
              >
                <CardContent className="p-3">
                  <div className="text-2xl mb-1">{categoryIcons[v.category] || "🏢"}</div>
                  <p className="text-white font-medium text-sm">{v.name}</p>
                  <p className="text-slate-400 text-xs capitalize">{v.category?.replace("_", " ")}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                    <Users className="w-3 h-3" /> {v.capacity} max
                  </div>
                  {v.booking_fee > 0 && <p className="text-sky-400 text-xs mt-1">R{v.booking_fee} fee</p>}
                  {v.booking_fee === 0 && <p className="text-emerald-400 text-xs mt-1">Free</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Booking Form */}
        {selectedVenue && (
          <Card className="bg-slate-800 border-purple-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Book: {selectedVenue.name}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setSelectedVenue(null)}><X /></Button>
              </div>
              {selectedVenue.rules && (
                <p className="text-amber-300 text-xs bg-amber-500/10 p-2 rounded">📋 {selectedVenue.rules}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-slate-400 text-xs mb-1 block">Date *</label>
                <Input type="date" value={form.booking_date} onChange={e => setForm({ ...form, booking_date: e.target.value })} min={new Date().toISOString().split("T")[0]} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Start Time *</label>
                  <Input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">End Time *</label>
                  <Input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
              </div>
              <Input type="number" placeholder={`Number of guests (max ${selectedVenue.capacity})`} value={form.guest_count} onChange={e => setForm({ ...form, guest_count: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Purpose / event *" value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Textarea placeholder="Special requirements..." value={form.special_requirements} onChange={e => setForm({ ...form, special_requirements: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={3} />

              {selectedVenue.booking_fee > 0 && (
                <div className="p-3 bg-slate-900/50 rounded-lg">
                  <div className="flex justify-between text-sm text-slate-300">
                    <span>Booking Fee:</span><span>R{selectedVenue.booking_fee}</span>
                  </div>
                  {selectedVenue.deposit_required > 0 && (
                    <div className="flex justify-between text-sm text-slate-300">
                      <span>Deposit:</span><span>R{selectedVenue.deposit_required}</span>
                    </div>
                  )}
                </div>
              )}

              <Button
                className="w-full bg-purple-600 hover:bg-purple-700"
                onClick={() => bookMutation.mutate(form)}
                disabled={!form.booking_date || !form.start_time || !form.end_time || !form.purpose || bookMutation.isPending}
              >
                {bookMutation.isPending ? "Submitting..." : "Request Booking"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* My Bookings */}
        {myBookings.length > 0 && (
          <div>
            <h2 className="text-white font-semibold mb-3">My Bookings</h2>
            <div className="space-y-2">
              {myBookings.map(b => (
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