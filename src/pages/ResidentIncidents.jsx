import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Plus, X, AlertTriangle } from "lucide-react";

const CATEGORIES = [
  { value: "theft", label: "Theft" },
  { value: "vandalism", label: "Vandalism" },
  { value: "trespassing", label: "Trespassing" },
  { value: "suspicious_activity", label: "Suspicious Activity" },
  { value: "safety_hazard", label: "Safety Hazard" },
  { value: "fire", label: "Fire" },
  { value: "medical", label: "Medical" },
  { value: "other", label: "Other" },
];

const statusColors = { reported: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600", resolved: "bg-emerald-600", closed: "bg-slate-600" };
const priorityColors = { low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", critical: "bg-rose-600" };

export default function ResidentIncidents() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", priority: "medium", description: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  // Incidents reported by this resident are stored with guard_id = resident id.
  const { data: myIncidents = [] } = useQuery({
    queryKey: ["my_incidents", user?.id],
    queryFn: () => base44.entities.Incident.filter({ guard_id: user?.id }),
    enabled: !!user, initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const incident = await base44.entities.Incident.create({
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        status: "reported",
        guard_id: user.id,
        guard_name: user.display_name || user.full_name,
        site_id: "resident",
        site_name: "Resident Report",
        reported_at: new Date().toISOString(),
      });
      // In-app notify admins & estate management for every resident incident.
      // (Critical incidents also trigger the monitorHighPriorityIncidents
      //  automation which sends the branded email.)
      try {
        const admins = await base44.entities.User.list();
        const recipients = admins.filter((u) => ["admin", "estate_manager", "dispatcher"].includes(u.role_type));
        await Promise.all(recipients.map((a) =>
          base44.entities.Notification.create({
            recipient_id: a.id,
            recipient_name: a.full_name,
            type: "resident_incident",
            priority: data.priority,
            title: `Resident Incident: ${data.title}`,
            message: `${user.display_name || user.full_name} reported a ${data.category} incident (${data.priority}).`,
            read: false,
            related_entity: "incident",
            related_id: incident.id,
            sent_via: ["in_app"],
          }).catch(() => {})
        ));
      } catch (e) { console.warn("incident notify failed", e?.message || e); }
      return incident;
    },
    onSuccess: () => {
      qc.invalidateQueries(["my_incidents"]);
      setShowForm(false);
      setForm({ title: "", category: "", priority: "medium", description: "" });
      alert("Incident reported. Security & management have been notified.");
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-rose-400" /> Report Incident
          </h1>
          <Button onClick={() => setShowForm(true)} className="bg-rose-500 hover:bg-rose-600">
            <Plus className="w-4 h-4 mr-2" /> New Incident
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-rose-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Report a Security Incident</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Category *" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Textarea placeholder="Describe what happened, where and when *" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={4} />
              {form.priority === "critical" && (
                <div className="flex items-center gap-2 p-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-300">
                  <AlertTriangle className="w-4 h-4" /> Critical incidents immediately alert security & management by email.
                </div>
              )}
              <Button
                className="w-full bg-rose-600 hover:bg-rose-700"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.title || !form.category || !form.description || createMutation.isPending}
              >
                {createMutation.isPending ? "Submitting..." : "Submit Report"}
              </Button>
            </CardContent>
          </Card>
        )}

        {myIncidents.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <Shield className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No incidents reported</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myIncidents.map((i) => (
              <Card key={i.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-white font-semibold">{i.title}</p>
                      <p className="text-slate-400 text-xs mt-1 capitalize">{i.category?.replace("_", " ")} • {new Date(i.reported_at || i.created_date).toLocaleString("en-ZA")}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{i.description}</p>
                      {i.resolution_notes && <p className="text-emerald-400 text-sm mt-2">✓ {i.resolution_notes}</p>}
                    </div>
                    <div className="flex flex-col gap-1 items-end ml-3">
                      <Badge className={statusColors[i.status]}>{i.status}</Badge>
                      <Badge className={priorityColors[i.priority]}>{i.priority}</Badge>
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