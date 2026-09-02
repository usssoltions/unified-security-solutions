import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, CheckCircle2, Link2, Unlink } from "lucide-react";

/**
 * GoogleCalendarConnect — lets a medical practice admin connect THEIR OWN
 * Google Calendar (APP_USER connector) so that practice's appointments sync to
 * it. Each practice connects independently; no cross-practice calendar access.
 *
 * Implements the three app-user-connector rules:
 *  1. Auth gate before rendering connector UI.
 *  2. Connection status via the probe data fetch (success → connected).
 *  3. OAuth popup → poll closed → auto-refresh connection status.
 */
const CONNECTOR_ID = "6a97c1dcdc06dfae9a38934b";

export default function GoogleCalendarConnect() {
  const [authed, setAuthed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);

  // Rule 2: reusable probe — doubles as connection check.
  const checkConnection = async () => {
    try {
      const res = await base44.functions.invoke("syncAppointmentToCalendar", { action: "probe" });
      const data = res?.data ?? res;
      setConnected(!!data?.connected);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  };

  // Rule 1 + 2: check auth first, then probe connection status.
  useEffect(() => {
    base44.auth.isAuthenticated().then(async (isAuthed) => {
      setAuthed(isAuthed);
      if (isAuthed) await checkConnection();
      else setChecking(false);
    });
  }, []);

  // Rule 3: open OAuth popup, poll for close, then re-probe.
  const handleConnect = async () => {
    setBusy(true);
    try {
      const url = await base44.connectors.connectAppUser(CONNECTOR_ID);
      const popup = window.open(url, "_blank");
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          checkConnection();
          setBusy(false);
        }
      }, 600);
    } catch {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await base44.connectors.disconnectAppUser(CONNECTOR_ID);
      setConnected(false);
    } finally {
      setBusy(false);
    }
  };

  if (!authed) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4">
          <p className="text-slate-400 text-sm mb-3">Sign in to connect your practice calendar.</p>
          <Button onClick={() => base44.auth.redirectToLogin()} className="bg-emerald-500 hover:bg-emerald-600">
            Sign in
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (checking) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-4 flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          <span className="text-slate-400 text-sm">Checking calendar connection…</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
            <Calendar className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-medium text-sm">Google Calendar Sync</p>
            <p className="text-slate-400 text-xs">Sync this practice's appointments to your calendar</p>
          </div>
        </div>

        {connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <CheckCircle2 className="w-4 h-4" />
              <span>Connected — appointments sync automatically</span>
            </div>
            <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={busy} className="border-slate-600 text-slate-200">
              <Unlink className="w-3.5 h-3.5 mr-1" /> Disconnect
            </Button>
          </div>
        ) : (
          <Button onClick={handleConnect} disabled={busy} className="w-full bg-emerald-500 hover:bg-emerald-600">
            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Link2 className="w-4 h-4 mr-1" />}
            Connect Google Calendar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}