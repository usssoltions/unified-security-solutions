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
import { Building, Plus, X, Users, Clock, AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { getUserDisplayName } from "@/lib/userDisplayName";

const EMPTY_FORM = { name: "", description: "", category: "clubhouse", capacity: "", booking_fee: "", deposit_required: "", available_hours_start: "07:00", available_hours_end: "22:00", rules: "", status: "active" };

export default function EstateVenues() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [user, setUser] = useState(null);
  const qc = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
  }, []);

  const { data: venues = [] } = useQuery({ queryKey: ["all_venues"], queryFn: () => base44.entities.Venue.list(), initialData: [] });

  const { data: bookings = [] } = useQuery({
    queryKey: ["venue_bookings_mgmt"],
    queryFn: () => base44.entities.VenueBooking.list("-created_date", 200),
    initialData: [],
  });

  const [editingVenue, setEditingVenue] = useState(null);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Venue.create({
      ...data,
      customer_id: user?.customer_id,
      reseller_id: user?.reseller_id,
      site_id: user?.site_id,
      capacity: Number(data.capacity) || 0,
      booking_fee: Number(data.booking_fee) || 0,
      deposit_required: Number(data.deposit_required) || 0,
    }),
    onSuccess: () => { qc.invalidateQueries(["all_venues"]); setShowForm(false); setForm(EMPTY_FORM); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Venue.update(id, {
      ...data,
      capacity: Number(data.capacity) || 0,
      booking_fee: Number(data.booking_fee) || 0,
      deposit_required: Number(data.deposit_required) || 0,
    }),
    onSuccess: () => { qc.invalidateQueries(["all_venues"]); setShowForm(false); setForm(EMPTY_FORM); setEditingVenue(null); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Venue.delete(id),
    onSuccess: () => qc.invalidateQueries(["all_venues"])
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Venue.update(id, { status }),
    onSuccess: () => qc.invalidateQueries(["all_venues"])
  });

  const openEdit = (v) => {
    setEditingVenue(v);
    setForm({
      name: v.name || "", description: v.description || "", category: v.category || "clubhouse",
      capacity: v.capacity ?? "", booking_fee: v.booking_fee ?? "", deposit_required: v.deposit_required ?? "",
      available_hours_start: v.available_hours_start || "07:00", available_hours_end: v.available_hours_end || "22:00",
      rules: v.rules || "", status: v.status || "active",
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setForm(EMPTY_FORM); setEditingVenue(null); };

  const submitForm = () => {
    if (editingVenue) updateMutation.mutate({ id: editingVenue.id, data: form });
    else createMutation.mutate(form);
  };

  const handleDelete = (v) => {
    if (window.confirm(`Delete venue "${v.name}"? This cannot be undone.`)) deleteMutation.mutate(v.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, status, notes }) => base44.entities.VenueBooking.update(id, {
      status,
      ...(notes ? { notes } : {}),
      approved_by: user?.id,
      approved_by_name: getUserDisplayName(user),
      approved_at: status === "approved" ? new Date().toISOString() : undefined,
    }),
    onSuccess: () => qc.invalidateQueries(["venue_bookings_mgmt"])
  });

  const statusColors = { active: "bg-emerald-600", inactive: "bg-slate-600", maintenance: "bg-amber-600" };
  const bookingStatusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", rejected: "bg-rose-600", cancelled: "bg-slate-600", completed: "bg-sky-600", info_requested: "bg-purple-600" };
  const hasTenant = !!user?.customer_id;

  const pendingBookings = bookings.filter(b => b.status === "pending");
  const approvedBookings = bookings.filter(b => b.status === "approved");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Building className="w-6 h-6 text-purple-400" /> Venues
          </h1>
          <Button onClick={() => { setEditingVenue(null); setForm(EMPTY_FORM); setShowForm(true); }} className="bg-purple-500 hover:bg-purple-600" disabled={!hasTenant}>
            <Plus className="w-4 h-4 mr-2" /> Add Venue
          </Button>
        </div>

        {!hasTenant && (
          <Card className="bg-amber-500/10 border-amber-500/30">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-medium text-sm">Tenant Not Assigned</p>
                <p className="text-slate-400 text-xs mt-1">Your account has not been assigned to an organisation. Please contact an administrator to complete tenant setup before creating venues.</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="venues">
          <TabsList className="grid grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="venues">Venues ({venues.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({pendingBookings.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved ({approvedBookings.length})</TabsTrigger>
          </TabsList>

          {/* Venues tab — CRUD + status */}
          <TabsContent value="venues" className="space-y-4 mt-4">
            {showForm && (
              <Card className="bg-slate-800 border-slate-700">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white">{editingVenue ? "Edit Venue" : "Add Venue"}</CardTitle>
                    <Button variant="ghost" size="icon" onClick={closeForm}><X /></Button>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <Input placeholder="Venue name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" />
                  <Textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" rows={2} />
                  <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["clubhouse", "pool", "gym", "tennis_court", "braai_area", "conference_room", "sports_field", "other"].map(c => (
                        <SelectItem key={c} value={c} className="capitalize">{c.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="Max capacity" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input type="number" placeholder="Booking fee (R)" value={form.booking_fee} onChange={e => setForm({ ...form, booking_fee: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input type="number" placeholder="Deposit required (R)" value={form.deposit_required} onChange={e => setForm({ ...form, deposit_required: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input type="time" value={form.available_hours_start} onChange={e => setForm({ ...form, available_hours_start: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Input type="time" value={form.available_hours_end} onChange={e => setForm({ ...form, available_hours_end: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                  <Textarea placeholder="Rules & conditions" value={form.rules} onChange={e => setForm({ ...form, rules: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" rows={2} />
                  <Button className="col-span-2 bg-purple-500 hover:bg-purple-600" onClick={submitForm} disabled={!form.name || isSaving}>
                    {isSaving ? (editingVenue ? "Saving..." : "Adding...") : (editingVenue ? "Save Changes" : "Add Venue")}
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {venues.map(v => (
                <Card key={v.id} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-white font-semibold">{v.name}</p>
                        <p className="text-slate-400 text-xs capitalize mb-2">{v.category?.replace("_", " ")}</p>
                        <p className="text-slate-400 text-sm line-clamp-2">{v.description}</p>
                        <div className="flex gap-3 mt-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1"><Users className="w-3 h-3" />{v.capacity} pax</span>
                          <span className="text-emerald-400">R{v.booking_fee || 0} fee</span>
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{v.available_hours_start}–{v.available_hours_end}</span>
                        </div>
                      </div>
                      <Badge className={statusColors[v.status]}>{v.status}</Badge>
                    </div>
                    <div className="flex gap-2 mt-3">
                      {v.status !== "active" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1" onClick={() => updateStatusMutation.mutate({ id: v.id, status: "active" })}>Activate</Button>}
                      {v.status === "active" && <Button size="sm" variant="outline" className="border-amber-500 text-amber-400 flex-1" onClick={() => updateStatusMutation.mutate({ id: v.id, status: "maintenance" })}>Maintenance</Button>}
                      <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 flex-1" onClick={() => openEdit(v)}>Edit</Button>
                      <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-400 flex-1" onClick={() => handleDelete(v)} disabled={deleteMutation.isPending}>Delete</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {venues.length === 0 && <p className="text-slate-400 text-center py-8 col-span-2">No venues added yet</p>}
            </div>
          </TabsContent>

          {/* Pending bookings — approval workflow (consolidated from VenueManagement) */}
          <TabsContent value="pending" className="space-y-3 mt-4">
            {pendingBookings.length === 0 ? <p className="text-slate-400 text-center py-8">No pending bookings</p> : pendingBookings.map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-amber-500/30">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-white font-medium">{b.venue_name}</p>
                      <p className="text-slate-300 text-sm">{b.resident_name} • Unit {b.unit_number}</p>
                      <p className="text-slate-400 text-sm">{b.booking_date} • {b.start_time}–{b.end_time} • {b.guest_count} guests</p>
                      {b.purpose && <p className="text-slate-500 text-xs">{b.purpose}</p>}
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
            {approvedBookings.length === 0 ? <p className="text-slate-400 text-center py-8">No approved bookings</p> : approvedBookings.map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{b.venue_name}</p>
                    <p className="text-slate-400 text-sm">{b.resident_name} • {b.booking_date}</p>
                    <p className="text-slate-500 text-xs">{b.start_time}–{b.end_time} • {b.guest_count} guests</p>
                  </div>
                  <Badge className={bookingStatusColors[b.status] || "bg-slate-600"}>{b.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}