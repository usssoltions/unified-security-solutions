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
import { Building2, Plus, X, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function VenueManagement() {
  const [user, setUser] = useState(null);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [venueForm, setVenueForm] = useState({ name: "", category: "", capacity: "", booking_fee: 0, deposit_required: 0, available_hours_start: "06:00", available_hours_end: "22:00", rules: "", description: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: venues = [] } = useQuery({ queryKey: ["venues"], queryFn: () => base44.entities.Venue.list(), initialData: [] });
  const { data: bookings = [] } = useQuery({ queryKey: ["all_bookings_mgmt"], queryFn: () => base44.entities.VenueBooking.list("-created_date", 100), initialData: [], refetchInterval: 30000 });

  const createVenueMutation = useMutation({
    mutationFn: (data) => base44.entities.Venue.create({ ...data, capacity: parseInt(data.capacity), booking_fee: parseFloat(data.booking_fee) || 0 }),
    onSuccess: () => { qc.invalidateQueries(["venues"]); setShowVenueForm(false); }
  });

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, status, notes }) => base44.entities.VenueBooking.update(id, { status, ...(notes ? { notes } : {}), approved_by: user?.id }),
    onSuccess: () => qc.invalidateQueries(["all_bookings_mgmt"])
  });

  const pendingBookings = bookings.filter(b => b.status === "pending");
  const approvedBookings = bookings.filter(b => b.status === "approved");

  const statusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", rejected: "bg-rose-600", cancelled: "bg-slate-600", completed: "bg-sky-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-indigo-400" /> Venue Management
          </h1>
          <Button onClick={() => setShowVenueForm(true)} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-2" /> Add Venue
          </Button>
        </div>

        {showVenueForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Venue</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowVenueForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Venue name *" value={venueForm.name} onChange={e => setVenueForm({ ...venueForm, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Select value={venueForm.category} onValueChange={v => setVenueForm({ ...venueForm, category: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Category *" /></SelectTrigger>
                <SelectContent>
                  {["clubhouse", "pool", "gym", "tennis_court", "braai_area", "conference_room", "sports_field", "other"].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-3 gap-3">
                <Input type="number" placeholder="Capacity" value={venueForm.capacity} onChange={e => setVenueForm({ ...venueForm, capacity: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input type="number" placeholder="Fee (R)" value={venueForm.booking_fee} onChange={e => setVenueForm({ ...venueForm, booking_fee: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input type="number" placeholder="Deposit (R)" value={venueForm.deposit_required} onChange={e => setVenueForm({ ...venueForm, deposit_required: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <Textarea placeholder="Rules / terms" value={venueForm.rules} onChange={e => setVenueForm({ ...venueForm, rules: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={2} />
              <Button className="w-full bg-indigo-600" onClick={() => createVenueMutation.mutate(venueForm)} disabled={!venueForm.name || !venueForm.category || createVenueMutation.isPending}>
                {createVenueMutation.isPending ? "Saving..." : "Save Venue"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="pending">
          <TabsList className="grid grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="pending">Pending ({pendingBookings.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved ({approvedBookings.length})</TabsTrigger>
            <TabsTrigger value="venues">Venues ({venues.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-3 mt-4">
            {pendingBookings.length === 0 ? <p className="text-slate-400 text-center py-8">No pending bookings</p> : pendingBookings.map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-amber-500/30">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-white font-medium">{b.venue_name}</p>
                      <p className="text-slate-300 text-sm">{b.resident_name} • Unit {b.unit_number}</p>
                      <p className="text-slate-400 text-sm">{b.booking_date} • {b.start_time}–{b.end_time} • {b.guest_count} guests</p>
                      <p className="text-slate-500 text-xs">{b.purpose}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => updateBookingMutation.mutate({ id: b.id, status: "approved" })}>
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                    </Button>
                    <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => updateBookingMutation.mutate({ id: b.id, status: "rejected" })}>
                      <XCircle className="w-3 h-3 mr-1" /> Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="approved" className="space-y-3 mt-4">
            {approvedBookings.map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{b.venue_name}</p>
                    <p className="text-slate-400 text-sm">{b.resident_name} • {b.booking_date}</p>
                    <p className="text-slate-500 text-xs">{b.start_time}–{b.end_time} • {b.guest_count} guests</p>
                  </div>
                  <Badge className={statusColors[b.status]}>{b.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="venues" className="space-y-3 mt-4">
            {venues.map(v => (
              <Card key={v.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{v.name}</p>
                    <p className="text-slate-400 text-sm capitalize">{v.category?.replace("_", " ")} • {v.capacity} capacity</p>
                    <p className="text-slate-500 text-xs">{v.booking_fee > 0 ? `R${v.booking_fee} fee` : "Free"}</p>
                  </div>
                  <Badge className={v.status === "active" ? "bg-emerald-600" : "bg-slate-600"}>{v.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}