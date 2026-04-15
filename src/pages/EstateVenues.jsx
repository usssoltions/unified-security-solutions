import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building, Plus, X, Users, Clock } from "lucide-react";

const EMPTY_FORM = { name: "", description: "", category: "clubhouse", capacity: "", booking_fee: "", deposit_required: "", available_hours_start: "07:00", available_hours_end: "22:00", rules: "", status: "active" };

export default function EstateVenues() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();

  const { data: venues = [] } = useQuery({ queryKey: ["all_venues"], queryFn: () => base44.entities.Venue.list(), initialData: [] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Venue.create({ ...data, capacity: Number(data.capacity), booking_fee: Number(data.booking_fee), deposit_required: Number(data.deposit_required) }),
    onSuccess: () => { qc.invalidateQueries(["all_venues", "venues_active"]); setShowForm(false); setForm(EMPTY_FORM); }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Venue.update(id, { status }),
    onSuccess: () => qc.invalidateQueries(["all_venues", "venues_active"])
  });

  const statusColors = { active: "bg-emerald-600", inactive: "bg-slate-600", maintenance: "bg-amber-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">Venues ({venues.length})</h1>
          <Button onClick={() => setShowForm(true)} className="bg-purple-500 hover:bg-purple-600"><Plus className="w-4 h-4 mr-2" />Add Venue</Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Venue</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
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
              <Button className="col-span-2 bg-purple-500 hover:bg-purple-600" onClick={() => createMutation.mutate(form)} disabled={!form.name || createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Venue"}
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
                </div>
              </CardContent>
            </Card>
          ))}
          {venues.length === 0 && <p className="text-slate-400 text-center py-8 col-span-2">No venues added yet</p>}
        </div>
      </div>
    </div>
  );
}