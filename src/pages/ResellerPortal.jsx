import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Users, Package, Settings, Loader2, ChevronRight, Sliders, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import moment from "moment";

export default function ResellerPortal() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [stats, setStats] = useState({ customers: 0, activeCustomers: 0, totalUsers: 0, totalSites: 0 });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const rid = u.reseller_id;
      if (!rid) { setLoading(false); return; }

      const [custs, entitlements] = await Promise.all([
        base44.entities.Customer.filter({ reseller_id: rid }).catch(() => []),
        base44.entities.ModuleEntitlement.filter({ reseller_id: rid }).catch(() => []),
      ]);
      setCustomers(custs);
      setStats({
        customers: custs.length,
        activeCustomers: custs.filter(c => c.status === "active").length,
        totalUsers: 0,
        totalSites: 0,
      });
    } catch (e) {
      console.error("ResellerPortal error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  if (!user?.reseller_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <Card className="bg-slate-900 border-slate-800 max-w-md">
          <CardContent className="p-8 text-center">
            <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h2 className="text-white font-bold text-lg mb-2">Reseller Access Required</h2>
            <p className="text-slate-400 text-sm">This portal is only available to Reseller Administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Reseller Portal</h1>
            <p className="text-slate-400 text-sm">Manage your customers, sites, and configuration</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-sky-400" />
                <p className="text-slate-400 text-xs">Customers</p>
              </div>
              <p className="text-2xl font-bold text-white">{stats.customers}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-emerald-400" />
                <p className="text-slate-400 text-xs">Active</p>
              </div>
              <p className="text-2xl font-bold text-white">{stats.activeCustomers}</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-violet-400" />
                <p className="text-slate-400 text-xs">Modules</p>
              </div>
              <p className="text-2xl font-bold text-white">—</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          <Link to={createPageUrl("UserManagement")}>
            <Card className="bg-slate-900 border-slate-800 hover:border-sky-500/30 transition cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-sky-500/20 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-sky-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">User Management</p>
                  <p className="text-slate-400 text-xs">Manage your users</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </CardContent>
            </Card>
          </Link>
          <Link to={createPageUrl("Configuration")}>
            <Card className="bg-slate-900 border-slate-800 hover:border-sky-500/30 transition cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                  <Sliders className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">Configuration</p>
                  <p className="text-slate-400 text-xs">System settings</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </CardContent>
            </Card>
          </Link>
          <Link to={createPageUrl("Reports")}>
            <Card className="bg-slate-900 border-slate-800 hover:border-sky-500/30 transition cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 bg-violet-500/20 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-violet-400" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium text-sm">Reports</p>
                  <p className="text-slate-400 text-xs">View reports</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-500" />
              </CardContent>
            </Card>
          </Link>
        </div>

        <h2 className="text-white font-medium text-sm mb-3">Your Customers</h2>
        {customers.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No customers assigned to your reseller</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {customers.map(c => (
              <Card key={c.id} className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-medium text-sm">{c.name}</p>
                      <p className="text-slate-400 text-xs mt-0.5">{c.customer_type} • {c.email || "No email"}</p>
                      {c.address && <p className="text-slate-500 text-xs mt-1">{c.address}</p>}
                    </div>
                    <Badge className={`text-xs shrink-0 ${
                      c.status === "active" ? "bg-emerald-500/20 text-emerald-400" :
                      c.status === "suspended" ? "bg-rose-500/20 text-rose-400" :
                      "bg-slate-500/20 text-slate-400"
                    }`}>{c.status}</Badge>
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