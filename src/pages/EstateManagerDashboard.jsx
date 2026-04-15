import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Home, Users, Building, CreditCard, Ticket, Calendar, Megaphone,
  AlertTriangle, TrendingUp, CheckCircle2, Clock, Bell, Shield,
  Plus, X, ShoppingBag, Car, Settings
} from "lucide-react";

export default function EstateManagerDashboard() {
  const [user, setUser] = useState(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", body: "", category: "news", priority: "normal", target_audience: "all" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: residents = [] } = useQuery({ queryKey: ["all_residents"], queryFn: () => base44.entities.Resident.list(), initialData: [] });
  const { data: tickets = [] } = useQuery({ queryKey: ["all_tickets"], queryFn: () => base44.entities.ServiceTicket.list("-created_date", 50), initialData: [] });
  const { data: bookings = [] } = useQuery({ queryKey: ["all_bookings"], queryFn: () => base44.entities.VenueBooking.list("-created_date", 50), initialData: [] });
  const { data: orders = [] } = useQuery({ queryKey: ["all_orders"], queryFn: () => base44.entities.Order.list("-created_date", 50), initialData: [] });
  const { data: levyAccounts = [] } = useQuery({ queryKey: ["all_levy"], queryFn: () => base44.entities.LevyAccount.list(), initialData: [] });
  const { data: announcements = [] } = useQuery({ queryKey: ["all_announcements"], queryFn: () => base44.entities.Announcement.list("-created_date", 20), initialData: [] });
  const { data: accessLogs = [] } = useQuery({ queryKey: ["access_logs_today"], queryFn: () => base44.entities.AccessLog.list("-timestamp", 30), initialData: [] });

  const openTickets = tickets.filter(t => !["resolved", "closed"].includes(t.status));
  const pendingBookings = bookings.filter(b => b.status === "pending");
  const overdueAccounts = levyAccounts.filter(a => a.status === "overdue");
  const pendingOrders = orders.filter(o => o.status === "pending");

  const announceMutation = useMutation({
    mutationFn: (data) => base44.entities.Announcement.create({ ...data, published: true, published_at: new Date().toISOString(), created_by: user?.id, created_by_name: user?.full_name }),
    onSuccess: () => { qc.invalidateQueries(["all_announcements"]); setShowAnnouncement(false); setAnnouncementForm({ title: "", body: "", category: "news", priority: "normal", target_audience: "all" }); }
  });

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, status, reason }) => base44.entities.VenueBooking.update(id, { status, rejection_reason: reason, approved_by: user?.full_name }),
    onSuccess: () => qc.invalidateQueries(["all_bookings"])
  });

  const updateTicketMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ServiceTicket.update(id, data),
    onSuccess: () => qc.invalidateQueries(["all_tickets"])
  });

  const stats = [
    { label: "Residents", value: residents.length, color: "text-sky-400", icon: Users },
    { label: "Open Tickets", value: openTickets.length, color: "text-amber-400", icon: Ticket },
    { label: "Pending Bookings", value: pendingBookings.length, color: "text-purple-400", icon: Calendar },
    { label: "Overdue Levies", value: overdueAccounts.length, color: "text-rose-400", icon: CreditCard },
  ];

  const statusColors = {
    open: "bg-amber-600", pending: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600",
    resolved: "bg-emerald-600", closed: "bg-slate-600", approved: "bg-emerald-600", rejected: "bg-rose-600",
    low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", urgent: "bg-rose-600"
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-5xl mx-auto space-y-6 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">Estate Manager</h1>
            <p className="text-slate-400 text-sm">{user?.full_name}</p>
          </div>
          <Button onClick={() => setShowAnnouncement(true)} className="bg-sky-500 hover:bg-sky-600">
            <Megaphone className="w-4 h-4 mr-2" /> Announce
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <Card key={s.label} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <s.icon className={`w-5 h-5 ${s.color} mb-2`} />
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-slate-400 text-xs mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            { label: "Residents", to: "/EstateResidents", icon: Users, color: "bg-sky-600" },
            { label: "Venues", to: "/EstateVenues", icon: Building, color: "bg-purple-600" },
            { label: "Vendors", to: "/EstateVendors", icon: ShoppingBag, color: "bg-orange-600" },
            { label: "Levies", to: "/EstateLevy", icon: CreditCard, color: "bg-emerald-600" },
            { label: "Access", to: "/AccessControl", icon: Car, color: "bg-amber-600" },
            { label: "Security", to: "/ControlRoom", icon: Shield, color: "bg-rose-600" },
          ].map(l => (
            <Link key={l.label} to={l.to}>
              <div className="flex flex-col items-center gap-2">
                <div className={`w-12 h-12 rounded-xl ${l.color} flex items-center justify-center shadow`}><l.icon className="w-5 h-5 text-white" /></div>
                <span className="text-xs text-slate-400">{l.label}</span>
              </div>
            </Link>
          ))}
        </div>

        {/* Announcement Form */}
        {showAnnouncement && (
          <Card className="bg-slate-800 border-sky-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">New Announcement</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowAnnouncement(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Title *" value={announcementForm.title} onChange={e => setAnnouncementForm(f => ({ ...f, title: e.target.value }))} className="bg-slate-900 border-slate-700 text-white" />
              <Textarea placeholder="Message body *" value={announcementForm.body} onChange={e => setAnnouncementForm(f => ({ ...f, body: e.target.value }))} className="bg-slate-900 border-slate-700 text-white" rows={4} />
              <div className="grid grid-cols-3 gap-2">
                <Select value={announcementForm.category} onValueChange={v => setAnnouncementForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["news", "maintenance", "event", "security", "emergency", "other"].map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={announcementForm.priority} onValueChange={v => setAnnouncementForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={announcementForm.target_audience} onValueChange={v => setAnnouncementForm(f => ({ ...f, target_audience: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="residents">Residents</SelectItem>
                    <SelectItem value="guards">Guards</SelectItem>
                    <SelectItem value="vendors">Vendors</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full bg-sky-500 hover:bg-sky-600" onClick={() => announceMutation.mutate(announcementForm)} disabled={!announcementForm.title || !announcementForm.body || announceMutation.isPending}>
                {announceMutation.isPending ? "Publishing..." : "Publish Announcement"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="tickets">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50">
            <TabsTrigger value="tickets">Tickets {openTickets.length > 0 && `(${openTickets.length})`}</TabsTrigger>
            <TabsTrigger value="bookings">Bookings {pendingBookings.length > 0 && `(${pendingBookings.length})`}</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="announcements">Posts</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="space-y-3 mt-4">
            {openTickets.map(t => (
              <Card key={t.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-white font-semibold">{t.title}</p>
                      <p className="text-slate-400 text-xs">{t.resident_name} · Unit {t.unit_number} · {t.ticket_number}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{t.description}</p>
                    </div>
                    <div className="flex flex-col gap-1 ml-3">
                      <Badge className={statusColors[t.status]}>{t.status}</Badge>
                      <Badge className={statusColors[t.priority]}>{t.priority}</Badge>
                    </div>
                  </div>
                  {t.status === "open" && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="bg-sky-600 hover:bg-sky-700 flex-1" onClick={() => updateTicketMutation.mutate({ id: t.id, data: { status: "in_progress", assigned_to_name: user?.full_name } })}>
                        Assign to Me
                      </Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1" onClick={() => updateTicketMutation.mutate({ id: t.id, data: { status: "resolved", resolution_notes: "Resolved by estate manager", resolved_at: new Date().toISOString() } })}>
                        Resolve
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {openTickets.length === 0 && <p className="text-slate-400 text-center py-8">No open tickets</p>}
          </TabsContent>

          <TabsContent value="bookings" className="space-y-3 mt-4">
            {bookings.filter(b => ["pending", "approved"].includes(b.status)).map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">{b.venue_name}</p>
                      <p className="text-slate-400 text-xs">{b.resident_name} · Unit {b.unit_number}</p>
                      <p className="text-slate-400 text-sm">{b.booking_date} · {b.start_time}–{b.end_time}</p>
                      <p className="text-slate-400 text-xs">{b.purpose}</p>
                    </div>
                    <Badge className={statusColors[b.status]}>{b.status}</Badge>
                  </div>
                  {b.status === "pending" && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1" onClick={() => updateBookingMutation.mutate({ id: b.id, status: "approved" })}>Approve</Button>
                      <Button size="sm" className="bg-rose-600 hover:bg-rose-700 flex-1" onClick={() => { const reason = prompt("Reason for rejection?"); if (reason) updateBookingMutation.mutate({ id: b.id, status: "rejected", reason }); }}>Reject</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
            {pendingBookings.length === 0 && bookings.filter(b => b.status === "approved").length === 0 && <p className="text-slate-400 text-center py-8">No bookings</p>}
          </TabsContent>

          <TabsContent value="access" className="space-y-2 mt-4">
            {accessLogs.map(log => (
              <Card key={log.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{log.person_name || "Unknown"}</p>
                    <p className="text-slate-400 text-xs capitalize">{log.person_type} · {log.scan_method?.replace("_", " ")} · {log.gate_name}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold uppercase ${log.event_type === "entry" ? "text-emerald-400" : log.event_type === "exit" ? "text-amber-400" : "text-rose-400"}`}>{log.event_type}</p>
                    <p className="text-slate-500 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="announcements" className="space-y-3 mt-4">
            {announcements.map(a => (
              <Card key={a.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">{a.title}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-3">{a.body}</p>
                      <p className="text-slate-500 text-xs mt-2">{new Date(a.created_date).toLocaleDateString()} · {a.target_audience}</p>
                    </div>
                    <div className="flex flex-col gap-1 ml-3">
                      <Badge className={a.priority === "urgent" ? "bg-rose-600" : a.priority === "high" ? "bg-orange-600" : "bg-slate-600"}>{a.category}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {announcements.length === 0 && <p className="text-slate-400 text-center py-8">No announcements yet</p>}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}