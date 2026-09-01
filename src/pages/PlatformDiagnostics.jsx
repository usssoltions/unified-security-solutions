import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Gauge, ShieldAlert, Loader2, Play, AlertTriangle,
} from "lucide-react";

/**
 * Internal performance & credit diagnostics — Platform Admin only.
 *
 * Surfaces:
 *  - AutomationSetting inventory (which background automations are enabled,
 *    each of which consumes integration credits per run)
 *  - Recent PlatformAuditLog volume (operational signal of system activity)
 *  - A manual RLS diagnostic runner (diagnoseResellerRls) for tenant isolation
 *    verification, with results persisted to PlatformAuditLog server-side.
 */
export default function PlatformDiagnostics() {
  const [automation, setAutomation] = useState(null);
  const [auditCount, setAuditCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resellerId, setResellerId] = useState("");
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagError, setDiagError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [auto, audit] = await Promise.all([
          base44.entities.AutomationSetting.list(1, 1).catch(() => []),
          base44.entities.PlatformAuditLog.list("-created_date", 1).catch(() => []),
        ]);
        setAutomation(Array.isArray(auto) ? auto[0] : null);
        setAuditCount(Array.isArray(audit) ? audit.length : 0);
      } catch (e) {
        console.error("Diagnostics load failed:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const runDiagnostic = async () => {
    if (!resellerId.trim()) return;
    setDiagRunning(true);
    setDiagResult(null);
    setDiagError(null);
    try {
      const res = await base44.functions.invoke("diagnoseResellerRls", { reseller_id: resellerId.trim() });
      setDiagResult(res?.data || res);
    } catch (e) {
      setDiagError(e?.message || String(e));
    } finally {
      setDiagRunning(false);
    }
  };

  const automationKeys = automation
    ? Object.entries(automation).filter(([, v]) => typeof v === "boolean")
    : [];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
            <Gauge className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Platform Diagnostics</h1>
            <p className="text-slate-400 text-sm">Automation inventory, credit usage signals & RLS isolation checks</p>
          </div>
        </div>

        {/* Automation inventory */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-3 flex items-center gap-2"><Activity className="w-4 h-4" /> Background Automation Inventory</p>
            <p className="text-xs text-slate-500 mb-3">
              Each enabled automation runs on a schedule and consumes integration credits (email/push/LLM) per execution.
              Disable automations that are not in use to reduce credit spend.
            </p>
            {automationKeys.length === 0 ? (
              <p className="text-slate-400 text-sm">No automation settings configured.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {automationKeys.map(([key, on]) => (
                  <div key={key} className="flex items-center justify-between p-2 bg-slate-950/50 rounded-lg text-xs">
                    <span className="text-slate-300 capitalize">{key.replace(/_/g, " ")}</span>
                    <Badge className={on ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700/50 text-slate-400"}>
                      {on ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audit activity signal */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4">
            <p className="text-white font-medium mb-2 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Audit Activity</p>
            <p className="text-slate-400 text-sm">
              Recent PlatformAuditLog records readable: <span className="text-white font-semibold">{auditCount ?? 0}</span>.
              A persistent zero indicates no recent audited operations or an RLS visibility issue for this admin.
            </p>
          </CardContent>
        </Card>

        {/* RLS diagnostic runner */}
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 space-y-3">
            <p className="text-white font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Reseller RLS Isolation Diagnostic</p>
            <p className="text-xs text-slate-500">
              Runs the server-side <code className="text-slate-400">diagnoseResellerRls</code> function for a reseller and
              returns tenant-isolation findings. Results are persisted to PlatformAuditLog server-side.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <Label className="text-slate-300 text-sm">Reseller ID</Label>
                <Input
                  value={resellerId}
                  onChange={(e) => setResellerId(e.target.value)}
                  placeholder="Paste a reseller document id"
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={runDiagnostic} disabled={diagRunning || !resellerId.trim()} className="bg-sky-600 hover:bg-sky-700">
                  {diagRunning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                  Run Diagnostic
                </Button>
              </div>
            </div>

            {diagError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-300 text-sm">
                {diagError}
              </div>
            )}
            {diagResult && (
              <div className="p-3 bg-slate-950/50 rounded-lg border border-slate-800 overflow-x-auto">
                <pre className="text-xs text-slate-300 whitespace-pre-wrap">{JSON.stringify(diagResult, null, 2)}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}