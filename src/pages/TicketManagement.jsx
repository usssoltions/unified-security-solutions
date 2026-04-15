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
import { Ticket, Search, User, MapPin, Clock, X, CheckCircle2, AlertTriangle } from "lucide-react";

export default function TicketManagement() {
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [assignTo, setAssignTo] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: tickets = [] } = useQuery({
    queryKey: ["all_tickets_mgmt"],
    queryFn: () => base44.entities.ServiceTicket.list("-created_date", 200),
    initialData: [],
    refetchInterval: 30000
  });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors_active"],
    queryFn: () => base44.entities.Vendor.filter({ status: "active" }),
    initialData: []
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ServiceTicket.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries(["all_tickets_mgmt"]);
      setSelectedTicket(null);
    }
  });

  const filtered = tickets.filter(t =>
    !search || t.title?.toLowerCase().includes(search.toLowerCase()) ||
    t.resident_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.unit_number?.includes(search)
  );

  const byStatus = (status) => filtered.filter(t => Array.isArray(status) ? status.includes(t.status) : t.status === status);

  const statusColors = { open: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600", pending_resident: "bg-orange-600", resolved: "bg-emerald-600", closed: "bg-slate-600" };
  const priorityColors = { low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", urgent: "bg-rose-600" };

  const TicketCard = ({ t }) => (
    <Card className="bg-slate-800/50 border-slate-700 cursor-pointer hover:border-slate-600" onClick={() => { setSelectedTicket(t); setNewStatus(t.status); setResolutionNotes(t.resolution_notes || ""); }}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between mb-1">
          <p className="text-white font-medium text-sm flex-1 pr-2">{t.title}</p>
          <div className="flex gap-1 flex-col items-end">
            <Badge className={priorityColors[t.priority]}>{t.priority}</Badge>
            <Badge className={statusColors[t.status]}>{t.status?.replace("_", " ")}</Badge>
          </div>
        </div>
        <div className="flex gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1"><User className="w-3 h-3" /> {t.resident_name}</span>
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Unit {t.unit_number}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(t.created_date).toLocaleDateString()}</span>
        </div>
        <p className="text-slate-500 text-xs mt-1 line-clamp-1">{t.category} — {t.description?.substring(0, 80)}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Ticket className="w-6 h-6 text-amber-400" /> Ticket Management
          </h1>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input placeholder="Search by title, resident, or unit..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-slate-800 border-slate-700 text-white" />
        </div>

        <Tabs defaultValue="open">
          <TabsList className="grid grid-cols-4 bg-slate-800/50">
            <TabsTrigger value="open">Open ({byStatus(["open", "assigned", "in_progress"]).length})</TabsTrigger>
            <TabsTrigger value="urgent">Urgent ({byStatus("open").filter(t => t.priority === "urgent").length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({byStatus("pending_resident").length})</TabsTrigger>
            <TabsTrigger value="resolved">Resolved ({byStatus(["resolved", "closed"]).length})</TabsTrigger>
          </TabsList>

          <TabsContent value="open" className="space-y-2 mt-4">
            {byStatus(["open", "assigned", "in_progress"]).map(t => <TicketCard key={t.id} t={t} />)}
            {byStatus(["open", "assigned", "in_progress"]).length === 0 && <p className="text-slate-400 text-center py-8">No open tickets</p>}
          </TabsContent>
          <TabsContent value="urgent" className="space-y-2 mt-4">
            {byStatus("open").filter(t => t.priority === "urgent").map(t => <TicketCard key={t.id} t={t} />)}
          </TabsContent>
          <TabsContent value="pending" className="space-y-2 mt-4">
            {byStatus("pending_resident").map(t => <TicketCard key={t.id} t={t} />)}
          </TabsContent>
          <TabsContent value="resolved" className="space-y-2 mt-4">
            {byStatus(["resolved", "closed"]).map(t => <TicketCard key={t.id} t={t} />)}
          </TabsContent>
        </Tabs>

        {/* Ticket Detail Modal */}
        {selectedTicket && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 max-h-[90vh] overflow-y-auto">
              <CardHeader className="border-b border-slate-700 pb-4 sticky top-0 bg-slate-800 z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-white">{selectedTicket.title}</CardTitle>
                    <p className="text-slate-400 text-sm">{selectedTicket.ticket_number} • {selectedTicket.resident_name} • Unit {selectedTicket.unit_number}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedTicket(null)}><X /></Button>
                </div>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Category</p>
                    <p className="text-white capitalize">{selectedTicket.category}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400 mb-1">Priority</p>
                    <Badge className={priorityColors[selectedTicket.priority]}>{selectedTicket.priority}</Badge>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-slate-400 mb-1">Description</p>
                  <p className="text-slate-300 text-sm">{selectedTicket.description}</p>
                </div>

                {selectedTicket.media?.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-2">Photos</p>
                    <div className="flex gap-2 flex-wrap">
                      {selectedTicket.media.map((m, i) => <img key={i} src={m.url} alt="" className="w-20 h-20 object-cover rounded" />)}
                    </div>
                  </div>
                )}

                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <p className="text-white font-semibold">Update Ticket</p>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="New status" /></SelectTrigger>
                    <SelectContent>
                      {["open", "assigned", "in_progress", "pending_resident", "resolved", "closed"].map(s => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={assignTo} onValueChange={setAssignTo}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Assign to vendor (optional)" /></SelectTrigger>
                    <SelectContent>
                      {vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.business_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="Resolution / update notes..." value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} className="bg-slate-900 border-slate-700 text-white" rows={3} />
                  <Button
                    className="w-full bg-sky-600 hover:bg-sky-700"
                    onClick={() => updateMutation.mutate({
                      id: selectedTicket.id,
                      data: {
                        status: newStatus,
                        assigned_to: assignTo || selectedTicket.assigned_to,
                        resolution_notes: resolutionNotes,
                        resolved_at: newStatus === "resolved" ? new Date().toISOString() : selectedTicket.resolved_at
                      }
                    })}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? "Updating..." : "Update Ticket"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}