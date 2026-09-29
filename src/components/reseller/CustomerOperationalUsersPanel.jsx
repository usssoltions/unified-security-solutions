import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Loader2, AlertTriangle, Save } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

/**
 * CustomerOperationalUsersPanel — the OPERATIONAL USER licensing display.
 * The SECOND, independent customer entitlement (operational_user_limit):
 * operational users are the people who operate the security/access-control
 * system (guards, dispatchers, control-room operators); active users and
 * valid pending invitations each consume one slot. A Customer
 * Administrator does NOT consume a slot.
 *
 * Everyone can view usage here; ONLY Platform Administrators can change the
 * licensed allowance (customerAccess set_operational_user_limit — enforced
 * server-side; hiding the editor is never the control).
 */
export default function CustomerOperationalUsersPanel({ customerId, onChanged }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);
  const [limitDraft, setLimitDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("customerAccess", { action: "usage", customer_id: customerId });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      setUsage(d);
      setLimitDraft(d?.operational?.limit != null ? String(d.operational.limit) : "");
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed to load user licensing", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const saveLimit = async () => {
    const n = Number(limitDraft);
    if (!limitDraft || !Number.isInteger(n) || n < 1) {
      toast({ title: "Invalid user allowance", description: "Enter a whole number (minimum 1).", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("customerAccess", {
        action: "set_operational_user_limit", customer_id: customerId, operational_user_limit: n,
      });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: "Operational user allowance updated", description: `Licensed operational users: ${n}` });
      onChanged?.();
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-slate-900/60 border-slate-700/50">
        <CardContent className="flex items-center justify-center py-8 text-slate-400">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading user licensing…
        </CardContent>
      </Card>
    );
  }

  const op = usage?.operational || {};
  const unconfigured = op.requires_configuration;

  return (
    <Card className="bg-slate-900/60 border-slate-700/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-emerald-400" /> Operational Users
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {unconfigured && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-amber-300 text-xs">Operational user allowance requires configuration. Licences are not enforced until a Platform Administrator configures the allowance.</p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-950/60 border border-slate-700/50 rounded-lg p-3 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Licensed</p>
            <p className="text-xl font-bold text-white">{op.limit ?? "—"}</p>
          </div>
          <div className="bg-slate-950/60 border border-slate-700/50 rounded-lg p-3 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Used Slots</p>
            <p className="text-xl font-bold text-white">{op.used ?? 0}</p>
          </div>
          <div className="bg-slate-950/60 border border-slate-700/50 rounded-lg p-3 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Available</p>
            <p className="text-xl font-bold text-white">{op.available ?? "—"}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Operational users are guards, dispatchers and control-room operators who operate the security/access-control system.
          Used slots = {op.active ?? 0} active user{(op.active ?? 0) === 1 ? "" : "s"} + {op.pending ?? 0} pending invitation{(op.pending ?? 0) === 1 ? "" : "s"}.
          Customer Administrators do not consume an operational-user slot.
        </p>
        {usage?.can_change_limits ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label className="text-slate-300 text-xs">Allowed Operational Users (Platform Admin)</Label>
              <Input type="number" min="1" step="1" value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                className="bg-slate-950 border-slate-700 text-white mt-1" />
            </div>
            <Button onClick={saveLimit} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Update
            </Button>
          </div>
        ) : (
          <div className="text-xs text-slate-500 bg-slate-950/40 border border-slate-700/30 rounded p-2">
            Only a Platform Administrator can change the licensed operational-user allowance.
          </div>
        )}
      </CardContent>
    </Card>
  );
}