import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Home, UserPlus, Calendar, ShoppingBag, ShirtIcon, CreditCard,
  Ticket, AlertTriangle, Wrench, Bell, ChevronRight, Megaphone,
  Car, Shield, MapPin, Clock
} from "lucide-react";

export default function ResidentDashboard() {
  const [user, setUser] = useState(null);
  const [resident, setResident] = useState(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      base44.entities.Resident.filter({ user_id: u.id }).then(res => {
        if (res.length > 0) setResident(res[0]);
      });
    });
  }, []);

  const { data: tickets = [] } = useQuery({
    queryKey: ["my_tickets", user?.id],
    queryFn: () => base44.entities.ServiceTicket.filter({ resident_id: user?.id }),
    enabled: !!user,
    initialData: []
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements_active"],
    queryFn: () => base44.entities.Announcement.filter({ published: true }),
    initialData: []
  });

  const { data: levyAccount } = useQuery({
    queryKey: ["levy", user?.id],
    queryFn: async () => {
      const res = await base44.entities.LevyAccount.filter({ resident_id: user?.id });
      return res[0] || null;
    },
    enabled: !!user
  });

  const { data: bookings = [] } = useQuery({
    queryKey: ["my_bookings", user?.id],
    queryFn: () => base44.entities.VenueBooking.filter({ resident_id: user?.id }),
    enabled: !!user,
    initialData: []
  });

  const openTickets = tickets.filter(t => !["resolved", "closed"].includes(t.status));
  const unreadAnnouncements = announcements.filter(a => !a.read_by?.includes(user?.id));
  const upcomingBookings = bookings.filter(b => b.status === "approved" && new Date(b.booking_date) >= new Date());

  const quickActions = [
    { label: "Visitors", icon: UserPlus, to: "/ResidentVisitors", color: "bg-sky-500", desc: "Manage guest access" },
    { label: "Book Venue", icon: Calendar, to: "/ResidentBookings", color: "bg-purple-500", desc: "Reserve facilities" },
    { label: "Restaurant", icon: ShoppingBag, to: "/ResidentOrders?type=restaurant", color: "bg-orange-500", desc: "Order food" },
    { label: "Shop", icon: ShoppingBag, to: "/ResidentOrders?type=shop", color: "bg-green-500", desc: "Order groceries" },
    { label: "Laundry", icon: ShirtIcon, to: "/ResidentLaundry", color: "bg-pink-500", desc: "Schedule pickup" },
    { label: "Payments", icon: CreditCard, to: "/ResidentPayments", color: "bg-emerald-500", desc: "Pay levies & more" },
    { label: "My Tickets", icon: Ticket, to: "/ResidentTickets", color: "bg-amber-500", desc: "Report issues" },
    { label: "Security", icon: Shield, to: "/ResidentIncidents", color: "bg-rose-500", desc: "Report incidents" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-6 pb-24">

        {/* Header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}, {user?.full_name?.split(" ")[0]}!
            </h1>
            <p className="text-slate-400 text-sm flex items-center gap-1 mt-1">
              <Home className="w-3 h-3" /> Unit {resident?.unit_number || user?.unit_number || "—"}
            </p>
          </div>
          <Link to="/ResidentNotifications">
            <button className="relative p-2 rounded-xl bg-slate-800 text-slate-300">
              <Bell className="w-5 h-5" />
              {unreadAnnouncements.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 bg-rose-500 text-white text-xs rounded-full flex items-center justify-center">
                  {unreadAnnouncements.length}
                </span>
              )}
            </button>
          </Link>
        </div>

        {/* Levy Status Card */}
        {levyAccount && (
          <Link to="/ResidentPayments">
            <Card className={`border-0 ${levyAccount.status === "overdue" ? "bg-rose-600" : "bg-emerald-600"}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-white/80 text-sm">Levy Account</p>
                  <p className="text-white font-bold text-xl">R {levyAccount.balance_due?.toFixed(2) || "0.00"}</p>
                  <p className="text-white/70 text-xs capitalize">{levyAccount.status}</p>
                </div>
                <div className="text-right">
                  <CreditCard className="w-8 h-8 text-white/60 mb-1 ml-auto" />
                  <p className="text-white/70 text-xs">Monthly: R{levyAccount.monthly_levy}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-amber-400">{openTickets.length}</p>
              <p className="text-xs text-slate-400 mt-1">Open Tickets</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-sky-400">{upcomingBookings.length}</p>
              <p className="text-xs text-slate-400 mt-1">Bookings</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-purple-400">{unreadAnnouncements.length}</p>
              <p className="text-xs text-slate-400 mt-1">Unread News</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-white font-semibold mb-3">Quick Actions</h2>
          <div className="grid grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Link key={action.label} to={action.to}>
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-14 h-14 rounded-2xl ${action.color} flex items-center justify-center shadow-lg`}>
                    <action.icon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-xs text-slate-300 text-center leading-tight">{action.label}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Latest Announcements */}
        {announcements.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">Announcements</h2>
              <Link to="/ResidentAnnouncements" className="text-sky-400 text-sm">View all</Link>
            </div>
            <div className="space-y-3">
              {announcements.slice(0, 3).map(a => (
                <Link key={a.id} to="/ResidentAnnouncements">
                  <Card className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Megaphone className="w-4 h-4 text-sky-400" />
                            <span className="text-white font-medium text-sm">{a.title}</span>
                            {!a.read_by?.includes(user?.id) && (
                              <span className="w-2 h-2 bg-sky-400 rounded-full" />
                            )}
                          </div>
                          <p className="text-slate-400 text-xs line-clamp-2">{a.body}</p>
                        </div>
                        <Badge className={
                          a.priority === "urgent" ? "bg-rose-600" :
                          a.priority === "high" ? "bg-orange-600" :
                          "bg-slate-600"
                        }>
                          {a.category}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Tickets */}
        {openTickets.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold">My Open Tickets</h2>
              <Link to="/ResidentTickets" className="text-sky-400 text-sm">View all</Link>
            </div>
            <div className="space-y-2">
              {openTickets.slice(0, 3).map(t => (
                <Link key={t.id} to="/ResidentTickets">
                  <Card className="bg-slate-800/50 border-slate-700">
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm font-medium">{t.title}</p>
                        <p className="text-slate-400 text-xs capitalize">{t.category} • {t.status}</p>
                      </div>
                      <Badge className={
                        t.priority === "urgent" ? "bg-rose-600" :
                        t.priority === "high" ? "bg-orange-600" :
                        t.priority === "medium" ? "bg-amber-600" :
                        "bg-slate-600"
                      }>
                        {t.priority}
                      </Badge>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}