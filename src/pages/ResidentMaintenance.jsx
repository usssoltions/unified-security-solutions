import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Wrench, Plus, X, Home, Phone, MapPin } from "lucide-react";
import WhatsAppNotifier from "@/components/WhatsAppNotifier";
import { residentMaintenanceMessage } from "@/lib/whatsapp";

const CATEGORIES = [
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "lighting", label: "Lighting" },
  { value: "locks", label: "Locks / Doors" },
  { value: "fencing", label: "Fencing" },
  { value: "gate", label: "Gate" },
  { value: "alarm_system", label: "Alarm System" },
  { value: "camera", label: "Camera / CCTV" },
  { value: "structural", label: "Structural" },
  { value: "other", label: "Other" },
];

const statusColors = { reported: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600", completed: "bg-emerald-600", cancelled: "bg-slate-600" };
const urgencyColors = { low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", critical: "bg-rose-600" };

export default function ResidentMaintenance() {
  const [user, setUser] = useState(null);
  const [resident, setResident] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [waMessage, setWaMessage] = useState(null);
  const [form, setForm] = useState({
    category: "", urgency: "medium", title: "", description: "",
    address: "", contactPhone: "",
  });
  const qc = useQueryClient();

  useEffect(() => {
    base44.auth.me().then((u) => {
      setUser(u);
      base44.entities.Resident.filter({ user_id: u.id }).then((res) => {
        if (res.length > 0) {
          setResident(res[0]);
          setForm((f) => ({
            ...f,
            contactPhone: res[0].phone || u.phone_number || u.phone || "",
            address: [res[0].unit_number && `Unit ${res[0].unit_number}`, res[0].estate_name].filter(Boolean).join(", "),
          }));
        }
      });
    });
  }, []);

  // Maintenance requests reported by this resident (guard_id = resident id).
  const { data: myRequests = [] } = useQuery({
    queryKey: ["my_maintenance", user?.id],
    queryFn: () => base44.entities.MaintenanceRequest.filter({ guard_id: user?.id }),
    enabled: !!user, initialData: [],
  });

  const residentName = resident?.full_name || user?.display_name || user?.full_name || "Resident";
  const unitNumber = resident?.unit_number || user?.unit_number || "—";
  const estateName = resident?.estate_name || "";

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const request = await base44.entities.MaintenanceRequest.create({
        title: data.title || `${data.category} request`,
        description: `Reason / Details: ${data.description}\n\nAddress: ${data.address || `Unit ${unitNumber}${estateName ? ', ' + estateName : ''}`}\nContact: ${data.contactPhone || 'N/A'}`,
        category: data.category,
        urgency: data.urgency,
        status: "reported",
        guard_id: user.id,
        guard_name: residentName,
        site_id: "resident",
        site_name: `Resident — Unit ${unitNumber}`,
        reported_at: new Date().toISOString(),
      });
      // Send branded real-time email + in-app notification to all
      // admin / estate_manager / dispatcher users (server-side).
      try {
        await base44.functions.invoke("notifyAdminsResidentReport", {
          reportType: "maintenance",
          reportId: request.id,
          residentName,
          unitNumber,
          estateName,
          address: data.address,
          contactPhone: data.contactPhone,
          category: data.category,
          urgency: data.urgency,
          title: data.title,
          description: data.description,
          reason: data.description,
          reportedAt: new Date().toISOString(),
        });
      } catch (e) { console.warn("maintenance report notify failed", e?.message || e); }
      return request;
    },
    onSuccess: (_req, data) => {
      qc.invalidateQueries(["my_maintenance"]);
      setShowForm(false);
      setForm((f) => ({
        ...f, category: "", urgency: "medium", title: "", description: "",
      }));
      setWaMessage(residentMaintenanceMessage({
        residentName, unitNumber, estateName, address: data.address,
        contactPhone: data.contactPhone, category: data.category, urgency: data.urgency,
        title: data.title, description: data.description,
      }));
    },
  });

  if (waMessage) {
    return (
      <WhatsAppNotifier
        message={waMessage}
        title="Send Maintenance Alerts via WhatsApp"
        onDone={() => setWaMessage(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wrench className="w-6 h-6 text-amber-400" /> Maintenance Requests
          </h1>
          <Button onClick={() => setShowForm(true)} className="bg-amber-500 hover:bg-amber-600">
            <Plus className="w-4 h-4 mr-2" /> New Request
          </Button>
        </div>

        {/* Resident info summary */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
            <span className="flex items-center gap-1"><Home className="w-3 h-3" /> Unit {unitNumber}</span>
            {estateName && <span>• {estateName}</span>}
            {form.contactPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {form.contactPhone}</span>}
          </CardContent>
        </Card>

        {showForm && (
          <Card className="bg-slate-800 border-amber-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Submit a Maintenance Request</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Category *" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.urgency} onValueChange={(v) => setForm({ ...form, urgency: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Urgency" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Input placeholder="Title / Issue *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <div>
                <label className="text-slate-400 text-xs flex items-center gap-1 mb-1"><MapPin className="w-3 h-3" /> Full address (auto-filled — edit if needed)</label>
                <Input placeholder="e.g. Unit 12, Acacia Estate, 123 Main Rd" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <div>
                <label className="text-slate-400 text-xs flex items-center gap-1 mb-1"><Phone className="w-3 h-3" /> Contact number</label>
                <Input placeholder="Contact number" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <Textarea placeholder="Reason / describe the problem, where and when it occurs *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={4} />
              <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                <Wrench className="w-4 h-4" /> On submit, estate management & maintenance team are notified immediately by email and WhatsApp.
              </div>
              <Button
                className="w-full bg-amber-600 hover:bg-amber-700"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.category || !form.title || !form.description || createMutation.isPending}
              >
                {createMutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </CardContent>
          </Card>
        )}

        {myRequests.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <Wrench className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No maintenance requests submitted</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myRequests.map((r) => (
              <Card key={r.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-white font-semibold">{r.title}</p>
                      <p className="text-slate-400 text-xs mt-1 capitalize">{r.category?.replace("_", " ")} • {new Date(r.reported_at || r.created_date).toLocaleString("en-ZA")}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{r.description}</p>
                      {r.completion_notes && <p className="text-emerald-400 text-sm mt-2">✓ {r.completion_notes}</p>}
                    </div>
                    <div className="flex flex-col gap-1 items-end ml-3">
                      <Badge className={statusColors[r.status]}>{r.status}</Badge>
                      <Badge className={urgencyColors[r.urgency]}>{r.urgency}</Badge>
                    </div>
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