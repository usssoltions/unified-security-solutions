import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eraser, ShieldAlert, Trash2, Archive } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/datetime";

/**
 * PLATFORM ADMIN — TEST DATA CLEANUP. Identifies CLEARLY-FLAGGED [TEST]
 * records for ONE explicitly-selected customer, shows what is safe to
 * delete versus what must be archived, and cleans them through the SAME
 * lifecycle eligibility rules enforced by the gateway (delete only
 * history-free records with an audit tombstone; archive the rest). It is
 * never a general unrestricted delete tool and can never affect another
 * tenant — every query is customer-scoped server-side.
 */
export default function TestDataCleanup() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState("");
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);

  const isPA = isPlatformAdminUser(user) || user?.role === "admin";

  const { data: customersData, isLoading: loadingCustomers } = useQuery({
    queryKey: ["testDataCustomers"],
    queryFn: async () => {
      const res = await base44.functions.invoke("scheduledTaskAccess", { action: "testDataCustomers" });
      return res?.data ?? res;
    },
    enabled: !!user && isPA,
  });
  const customers = customersData?.customers || [];

  const runScan = async () => {
    if (!customerId) return;
    setBusy(true);
    setScan(null);
    try {
      const res = await base44.functions.invoke("scheduledTaskAccess", {
        action: "testDataScan", customer_id: customerId,
      });
      setScan(res?.data ?? res);
    } catch (e) {
      toast({ title: e?.response?.data?.error || e.message || "Scan failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const runCleanup = async () => {
    if (!scan) return;
    if (!window.confirm(
      `Clean up ${scan.counts.flagged} clearly-flagged [TEST] record set(s) for ${scan.customer.name}?\n\n` +
      `History-free records will be PERMANENTLY DELETED (audit tombstones created); records with sign-offs, evidence, reasons or delivered reports will be ARCHIVED, not deleted.\n\nThis never affects any other customer.`)) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke("scheduledTaskAccess", {
        action: "testDataCleanup", customer_id: customerId, confirm: true,
      });
      const d = res?.data ?? res;
      toast({ title: `Cleanup complete — ${d.deleted_batches || 0} list(s) / ${d.deleted_tasks || 0} task(s) deleted, ${d.archived_batches || 0} list(s) / ${d.archived_tasks || 0} task(s) archived` });
      await runScan();
    } catch (e) {
      toast({ title: e?.response?.data?.error || e.message || "Cleanup failed", variant: "destructive" });
    } finally { setBusy(false); }
  };

  if (!user || !isPA) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center">
          <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-white">Not authorised</h1>
          <p className="text-sm text-slate-400 mt-1">
            Test Data Cleanup is restricted to Platform Administrators.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto w-full">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
          <Eraser className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Test Data Cleanup</h1>
          <p className="text-sm text-slate-400">Identify and safely clean clearly-flagged [TEST] records for one customer</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setScan(null); }}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white h-11">
                <SelectValue placeholder={loadingCustomers ? "Loading customers..." : "Select the customer"} />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700 z-[60]">
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-white">
                    {c.name}{c.status !== "active" ? ` (${c.status})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runScan} disabled={!customerId || busy}
            className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white h-11 px-5">
            {busy ? "Scanning..." : "Scan"}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Only records explicitly flagged [TEST] are ever touched. Deletion follows the same
          safety rules as in-app lifecycle actions — signed, evidenced or reported records are archived, never destroyed.
        </p>
      </div>

      {scan && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
            <h2 className="font-semibold text-white mb-3">{scan.customer.name} — inventory</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              {[
                ["Task lists", scan.counts.batches],
                ["Tasks", scan.counts.tasks],
                ["Control rooms", `${scan.counts.control_rooms_active} active / ${scan.counts.control_rooms}`],
                ["Flagged [TEST]", scan.counts.flagged],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-800/60 border border-slate-700/50 p-3">
                  <p className="text-lg font-bold text-white">{value}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
            <h2 className="font-semibold text-white mb-3">
              Flagged records — {scan.counts.safe_to_delete} safe to delete · {scan.counts.to_archive} to archive instead
            </h2>
            {scan.flagged.length === 0 ? (
              <p className="text-sm text-slate-400">No clearly-flagged [TEST] records found for this customer.</p>
            ) : (
              <div className="space-y-2">
                {scan.flagged.map((f) => (
                  <div key={f.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">{f.title}</p>
                        <Badge variant="outline" className={
                          f.safe_to_delete
                            ? "bg-rose-500/15 text-rose-300 border-rose-500/30"
                            : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                        }>
                          {f.safe_to_delete ? <Trash2 className="w-3 h-3 mr-1" /> : <Archive className="w-3 h-3 mr-1" />}
                          {f.safe_to_delete ? "Safe to delete" : "Archive instead"}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        {f.type === "batch" ? (f.is_series ? "Recurring series" : "Task list") : "Task"}
                        {" · "}{formatDate(f.scheduled_date)} · {f.control_room_name || "—"}
                        {" · "}{f.task_count} task(s) · status {f.status}{f.archived ? " (archived)" : ""}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">{f.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {scan.flagged.length > 0 && (
            <Button onClick={runCleanup} disabled={busy}
              variant="destructive" className="w-full h-12">
              <Trash2 className="w-5 h-5" />
              {busy ? "Cleaning..." : `Clean up ${scan.counts.flagged} flagged record set(s)`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}