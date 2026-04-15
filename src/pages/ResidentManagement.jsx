import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Plus, X, Search, Phone, Home, Car } from "lucide-react";

export default function ResidentManagement() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedResident, setSelectedResident] = useState(null);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", unit_number: "", id_number: "", move_in_date: "", emergency_contact_name: "", emergency_contact_phone: "" });
  const qc = useQueryClient();

  const { data: residents = [] } = useQuery({ queryKey: ["residents_mgmt"], queryFn: () => base44.entities.Resident.list("-created_date", 200), initialData: [] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Resident.create({ ...data, status: "active" }),
    onSuccess: () => { qc.invalidateQueries(["residents_mgmt"]); setShowForm(false); setForm({ full_name: "", email: "", phone: "", unit_number: "", id_number: "", move_in_date: "", emergency_contact_name: "", emergency_contact_phone: "" }); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Resident.update(id, data),
    onSuccess: () => { qc.invalidateQueries(["residents_mgmt"]); setSelectedResident(null); }
  });

  const filtered = residents.filter(r =>
    !search || r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.unit_number?.includes(search) || r.email?.includes(search)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-sky-400" /> Residents ({residents.length})
          </h1>
          <Button onClick={() => setShowForm(true)} className="bg-sky-500 hover:bg-sky-600">
            <Plus className="w-4 h-4 mr-2" /> Add Resident
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Resident</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder="Full name *" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="Unit number *" value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="SA ID number" value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input type="date" placeholder="Move-in date" value={form.move_in_date} onChange={e => setForm({ ...form, move_in_date: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="Emergency contact name" value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input placeholder="Emergency contact phone" value={form.emergency_contact_phone} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <Button className="w-full bg-sky-500 hover:bg-sky-600" onClick={() => createMutation.mutate(form)} disabled={!form.full_name || !form.unit_number || createMutation.isPending}>
                {createMutation.isPending ? "Saving..." : "Add Resident"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input placeholder="Search by name, unit, or email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-slate-800 border-slate-700 text-white" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(r => (
            <Card key={r.id} className="bg-slate-800/50 border-slate-700 cursor-pointer hover:border-slate-600" onClick={() => setSelectedResident(r)}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-white font-semibold">{r.full_name}</p>
                    <p className="text-slate-400 text-sm flex items-center gap-1"><Home className="w-3 h-3" /> Unit {r.unit_number}</p>
                  </div>
                  <Badge className={r.status === "active" ? "bg-emerald-600" : r.status === "suspended" ? "bg-rose-600" : "bg-amber-600"}>{r.status}</Badge>
                </div>
                <div className="space-y-1 text-xs text-slate-500">
                  {r.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.phone}</p>}
                  {r.vehicles?.length > 0 && <p className="flex items-center gap-1"><Car className="w-3 h-3" /> {r.vehicles.length} vehicle(s)</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Resident Detail / Edit Modal */}
        {selectedResident && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md bg-slate-800 border-slate-700 max-h-[90vh] overflow-y-auto">
              <CardHeader className="border-b border-slate-700 pb-3 sticky top-0 bg-slate-800">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">{selectedResident.full_name}</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedResident(null)}><X /></Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-slate-400 text-xs">Unit</p><p className="text-white">{selectedResident.unit_number}</p></div>
                  <div><p className="text-slate-400 text-xs">Status</p><Badge className={selectedResident.status === "active" ? "bg-emerald-600" : "bg-rose-600"}>{selectedResident.status}</Badge></div>
                  <div><p className="text-slate-400 text-xs">Email</p><p className="text-white text-xs">{selectedResident.email || "—"}</p></div>
                  <div><p className="text-slate-400 text-xs">Phone</p><p className="text-white">{selectedResident.phone || "—"}</p></div>
                  <div><p className="text-slate-400 text-xs">SA ID</p><p className="text-white text-xs">{selectedResident.id_number || "—"}</p></div>
                  <div><p className="text-slate-400 text-xs">Move-In</p><p className="text-white text-xs">{selectedResident.move_in_date || "—"}</p></div>
                </div>
                {selectedResident.vehicles?.length > 0 && (
                  <div>
                    <p className="text-slate-400 text-xs mb-1">Vehicles</p>
                    {selectedResident.vehicles.map((v, i) => (
                      <p key={i} className="text-white text-sm">{v.registration} — {v.make} {v.model} ({v.color})</p>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button className="flex-1 bg-amber-600 hover:bg-amber-700" size="sm" onClick={() => updateMutation.mutate({ id: selectedResident.id, data: { status: "suspended" } })}>Suspend</Button>
                  <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" size="sm" onClick={() => updateMutation.mutate({ id: selectedResident.id, data: { status: "active" } })}>Activate</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}