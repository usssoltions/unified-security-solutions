import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Smartphone, LogOut, RefreshCw, MonitorSmartphone } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { registerThisDevice } from "@/lib/deviceRegistration";

/**
 * DeviceGate — server-authoritative customer device licence gate.
 *
 * After authentication + tenant scope resolution, every TENANT user's
 * installation is registered against their customer's device licence
 * (deviceAccess gateway). The SERVER decides: an existing active
 * registration is reused (never a second slot — multiple users on one
 * installation consume ONE licence), a new installation under the limit is
 * registered, and at/over the limit the app is BLOCKED with the canonical
 * DEVICE LIMIT REACHED screen (Try Again / Sign Out). Logging out never
 * frees the licence — the installation id persists client-side and the
 * registration persists server-side.
 *
 * Platform-level users are exempt (oversight, no customer device licence).
 *
 * Customer Administrators are ALSO exempt from the login-time registration:
 * the device limit licenses OPERATIONAL SCANNER installations, not admin/
 * management logins, so a Customer Admin must reach the management portal
 * without consuming or requiring a slot. This is NOT a scanning bypass —
 * live Access Control operations remain server-side fail-closed in
 * finalizeAccessEntry (resolveCallerDevice), which requires THIS installation
 * to hold an ACTIVE DeviceRegistration for the customer: an admin on a
 * licensed installation can still process gates; an admin on an unlicensed
 * extra device is blocked at every entry/exit exactly like anyone else.
 */
export default function DeviceGate({ user, children }) {
  const [phase, setPhase] = useState("checking"); // checking | ok | blocked | inactive | error
  const [info, setInfo] = useState(null);

  const isPlatform = isPlatformAdminUser(user) || user?.role_type === "admin" || user?.role_type === "platform_admin";
  const isCustomerAdmin = user?.role_type === "customer_admin";
  const applies = !!user && !isPlatform && !isCustomerAdmin && !!user.customer_id;

  const verify = useCallback(async () => {
    setPhase("checking");
    const r = await registerThisDevice();
    if (r?.status === "active") setPhase("ok");
    else if (r?.status === "blocked") { setInfo(r); setPhase("blocked"); }
    else if (r?.status === "inactive") { setInfo(r); setPhase("inactive"); }
    else setPhase("error");
  }, [user?.id]);

  useEffect(() => {
    if (!applies) { setPhase("ok"); return; }
    verify();
  }, [applies, verify]);

  if (!applies || phase === "ok") return children;

  if (phase === "checking") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400 text-sm flex items-center gap-2 justify-center">
            <MonitorSmartphone className="w-4 h-4" /> Verifying this device's licence…
          </p>
        </div>
      </div>
    );
  }

  const signOut = async () => {
    try { await base44.auth.logout(); } catch (_) { window.location.assign("/"); }
  };

  const blocked = phase === "blocked";
  const title = blocked ? "DEVICE LIMIT REACHED" : phase === "inactive" ? "Device Deactivated" : "Device Verification Failed";
  const message = blocked
    ? (info?.message || "This customer has reached the maximum number of registered devices allowed for the account. Please contact your administrator to remove an old device or increase the licensed device limit.")
    : phase === "inactive"
      ? (info?.message || "This device has been deactivated for this customer. Please contact your administrator.")
      : "This device could not be verified against your organisation's device licence. Check your connection and try again.";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <Card className={`max-w-md w-full bg-slate-900 border-2 shadow-2xl ${blocked ? "border-amber-500/60" : "border-slate-700"}`}>
        <CardHeader className="text-center border-b border-slate-700/60">
          <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
            <Smartphone className="w-8 h-8 text-amber-400" />
          </div>
          <CardTitle className="text-xl text-white tracking-wide">{title}</CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <p className="text-slate-300 text-sm leading-relaxed text-center">{message}</p>
          {blocked && info?.device_limit != null && (
            <p className="text-slate-500 text-xs text-center">
              Licensed devices: {info.device_limit} · Currently active: {info.active_count}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Button onClick={verify} className="w-full h-12 font-semibold bg-sky-500 hover:bg-sky-600">
              <RefreshCw className="w-4 h-4 mr-2" /> Try Again
            </Button>
            <Button variant="outline" onClick={signOut} className="w-full h-12 font-semibold border-slate-600 text-slate-200">
              <LogOut className="w-4 h-4 mr-2" /> Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}