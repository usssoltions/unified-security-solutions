import React, { useEffect, useState } from "react";
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
  Users, Building, CreditCard, Ticket, Calendar, Megaphone,
  Plus, X, ShoppingBag, Car, Settings, Shield, Loader2, AlertCircle
} from "lucide-react";
import { getUserDisplayName } from "@/lib/userDisplayName";
import { useTenantContext } from "@/hooks/useTenantContext";
import { useModuleEntitlements, isModuleEnabled } from "@/hooks/useModuleEntitlements";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

export default function EstateManagerDashboard() {
  const [user, setUser] = useState(null);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({ title: "", body: "", category: "news", priority: "normal", target_audience: "all" });
  const qc = useQueryClient();
  const { withTenant } = useTenantContext();

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const { data: entitlements = [] } = useModuleEntitlements(user?.id, user?.customer_id);
  const platformAdmin = isPlatformAdminUser(user);
  const hasAccess = platformAdmin || isModuleEnabled(entitlements, "ACCESS", false);
  const hasOperations = platformAdmin || isModuleEnabled(entitlements, "OPERATIONS", false);

  const tenantFilter = user?.customer_id ? { customer_id: user.customer_id } : {};

  const residentsQ = useQuery({
    queryKey: ["estate_residents", user?.customer_id],
    queryFn: () => base44.entities.Resident.filter(tenantFilter),
    enabled: !!user,
  });
  const ticketsQ = useQuery({
    queryKey: ["estate_tickets", user?.customer_id],
    queryFn: () => base44.entities.ServiceTicket.filter(tenantFilter, "-created_date", 50),
    enabled: !!user,
  });
  const bookingsQ = useQuery({
    queryKey: ["estate_bookings", user?.customer_id],
    queryFn: () => base44.entities.VenueBooking.filter(tenantFilter, "-created_date", 50),
    enabled: !!user,
  });
  const ordersQ = useQuery({
    queryKey: ["estate_orders", user?.customer_id],
    queryFn: () => base44.entities.Order.filter(tenantFilter, "-created_date", 50),
    enabled: !!user,
  });
  const levyQ = useQuery({
    queryKey: ["estate_levy", user?.customer_id],
    queryFn: () => base44.entities.LevyAccount.filter(tenantFilter),
    enabled: !!user,
  });
  const announcementsQ = useQuery({
    queryKey: ["estate_announcements", user?.customer_id],
    queryFn: () => base44.entities.Announcement.filter(tenantFilter, "-created_date", 20),
    enabled: !!user,
  });
  const accessQ = useQuery({
    queryKey: ["estate_access_today", user?.customer_id],
    queryFn: () => base44.entities.AccessLog.filter(tenantFilter, "-timestamp", 30),
    enabled: !!user && hasAccess,
  });

  const residents = residentsQ.data || [];
  const tickets = ticketsQ.data || [];
  const bookings = bookingsQ.data || [];
  const orders = ordersQ.data || [];
  const levyAccounts = levyQ.data || [];
  const announcements = announcementsQ.data || [];
  const accessLogs = accessQ.data || [];

  const openTickets = tickets.filter(t => !["resolved", "closed"].includes(t.status));
  const pendingBookings = bookings.filter(b => b.status === "pending");
  const overdueAccounts = levyAccounts.filter(a => a.status === "overdue");
  const pendingOrders = orders.filter(o => o.status === "pending");

  const announceMutation = useMutation({
    mutationFn: (data) => base44.entities.Announcement.create(withTenant({
      ...data,
      published: true,
      published_at: new Date().toISOString(),
      created_by: user?.id,
      created_by_name: getUserDisplayName(user),
    })),
    onSuccess: () => { qc.invalidateQueries(["estate_announcements"]); setShowAnnouncement(false); setAnnouncementForm({ title: "", body: "", category: "news", priority: "normal", target_audience: "all" }); }
  });

  const updateBookingMutation = useMutation({
    mutationFn: ({ id, status, reason }) => base44.entities.VenueBooking.update(id, { status, rejection_reason: reason, approved_by: getUserDisplayName(user) }),
    onSuccess: () => qc.invalidateQueries(["estate_bookings"])
  });

  const updateTicketMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ServiceTicket.update(id, data),
    onSuccess: () => qc.invalidateQueries(["estate_tickets"])
  });

  const stats = [
    { label: "Residents", value: residents.length, color: "text-sky-400", icon: Users, loading: residentsQ.isLoading },
    { label: "Open Tickets", value: openTickets.length, color: "text-amber-400", icon: Ticket, loading: ticketsQ.isLoading },
    { label: "Pending Bookings", value: pendingBookings.length, color: "text-purple-400", icon: Calendar, loading: bookingsQ.isLoading },
    { label: "Overdue Levies", value: overdueAccounts.length, color: "text-rose-400", icon: CreditCard, loading: levyQ.isLoading },
  ];

  // Entitlement-aware quick links — Access/Security only show when licensed
  const quickLinks = [
    { label: "Residents", to: "/EstateResidents", icon: Users, color: "bg-sky-600", show: true },
    { label: "Venues", to: "/EstateVenues", icon: Building, color: "bg-purple-600", show: true },
    { label: "Vendors", to: "/EstateVendors", icon: ShoppingBag, color: "bg-orange-600", show: true },
    { label: "Levies", to: "/EstateLevy", icon: CreditCard, color: "bg-emerald-600", show: true },
    { label: "Access", to: "/AccessControl", icon: Car, color: "bg-amber-600", show: hasAccess },
    { label: "Security", to: "/ControlRoom", icon: Shield, color: "bg-rose-600", show: hasOperations },
  ].filter(l => l.show);

  const statusColors = {
    open: "bg-amber-600", pending: "bg-amber-600", assigned: "bg-sky-600", in_progress: "bg-purple-600",
    resolved: "bg-emerald-600", closed: "bg-slate-600", approved: "bg-emerald-600", rejected: "bg-rose-600",
    low: "bg-slate-600", medium: "bg-amber-600", high: "bg-orange-600", urgent: "bg-rose-600"
  };

  const anyLoading = !user || residentsQ.isLoading || ticketsQ.isLoading;
  const anyError = residentsQ.isError || ticketsQ.isError || bookingsQ.isError;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-5xl mx-auto space-y-6 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">Estate Manager</h1>
            <p className="text-slate-400 text-sm">{user ? getUserDisplayName(user) : <Loader2 className="w-3 h-3 inline animate-spin" />}</p>
          </div>
          <Button onClick={() => setShowAnnouncement(true)} className="bg-sky-500 hover:bg-sky-600">
            <Megaphone className="w-4 h-4 mr-2" /> Announce
          </Button>
        </div>

        {anyError && (
          <Card className="bg-rose-950/40 border-rose-800">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-rose-300 font-medium text-sm">Some dashboard data failed to load</p>
                <p className="text-slate-400 text-xs mt-1">Your tenant data is still protected. Try refreshing; if this persists, contact support.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map(s => (
            <Card key={s.label} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <s.icon className={`w-5 h-5 ${s.color} mb-2`} />
                {s.loading ? (
                  <Loader2 className="w-5 h-5 text-slate-600 animate-spin" />
                ) : (
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                )}
                <p className="text-slate-400 text-xs mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Links (entitlement-aware) */}
        {quickLinks.length > 0 && (
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {quickLinks.map(l => (
              <Link key={l.label} to={l.to}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-12 h-12 rounded-xl ${l.color} flex items-center justify-center shadow`}>
                    <l.icon className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs text-slate-400">{l.label}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

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
            {ticketsQ.isLoading && <LoadingRow />}
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
                      <Button size="sm" className="bg-sky-600 hover:bg-sky-700 flex-1" onClick={() => updateTicketMutation.mutate({ id: t.id, data: { status: "in_progress", assigned_to_name: getUserDisplayName(user) } })}>
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
            {!ticketsQ.isLoading && openTickets.length === 0 && <EmptyRow text="No open tickets" />}
          </TabsContent>

          <TabsContent value="bookings" className="space-y-3 mt-4">
            {bookingsQ.isLoading && <LoadingRow />}
            {bookings.filter(b => ["pending", "approved"].includes(b.status)).map(b => (
              <Card key={b.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">{b.venue_name}</p>
                      <p className="text-slate-400 text-xs">{b.resident_name} · Unit {b.unit_number}</p>
                      <p className="text-slate-400 text-sm">{b.start_datetime ? new Date(b.start_datetime).toLocaleString() : `${b.booking_date || ""} · ${b.start_time || ""}–${b.end_time || ""}`}</p>
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
            {!bookingsQ.isLoading && pendingBookings.length === 0 && bookings.filter(b => b.status === "approved").length === 0 && <EmptyRow text="No bookings" />}
          </TabsContent>

          <TabsContent value="access" className="space-y-2 mt-4">
            {!hasAccess && <EmptyRow text="Access module not licensed for this tenant" />}
            {hasAccess && accessQ.isLoading && <LoadingRow />}
            {hasAccess && accessLogs.map(log => (
              <Card key={log.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm font-medium">{log.person_name || "Unknown"}</p>
                    <p className="text-slate-400 text-xs capitalize">{log.person_type} · {log.scan_method?.replace("_", " ")} · {log.gate_name}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold uppercase ${log.event_type === "entry" ? "text-emerald-400" : log.event_type === "exit" ? "text-amber-400" : "text-rose-400"}`}>{log.event_type}</p>
                    <p className="text-slate-500 text-xs">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ""}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            {hasAccess && !accessQ.isLoading && accessLogs.length === 0 && <EmptyRow text="No recent access activity" />}
          </TabsContent>

          <TabsContent value="announcements" className="space-y-3 mt-4">
            {announcementsQ.isLoading && <LoadingRow />}
            {announcements.map(a => (
              <Card key={a.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-white font-semibold">{a.title}</p>
                      <p className="text-slate-400 text-sm mt-1 line-clamp-3">{a.body}</p>
                      <p className="text-slate-500 text-xs mt-2">{a.created_date ? new Date(a.created_date).toLocaleDateString() : ""} · {a.target_audience}</p>
                    </div>
                    <div className="flex flex-col gap-1 ml-3">
                      <Badge className={a.priority === "urgent" ? "bg-rose-600" : a.priority === "high" ? "bg-orange-600" : "bg-slate-600"}>{a.category}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!announcementsQ.isLoading && announcements.length === 0 && <EmptyRow text="No announcements yet" />}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-8 text-slate-500">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
    </div>
  );
}

function EmptyRow({ text }) {
  return <p className="text-slate-400 text-center py-8">{text}</p>;
}