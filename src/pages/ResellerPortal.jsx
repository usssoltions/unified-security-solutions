import React, { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Shield, Eye, ArrowRight } from "lucide-react";
import ResellerConsole from "@/components/reseller/ResellerConsole";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { getUserDisplayName } from "@/lib/userDisplayName";

// NOTE: the temporary RLS diagnostic (?diag=1) instrumentation has been
// removed after verification — membership-based Reseller RLS is confirmed
// working (own reseller = allowed, other = 404, list = own only). The
// diagnoseResellerRls backend function is retained for on-demand use.

/**
 * ResellerPortal — the Reseller Admin's home console.
 *  - Reseller Admin (role_type reseller_admin / admin_level reseller): sees a
 *    management console scoped to their own reseller (no platform powers:
 *    cannot licence modules or change reseller status, cannot see other
 *    resellers or USS direct customers).
 *  - Platform Admin with ?viewAs=<resellerId>: read-only preview of a reseller's
 *    experience (audited), without changing the real session permissions.
 *  - Platform Admin without viewAs: a picker to open a reseller's console
 *    (Manage → ResellerManagement) or preview it (View as → this page w/ viewAs).
 */
export default function ResellerPortal() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resellers, setResellers] = useState([]);
  const viewAsId = useMemo(() => new URLSearchParams(window.location.search).get("viewAs"), []);

  useEffect(() => {
    let cancelled = false;
    base44.auth.me()
      .then(async (u) => {
        if (cancelled) return;
        setUser(u);
        // Record view-as access (audit). PlatformAuditLog create allows user_id == caller.id.
        if (viewAsId && isPlatformAdminUser(u)) {
          try {
            await base44.entities.PlatformAuditLog.create({
              event_type: "reseller.view_as",
              user_id: u.id,
              user_name: getUserDisplayName(u),
              reseller_id: viewAsId,
              action: "view_as_reseller",
              notes: `Platform admin previewed reseller experience ${viewAsId}`,
            });
          } catch (_) { /* best-effort audit */ }
        }
        if (isPlatformAdminUser(u) && !viewAsId) {
          const r = await base44.entities.Reseller.list().catch(() => []);
          if (!cancelled) setResellers(r || []);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [viewAsId]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="w-8 h-8 text-sky-500 animate-spin" /></div>;
  }

  const isPlatformAdmin = isPlatformAdminUser(user);

  // Platform Admin view-as mode
  if (isPlatformAdmin && viewAsId) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          <Button variant="ghost" onClick={() => navigate("/ResellerPortal")} className="text-slate-400 hover:text-white mb-3">
            <ArrowRight className="w-4 h-4 mr-1 rotate-180" /> Exit View-As
          </Button>
          <ResellerConsole resellerId={viewAsId} viewer="reseller" viewAs={true} />
        </div>
      </div>
    );
  }

  // Platform Admin picker
  if (isPlatformAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center"><Building2 className="w-6 h-6 text-white" /></div>
            <div><h1 className="text-2xl font-bold text-white">Reseller Portal</h1><p className="text-slate-400 text-sm">Open a reseller to manage or preview its experience.</p></div>
          </div>
          {resellers.length === 0 ? (
            <Card className="bg-slate-900 border-slate-800"><CardContent className="p-6 text-center text-slate-400 text-sm">No resellers yet. Create one in <Link to="/TenantSetup" className="text-sky-400 underline">Tenant Setup</Link>.</CardContent></Card>
          ) : resellers.map((r) => (
            <Card key={r.id} className="bg-slate-900 border-slate-800 mb-2">
              <CardContent className="p-3 flex items-center justify-between">
                <div><p className="text-white font-medium">{r.name}</p><p className="text-slate-500 text-xs">{r.legal_name || "—"}</p></div>
                <div className="flex items-center gap-2">
                  <Badge className={r.status === "active" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-500/20 text-slate-400"}>{r.status}</Badge>
                  <Link to={`/ResellerManagement?id=${r.id}`}><Button size="sm" className="bg-sky-500 hover:bg-sky-600">Manage</Button></Link>
                  <Link to={`/ResellerPortal?viewAs=${r.id}`}><Button size="sm" variant="outline" className="border-slate-600 text-slate-300"><Eye className="w-4 h-4 mr-1" /> View as</Button></Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Reseller Admin own-portal
  const isResellerAdmin = user?.role_type === "reseller_admin" || user?.admin_level === "reseller";
  if (!isResellerAdmin || !user?.reseller_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="text-center max-w-md">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-white font-bold text-lg mb-2">Reseller Access Required</h2>
          <p className="text-slate-400 text-sm">Your account is not linked to a reseller. Contact your USS Platform Administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <ResellerConsole resellerId={user.reseller_id} viewer="reseller" viewAs={false} />
      </div>
    </div>
  );
}