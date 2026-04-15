import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, X, Clock, CheckCircle2, XCircle, Car, Phone } from "lucide-react";

export default function ResidentVisitors() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ visitor_name: "", visitor_phone: "", vehicle_registration: "", visit_type: "pre_registered", valid_from: "", valid_until: "", notes: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: visitors = [] } = useQuery({
    queryKey: ["my_visitors", user?.id],
    queryFn: () => base44.entities.Visitor.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      return await base44.entities.Visitor.create({
        ...data,
        resident_id: user.id,
        resident_name: user.full_name,
        unit_number: user.unit_number,
        otp_code: otp,
        status: "approved"
      });
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_visitors"]);
      setShowForm(false);
      setForm({ visitor_name: "", visitor_phone: "", vehicle_registration: "", visit_type: "pre_registered", valid_from: "", valid_until: "", notes: "" });
    }
  });

  const statusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", denied: "bg-rose-600", entered: "bg-sky-600", exited: "bg-slate-600", expired: "bg-slate-500" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">My Visitors</h1>
          <Button onClick={() => setShowForm(true)} className="bg-sky-500 hover:bg-sky-600">
            <UserPlus className="w-4 h-4 mr-2" /> Add Visitor
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Register Visitor</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Visitor full name *" value={form.visitor_name} onChange={e => setForm({ ...form, visitor_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Visitor phone number" value={form.visitor_phone} onChange={e => setForm({ ...form, visitor_phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Vehicle registration (optional)" value={form.vehicle_registration} onChange={e => setForm({ ...form, vehicle_registration: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Select value={form.visit_type} onValueChange={v => setForm({ ...form, visit_type: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Visit type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pre_registered">Pre-Registered Guest</SelectItem>
                  <SelectItem value="unexpected">Unexpected Visitor</SelectItem>
                  <SelectItem value="contractor">Contractor / Worker</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Valid From</label>
                  <Input type="datetime-local" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Valid Until</label>
                  <Input type="datetime-local" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
              </div>
              <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Button
                className="w-full bg-sky-500 hover:bg-sky-600"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.visitor_name || createMutation.isPending}
              >
                {createMutation.isPending ? "Registering..." : "Register Visitor"}
              </Button>
            </CardContent>
          </Card>
        )}

        {visitors.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <UserPlus className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No visitors registered yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visitors.map(v => (
              <Card key={v.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-white font-semibold">{v.visitor_name}</p>
                        <Badge className={statusColors[v.status]}>{v.status}</Badge>
                      </div>
                      <div className="space-y-1 text-sm text-slate-400">
                        {v.visitor_phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {v.visitor_phone}</p>}
                        {v.vehicle_registration && <p className="flex items-center gap-1"><Car className="w-3 h-3" /> {v.vehicle_registration}</p>}
                        {v.valid_from && <p className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(v.valid_from).toLocaleDateString()} – {v.valid_until ? new Date(v.valid_until).toLocaleDateString() : "Open"}</p>}
                      </div>
                      {v.otp_code && (
                        <div className="mt-2 p-2 bg-slate-900/60 rounded-lg inline-block">
                          <p className="text-xs text-slate-400">OTP Code</p>
                          <p className="text-2xl font-mono font-bold text-sky-400 tracking-widest">{v.otp_code}</p>
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="border-slate-600 text-slate-400 capitalize">{v.visit_type?.replace("_", " ")}</Badge>
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