import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import ResellerConsole from "@/components/reseller/ResellerConsole";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

/**
 * ResellerManagement — Platform Admin route to manage a single reseller.
 * Reached from Tenant Setup → Resellers (clickable). Renders the full
 * ResellerConsole with platform-level powers (licensing, status, reseller
 * admin creation).
 */
export default function ResellerManagement() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const resellerId = new URLSearchParams(window.location.search).get("id");

  useEffect(() => {
    base44.auth.me()
      .then((u) => { setUser(u); if (!isPlatformAdminUser(u)) setDenied(true); })
      .catch(() => setDenied(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }
  if (denied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center max-w-md">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-white font-bold text-lg mb-2">Platform Admin Access Required</h2>
          <p className="text-slate-400 text-sm">Reseller management is only available to USS Platform Administrators.</p>
        </div>
      </div>
    );
  }
  if (!resellerId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center max-w-md">
          <h2 className="text-white font-bold text-lg mb-3">No reseller selected</h2>
          <Link to="/TenantSetup"><Button className="bg-sky-500 hover:bg-sky-600"><ArrowLeft className="w-4 h-4 mr-1" /> Back to Tenant Setup</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <Link to="/TenantSetup" className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Tenant Setup
        </Link>
        <ResellerConsole resellerId={resellerId} viewer="platform" viewAs={false} />
      </div>
    </div>
  );
}