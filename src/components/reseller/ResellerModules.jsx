import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { RESELLER_MODULES, RESELLER_MODULE_MAP } from "@/lib/resellerModules";

/**
 * ResellerModules — the modules USS has authorised for this reseller
 * (ResellerEntitlement). Only Platform Admin can grant/modify these.
 * Reseller Admins see a read-only list of what they are licensed to offer.
 * Customer allocation is limited to these modules (enforced server-side by
 * manageCustomerEntitlement).
 */
export default function ResellerModules({ resellerId, resellerEntitlements, onRefresh, canLicense }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(null);

  const entitlementFor = (key) => resellerEntitlements.find((e) => e.module_key === key);
  const isLicensed = (key) => {
    const e = entitlementFor(key);
    return !!e && e.enabled && (!e.status || e.status === "active");
  };

  const toggle = async (key) => {
    setBusy(key);
    const existing = entitlementFor(key);
    const willEnable = !isLicensed(key);
    try {
      if (existing) {
        if (canLicense) {
          await base44.entities.ResellerEntitlement.update(existing.id, { enabled: willEnable, status: willEnable ? "active" : "suspended" });
        } else {
          throw new Error("Only Platform Admin can modify reseller licences");
        }
      } else {
        if (!canLicense) throw new Error("Only Platform Admin can grant reseller licences");
        await base44.entities.ResellerEntitlement.create({
          reseller_id: resellerId,
          module_key: key,
          module_label: RESELLER_MODULE_MAP[key]?.label || key,
          enabled: true,
          status: "active",
        });
      }
      toast({ title: willEnable ? "Module licensed" : "Module suspended", description: RESELLER_MODULE_MAP[key]?.label || key });
      onRefresh?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 bg-sky-500/10 border border-sky-500/20 rounded-lg p-3">
        <Lock className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-300">
          These are the USS modules this reseller is authorised to offer. Customers under this reseller can only be allocated modules that are licensed here. {!canLicense && <span className="text-amber-400">You have read-only access.</span>}
        </p>
      </div>

      <div className="space-y-2">
        {RESELLER_MODULES.map((m) => {
          const on = isLicensed(m.key);
          return (
            <div key={m.key} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white flex items-center gap-2">
                  {on ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-slate-500" />}
                  {m.label}
                </p>
                <p className="text-xs text-slate-400">{m.description}</p>
              </div>
              {canLicense ? (
                <Button size="sm" variant={on ? "default" : "outline"} disabled={busy === m.key} onClick={() => toggle(m.key)}
                  className={on ? "bg-emerald-500 hover:bg-emerald-600" : "border-slate-600 text-slate-300"}>
                  {busy === m.key ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? "Licensed" : "Grant"}
                </Button>
              ) : (
                <Badge className={on ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700/40 text-slate-500"}>{on ? "Licensed" : "Not licensed"}</Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}