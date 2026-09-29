import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Smartphone, Loader2, RefreshCw, Settings2, Power, PowerOff, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/datetime";

/**
 * CustomerDevicesPanel — customer-wide device licensing management
 * (Platform Admin → Customers → Customer → Devices).
 *
 * All data flows through the authoritative deviceAccess/customerAccess
 * gateways: licence summary, device list, rename / site / gate assignment,
 * deactivate/reactivate, and (platform-level only) the licensed device
 * allowance itself — a customer can never change its own allowance.
 */
export default function CustomerDevicesPanel({ customerId, customer, sites = [], onChanged }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState(null);
  const [canSetLimit, setCanSetLimit] = useState(false);
  const [limitDraft, setLimitDraft] = useState("");
  const [limitSaving, setLimitSaving] = useState(false);
  const [editDevice, setEditDevice] = useState(null); // device being edited
  const [editDraft, setEditDraft] = useState({ device_name: "", site_id: "none", gate_name: "" });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("deviceAccess", { action: "list", customer_id: customerId });
      const d = res?.data || res;
      setDevices(d?.devices || []);
      setSummary(d?.summary || null);
      setCanSetLimit(!!d?.can_set_limit);
      setLimitDraft(d?.summary?.device_limit != null ? String(d.summary.device_limit) : "");
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed to load devices", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const saveLimit = async () => {
    const dl = Number(limitDraft);
    if (!limitDraft || !Number.isInteger(dl) || dl < 1) {
      toast({ title: "Invalid device allowance", description: "Enter a whole number (minimum 1).", variant: "destructive" });
      return;
    }
    setLimitSaving(true);
    try {
      const res = await base44.functions.invoke("customerAccess", {
        action: "set_device_limit", customer_id: customerId, device_limit: dl,
      });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: "Device allowance updated", description: `Licensed devices: ${dl}` });
      onChanged?.();
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLimitSaving(false);
    }
  };

  const openEdit = (d) => {
    setEditDevice(d);
    setEditDraft({ device_name: d.device_name || "", site_id: d.site_id || "none", gate_name: d.gate_name || "" });
  };

  const saveEdit = async () => {
    setBusyId(editDevice.id);
    try {
      const res = await base44.functions.invoke("deviceAccess", {
        action: "update",
        device_id: editDevice.id,
        device_name: editDraft.device_name,
        site_id: editDraft.site_id,
        gate_name: editDraft.gate_name,
      });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: "Device updated" });
      setEditDevice(null);
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (d, status) => {
    if (status === "deactivated" && !window.confirm(`Deactivate "${d.device_name}"? Its licence slot is freed and access from this installation is blocked.`)) return;
    setBusyId(d.id);
    try {
      const res = await base44.functions.invoke("deviceAccess", {
        action: "set_status", device_id: d.id, status,
      });
      const d2 = res?.data || res;
      if (!d2?.success) throw new Error(d2?.error || "Failed");
      toast({ title: status === "active" ? "Device reactivated" : "Device deactivated", description: d.device_name });
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const statusBadge = (s) =>
    s === "active" ? "bg-emerald-500/20 text-emerald-400"
    : s === "deactivated" ? "bg-amber-500/20 text-amber-400"
    : "bg-rose-500/20 text-rose-400";

  const siteName = (id) => (sites.find((s) => s.id === id) || {}).name || "—";

  return (
    <div className="space-y-3">
      {/* Licence summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-sky-400" />
            <div>
              <p className="text-2xl font-bold text-white">{summary?.device_limit ?? "—"}</p>
              <p className="text-slate-400 text-xs">Licensed Devices</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <Power className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-2xl font-bold text-white">{summary?.active_count ?? "…"}</p>
              <p className="text-slate-400 text-xs">Active Devices</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="p-4 flex items-center gap-3">
            <PowerOff className="w-5 h-5 text-amber-400" />
            <div>
              <p className="text-2xl font-bold text-white">{summary?.slots_available ?? "—"}</p>
              <p className="text-slate-400 text-xs">Available Slots</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Device allowance (platform-level only) */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader><CardTitle className="text-white text-sm">Device Allowance</CardTitle></CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label className="text-slate-300 text-xs">Licensed Devices (allowed app installations)</Label>
            {canSetLimit ? (
              <div className="flex gap-2 mt-1">
                <Input type="number" min="1" step="1" value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} className="bg-slate-950 border-slate-700 text-white w-32" />
                <Button onClick={saveLimit} disabled={limitSaving} className="bg-sky-500 hover:bg-sky-600">
                  {limitSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Update Allowance
                </Button>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-700 rounded-md px-3 py-2 mt-1 text-sm text-white">
                {summary?.device_limit ?? "Not configured"}
                <p className="text-xs text-slate-500 mt-0.5">Only a Platform Administrator can change the licensed device allowance.</p>
              </div>
            )}
          </div>
          {summary?.requires_configuration && (
            <div className="flex items-start gap-2 text-amber-300 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Device allowance requires configuration. Device registration is unlicensed until a Platform Administrator sets an allowance — existing users are never locked out by an arbitrary default.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Device list */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-white text-sm">Registered Devices ({devices.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={load} className="border-slate-600 text-slate-300">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading && (
            <p className="flex items-center gap-2 text-slate-500 text-sm py-4 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading devices…</p>
          )}
          {!loading && devices.length === 0 && (
            <p className="text-slate-500 text-sm text-center py-6">No devices registered yet. Devices register automatically the first time a user of this customer signs in on a new installation.</p>
          )}
          {devices.map((d) => (
            <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-800/40 p-3 rounded-lg">
              <div className="min-w-0">
                <p className="text-white text-sm font-medium flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-slate-500" /> {d.device_name}
                  <Badge className={statusBadge(d.status)}>{d.status}</Badge>
                </p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-500 mt-1">
                  <span>Site: <span className="text-slate-300">{siteName(d.site_id)}</span></span>
                  <span>Gate: <span className="text-slate-300">{d.gate_name || "—"}</span></span>
                  <span>Platform: <span className="text-slate-300">{d.device_platform || "—"}{d.device_model ? ` (${d.device_model})` : ""}</span></span>
                  <span>Type: <span className="text-slate-300">{d.app_type || "—"}</span></span>
                  <span>First registered: <span className="text-slate-300">{formatDateTime(d.first_registered_at)}</span></span>
                  <span>Last seen: <span className="text-slate-300">{formatDateTime(d.last_seen_at)}</span></span>
                  <span className="col-span-2">Last user: <span className="text-slate-300">{d.last_user_name || "—"}</span></span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => openEdit(d)} className="border-slate-600 text-slate-200">
                  <Settings2 className="w-4 h-4 mr-1" /> Edit
                </Button>
                {d.status === "active" ? (
                  <Button size="sm" variant="destructive" onClick={() => setStatus(d, "deactivated")} disabled={busyId === d.id}>
                    {busyId === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />} Deactivate
                  </Button>
                ) : d.status !== "revoked" ? (
                  <Button size="sm" onClick={() => setStatus(d, "active")} disabled={busyId === d.id} className="bg-emerald-500 hover:bg-emerald-600">
                    {busyId === d.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Reactivate
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Edit dialog: rename / assign site / assign gate */}
      <Dialog open={!!editDevice} onOpenChange={(v) => { if (!v) setEditDevice(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Device</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2">
            <div>
              <Label className="text-slate-300 text-xs">Device Name *</Label>
              <Input value={editDraft.device_name} onChange={(e) => setEditDraft({ ...editDraft, device_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" placeholder="e.g. Gate 1 Scanner" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Site</Label>
              <Select value={editDraft.site_id} onValueChange={(v) => setEditDraft({ ...editDraft, site_id: v })}>
                <SelectTrigger className="bg-slate-950 border-slate-700 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No site assignment (mobile/roaming)</SelectItem>
                  {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Gate / Access Point</Label>
              <Input value={editDraft.gate_name} onChange={(e) => setEditDraft({ ...editDraft, gate_name: e.target.value })} className="bg-slate-950 border-slate-700 mt-1" placeholder="e.g. Gate 1 (informational — configurable, never forced)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditDevice(null)} className="text-slate-300">Cancel</Button>
            <Button onClick={saveEdit} disabled={busyId === editDevice?.id} className="bg-sky-500 hover:bg-sky-600">
              {busyId === editDevice?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}