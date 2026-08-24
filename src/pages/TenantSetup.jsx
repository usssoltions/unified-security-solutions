import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Building2, Shield } from "lucide-react";
import TenantSetupManager from "@/components/tenant/TenantSetupManager";

/**
 * TenantSetup — Platform Admin page for creating the tenant hierarchy
 * (Reseller → Customer → Site) and safely migrating historical data.
 *
 * Access: platform_admin only. The component itself does a guard, but
 * ProtectedPage enforces it at the route level too.
 */
export default function TenantSetup() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      if (u.role !== "admin" && u.role_type !== "platform_admin") {
        setDenied(true);
      }
    } catch (e) {
      setDenied(true);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  if (denied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center max-w-md">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-white font-bold text-lg mb-2">Platform Admin Access Required</h2>
          <p className="text-slate-400 text-sm">This page is only available to Platform Administrators.</p>
        </div>
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
            <h1 className="text-2xl font-bold text-white">Tenant Setup & Migration</h1>
            <p className="text-slate-400 text-sm">Create the tenant hierarchy and safely backfill historical data</p>
          </div>
        </div>
        <TenantSetupManager user={user} />
      </div>
    </div>
  );
}