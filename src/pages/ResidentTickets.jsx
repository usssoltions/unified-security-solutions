import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ticket, X, Plus, Camera, Star } from "lucide-react";

export default function ResidentTickets() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", priority: "medium", description: "" });
  const [rating, setRating] = useState({ ticketId: null, stars: 0, feedback: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: tickets = [] } = useQuery({
    queryKey: ["my_tickets", user?.id],
    queryFn: () => base44.entities.ServiceTicket.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ServiceTicket.create({
      ...data,
      resident_id: user.id,
      resident_name: user.full_name,
      unit_number: user.unit_number,
      ticket_number: `TKT-${Date.now().toString().slice(-6)}`,
      status: "open"
    }),
    onSuccess: () => {
      qc.invalidateQueries(["my_tickets"]);
      setShowForm(false);
      setForm({ title: "", category: "", priority: "medium", description: "" });
    }
  });

  const rateMutation = useMutation({
    mutationFn: ({ id, stars, feedback }) => base44.entities.ServiceTicket.update(id, { resident_rating: stars, resident_feedback: feedback }),
    onSuccess: () => { qc.invalidateQueries(["my_tickets"]); setRating({ ticketId: null, stars: 0, feedback: "" }); }
  });

  const statusColors = {
    open: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600",
    pending_resident: "bg-orange-600", resolved: "bg-emerald-600", closed: "bg-slate-600"
  };
  const priorityColors = { low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", urgent: "bg-rose-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">My Tickets</h1>
          <Button onClick={() => setShowForm(true)} className="bg-amber-500 hover:bg-amber-600">
            <Plus className="w-4 h-4 mr-2" /> New Ticket
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Log a Ticket</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Category *" />
                </SelectTrigger>
                <SelectContent>
                  {["plumbing", "electrical", "structural", "landscaping", "security", "noise", "parking", "general", "other"].map(c => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
              <Textarea placeholder="Describe the issue in detail *" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={4} />
              <Button
                className="w-full bg-amber-500 hover:bg-amber-600"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.title || !form.category || !form.description || createMutation.isPending}
              >
                {createMutation.isPending ? "Submitting..." : "Submit Ticket"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Rating Modal */}
        {rating.ticketId && (
          <Card className="bg-slate-800 border-emerald-500">
            <CardHeader className="pb-3">
              <CardTitle className="text-white">Rate the Service</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 justify-center">
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => setRating(r => ({ ...r, stars: s }))}>
                    <Star className={`w-8 h-8 ${s <= rating.stars ? "text-amber-400 fill-amber-400" : "text-slate-600"}`} />
                  </button>
                ))}
              </div>
              <Textarea placeholder="Feedback (optional)" value={rating.feedback} onChange={e => setRating(r => ({ ...r, feedback: e.target.value }))} className="bg-slate-900 border-slate-700 text-white" rows={2} />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setRating({ ticketId: null, stars: 0, feedback: "" })}>Cancel</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={!rating.stars} onClick={() => rateMutation.mutate({ id: rating.ticketId, stars: rating.stars, feedback: rating.feedback })}>Submit Rating</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {tickets.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <Ticket className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No tickets yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => (
              <Card key={t.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-white font-semibold">{t.title}</p>
                      <p className="text-slate-400 text-xs mt-1">{t.ticket_number} • {new Date(t.created_date).toLocaleDateString()}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{t.description}</p>
                      {t.resolution_notes && (
                        <p className="text-emerald-400 text-sm mt-2">✓ {t.resolution_notes}</p>
                      )}
                      {t.assigned_to_name && (
                        <p className="text-slate-500 text-xs mt-1">Assigned to: {t.assigned_to_name}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end ml-3">
                      <Badge className={statusColors[t.status]}>{t.status?.replace("_", " ")}</Badge>
                      <Badge className={priorityColors[t.priority]}>{t.priority}</Badge>
                    </div>
                  </div>
                  {["resolved", "closed"].includes(t.status) && !t.resident_rating && (
                    <Button size="sm" variant="outline" className="mt-3 border-amber-500 text-amber-400 w-full" onClick={() => setRating({ ticketId: t.id, stars: 0, feedback: "" })}>
                      <Star className="w-3 h-3 mr-1" /> Rate this service
                    </Button>
                  )}
                  {t.resident_rating && (
                    <div className="mt-2 flex gap-1">
                      {[1,2,3,4,5].map(s => <Star key={s} className={`w-4 h-4 ${s <= t.resident_rating ? "text-amber-400 fill-amber-400" : "text-slate-600"}`} />)}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}