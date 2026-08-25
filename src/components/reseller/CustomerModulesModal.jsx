import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Package, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { RESELLER_MODULE_MAP } from "@/lib/resellerModules";

/**
 * CustomerModulesModal — allocate the reseller's licensed modules to a
 * specific customer. The toggle list is limited to modules the reseller is
 * licensed for (resellerLicensedKeys). Each toggle calls the
 * manageCustomerEntitlement backend function, which re-validates the
 * reseller licence server-side — a reseller can never enable a module USS
 * has not authorised.
 */
export default function CustomerModulesModal({ open, onClose, customer, resellerLicensedKeys = [], onDone }) {
  const { toast } = useToast();
  const [customerEnts, setCustomerEnts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (!open || !customer?.id) return;
    setLoading(true);
    base44.entities.ModuleEntitlement.filter({ customer_id: customer.id })
      .then((rows) => setCustomerEnts(rows || []))
      .catch(() => setCustomerEnts([]))
      .finally(() => setLoading(false));
  }, [open, customer?.id]);

  const isEnabled = (key) => customerEnts.some((e) => e.module_key === key && e.enabled && (!e.status || e.status === "active"));
  const licensedKeys = resellerLicensedKeys.length > 0 ? resellerLicensedKeys : Object.keys(RESELLER_MODULE_MAP);

  const toggle = async (key) => {
    setBusy(key);
    const enabled = isEnabled(key);
    try {
      const res = await base44.functions.invoke("manageCustomerEntitlement", {
        action: enabled ? "remove" : "set",
        customer_id: customer.id,
        module_key: key,
        enabled: true,
      });
      const d = res?.data || res;
      if (!d?.success && d?.error) throw new Error(d.error);
      const rows = await base44.entities.ModuleEntitlement.filter({ customer_id: customer.id });
      setCustomerEnts(rows || []);
      toast({ title: enabled ? "Module removed" : "Module enabled", description: RESELLER_MODULE_MAP[key]?.label || key });
      onDone?.();
    } catch (e) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-emerald-400" />
            Customer Modules
            {customer?.name && <span className="text-slate-400 text-sm font-normal">· {customer.name}</span>}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-slate-400 -mt-1">
          Only modules licensed to this reseller can be enabled for the customer.
        </p>
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-sky-500 animate-spin" /></div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {licensedKeys.length === 0 && (
              <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                This reseller has no licensed modules. Grant modules on the reseller's "Licences &amp; Modules" tab first.
              </div>
            )}
            {licensedKeys.map((key) => {
              const mod = RESELLER_MODULE_MAP[key];
              const on = isEnabled(key);
              return (
                <div key={key} className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">{mod?.label || key}</p>
                    <p className="text-xs text-slate-400 truncate">{mod?.description || ""}</p>
                  </div>
                  <Button size="sm" variant={on ? "default" : "outline"} disabled={busy === key} onClick={() => toggle(key)}
                    className={on ? "bg-emerald-500 hover:bg-emerald-600" : "border-slate-600 text-slate-300"}>
                    {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <CheckCircle2 className="w-4 h-4 mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                    {on ? "Enabled" : "Enable"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Badge variant="outline" className="text-slate-400 border-slate-600">{customerEnts.filter((e) => e.enabled).length} active</Badge>
          <Button variant="ghost" onClick={() => onClose?.()} className="text-slate-300">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}