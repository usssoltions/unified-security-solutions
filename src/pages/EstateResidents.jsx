import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Search, Plus, X, Phone, Home, Car, UserCheck, Link2, Unlink } from "lucide-react";
import { listResidents, createResident, updateResident, unlinkResidentUser } from "@/lib/estateApi";
import ResidentLinkDialog from "@/components/estate/ResidentLinkDialog";

export default function EstateResidents() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [linking, setLinking] = useState(null);
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", unit_number: "", id_number: "", status: "active" });
  const qc = useQueryClient();

  // All resident records flow through the estateAccess gateway — tenant scope
  // is resolved and stamped server-side.
  const { data: residents = [] } = useQuery({ queryKey: ["all_residents"], queryFn: () => listResidents().then(r => r.residents), initialData: [] });

  const createMutation = useMutation({
    mutationFn: (data) => createResident({ ...data, move_in_date: new Date().toISOString().split("T")[0] }),
    onSuccess: () => { qc.invalidateQueries(["all_residents"]); setShowForm(false); setForm({ full_name: "", email: "", phone: "", unit_number: "", id_number: "", status: "active" }); }
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }) => updateResident(id, { status }),
    onSuccess: () => qc.invalidateQueries(["all_residents"])
  });

  const unlinkMutation = useMutation({
    mutationFn: (id) => unlinkResidentUser(id),
    onSuccess: () => qc.invalidateQueries(["all_residents"])
  });

  const filtered = residents.filter(r =>
    r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.unit_number?.toLowerCase().includes(search.toLowerCase()) ||
    r.email?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors = { active: "bg-emerald-600", suspended: "bg-rose-600", pending: "bg-amber-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">Residents ({residents.length})</h1>
          <Button onClick={() => setShowForm(true)} className="bg-sky-500 hover:bg-sky-600"><Plus className="w-4 h-4 mr-2" />Add</Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Search by name, unit, email..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-slate-800/50 border-slate-700 text-white" />
        </div>

        {linking && <ResidentLinkDialog resident={linking} onClose={() => setLinking(null)} />}

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Resident</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Input placeholder="Full name *" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white col-span-2" />
              <Input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Unit number *" value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="SA ID number" value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Button className="col-span-2 bg-sky-500 hover:bg-sky-600" onClick={() => createMutation.mutate(form)} disabled={!form.full_name || !form.unit_number || createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Resident"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {filtered.map(r => {
            return (
              <Card key={r.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{r.full_name}</p>
                        <Badge className={statusColors[r.status]}>{r.status}</Badge>
                      </div>
                      <div className="mt-1 space-y-0.5 text-sm text-slate-400">
                        <p className="flex items-center gap-1"><Home className="w-3 h-3" /> Unit {r.unit_number}</p>
                        {r.phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {r.phone}</p>}
                        {r.vehicles?.length > 0 && <p className="flex items-center gap-1"><Car className="w-3 h-3" /> {r.vehicles.length} vehicle(s)</p>}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 ml-3">
                     <div className="flex items-center gap-1 justify-end">
                       {r.user_id ? (
                         <Badge className="bg-indigo-600"><UserCheck className="w-3 h-3 mr-1" />Account linked</Badge>
                       ) : (
                         <Badge variant="outline" className="border-slate-600 text-slate-400">No account</Badge>
                       )}
                     </div>
                     <div className="flex gap-2 justify-end">
                       {r.user_id ? (
                         <Button size="sm" variant="outline" className="border-amber-500 text-amber-400" disabled={unlinkMutation.isPending} onClick={() => unlinkMutation.mutate(r.id)}>
                           <Unlink className="w-3 h-3 mr-1" />Unlink
                         </Button>
                       ) : (
                         <Button size="sm" variant="outline" className="border-sky-500 text-sky-400" onClick={() => setLinking(r)}>
                           <Link2 className="w-3 h-3 mr-1" />Link Account
                         </Button>
                       )}
                       {r.status === "active" ? (
                         <Button size="sm" variant="outline" className="border-rose-500 text-rose-400" onClick={() => updateStatusMutation.mutate({ id: r.id, status: "suspended" })}>Suspend</Button>
                       ) : (
                         <Button size="sm" variant="outline" className="border-emerald-500 text-emerald-400" onClick={() => updateStatusMutation.mutate({ id: r.id, status: "active" })}>Activate</Button>
                       )}
                     </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && <p className="text-slate-400 text-center py-8">No residents found</p>}
        </div>
      </div>
    </div>
  );
}