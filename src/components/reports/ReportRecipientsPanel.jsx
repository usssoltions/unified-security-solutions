import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Mail, Plus, Loader2, RefreshCw, PowerOff, Power, Trash2, Send, Users } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

/**
 * ReportRecipientsPanel — management UI for the ONE tenant-scoped
 * report-recipient system (ExternalRecipient via the reportRecipientAccess
 * gateway). External client representatives WITHOUT an app account receive
 * scheduled reports; authorised internal users can be linked. Every action
 * is scoped to the caller's own tenant server-side.
 *
 * Also provides the authorised "Send Test Report" action (marked TEST, tenant
 * scoped, audited, never affects the scheduled-send state).
 */
export default function ReportRecipientsPanel({ customerId, sites = [], customerName }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [recipients, setRecipients] = useState([]);
  const [internalUsers, setInternalUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [testing, setTesting] = useState(false);
  const [form, setForm] = useState({ id: null, name: "", email: "", site_id: "all", user_id: "none", recipient_type: "client_representative", daily_access_enabled: true, active: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("reportRecipientAccess", { action: "list", customer_id: customerId });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      setRecipients(d.recipients || []);
      setInternalUsers(d.internal_users || []);
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed to load report recipients", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm({ id: null, name: "", email: "", site_id: "all", user_id: "none", recipient_type: "client_representative", daily_access_enabled: true, active: true });
    setShowForm(true);
  };

  const openEdit = (r) => {
    setForm({
      id: r.id, name: r.name || "", email: r.email || "",
      site_id: r.site_id || "all", user_id: r.user_id || "none",
      recipient_type: r.recipient_type || "client_representative",
      daily_access_enabled: !!r.daily_access_enabled, active: !!r.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast({ title: "Recipient Name required", variant: "destructive" }); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { toast({ title: "Valid email required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("reportRecipientAccess", {
        action: "save", customer_id: customerId,
        id: form.id || undefined,
        name: form.name.trim(),
        email: form.email.trim(),
        site_id: form.site_id === "all" ? null : form.site_id,
        user_id: form.user_id === "none" ? null : form.user_id,
        recipient_type: form.recipient_type,
        daily_access_enabled: form.daily_access_enabled,
        active: form.active,
      });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: form.id ? "Recipient updated" : "Recipient added" });
      setShowForm(false);
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const set_active = async (r, active) => {
    setBusyId(r.id);
    try {
      const res = await base44.functions.invoke("reportRecipientAccess", { action: "set_active", customer_id: customerId, id: r.id, active });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: active ? "Recipient reactivated" : "Recipient deactivated", description: `${r.name} (${r.email})` });
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Remove report recipient "${r.name}" (${r.email})?`)) return;
    setBusyId(r.id);
    try {
      const res = await base44.functions.invoke("reportRecipientAccess", { action: "delete", customer_id: customerId, id: r.id });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({ title: "Recipient removed" });
      load();
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const sendTest = async (siteId) => {
    if (!siteId) { toast({ title: "Select a site for the test report", variant: "destructive" }); return; }
    setTesting(true);
    try {
      const res = await base44.functions.invoke("generateDailyAccessReport", { action: "send_test", site_id: siteId });
      const d = res?.data || res;
      if (!d?.success) throw new Error(d?.error || "Failed");
      toast({
        title: "Test report sent",
        description: d.delivery_ok
          ? `TEST Daily Access Control Report sent to ${d.sent_to} for period ${d.reporting_period}.`
          : `The TEST report was generated but delivery was skipped (${d.delivery_note || 'delivery guard'}). The report generation itself was verified.`,
      });
    } catch (e) {
      const dd = e?.response?.data || e?.data;
      toast({ title: "Test report failed", description: dd?.error || e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="bg-slate-900/60 border-slate-700/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-white text-base flex items-center gap-2">
          <Mail className="w-4 h-4 text-emerald-400" /> Daily Access Report Recipients
        </CardTitle>
        <p className="text-xs text-slate-500">
          External client representatives receive the daily 17:00 report without needing an app account. Authorised internal users can also be selected.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Button onClick={openCreate} size="sm" className="bg-emerald-500 hover:bg-emerald-600">
            <Plus className="w-4 h-4 mr-1" /> Add Recipient
          </Button>
          <Button onClick={load} size="sm" variant="outline" className="border-slate-600 text-slate-200">
            <RefreshCw className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </div>

        {sites.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 bg-slate-950/40 border border-slate-700/30 rounded-lg p-3">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-slate-300 text-xs">Send Test Report (marked TEST, audited)</Label>
              <Select onValueChange={(v) => sendTest(v)}>
                <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1">
                  <SelectValue placeholder={testing ? "Sending…" : "Choose a site"} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {testing && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-6 text-slate-400">
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading recipients…
          </div>
        ) : recipients.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-4">
            No report recipients configured yet. Add client representatives to receive the scheduled Daily Access Control Report.
          </p>
        ) : (
          <div className="space-y-2">
            {recipients.map((r) => (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-800/40 p-3 rounded-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-white text-sm font-medium truncate">{r.name}</p>
                    <Badge className={r.active ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-slate-500/15 text-slate-400 border border-slate-500/30"}>
                      {r.active ? "Active" : "Inactive"}
                    </Badge>
                    {r.daily_access_enabled ? (
                      <Badge className="bg-sky-500/15 text-sky-400 border border-sky-500/30">Daily Access Report</Badge>
                    ) : (
                      <Badge variant="outline" className="border-slate-600 text-slate-400">No Daily Report</Badge>
                    )}
                    {r.user_id && <Badge variant="outline" className="border-indigo-500/40 text-indigo-300"><Users className="w-3 h-3 mr-1" />Internal User</Badge>}
                  </div>
                  <p className="text-slate-500 text-xs truncate">
                    {r.email} · {r.site_id ? (sites.find(s => s.id === r.site_id)?.name || "Scoped site") : "All authorised sites"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)} className="border-slate-600 text-slate-200 h-9">Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => set_active(r, !r.active)} disabled={busyId === r.id} className="border-slate-600 text-slate-200 h-9">
                    {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : r.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r)} disabled={busyId === r.id} className="h-9">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">{form.id ? "Edit Report Recipient" : "Add Report Recipient"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-slate-300 text-xs">Recipient Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-slate-950 border-slate-700 text-white mt-1" placeholder="e.g. Estate Manager / Security Office" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Email Address *</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="bg-slate-950 border-slate-700 text-white mt-1" placeholder="reports@client.co.za" />
              <p className="text-slate-500 text-xs mt-1">No app account required — reports are delivered to this address.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-slate-300 text-xs">Site</Label>
                <Select value={form.site_id} onValueChange={(v) => setForm({ ...form, site_id: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All authorised sites</SelectItem>
                    {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-slate-300 text-xs">Recipient Type</Label>
                <Select value={form.recipient_type} onValueChange={(v) => setForm({ ...form, recipient_type: v })}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="client_representative">Client Representative</SelectItem>
                    <SelectItem value="trustee">Trustee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {internalUsers.length > 0 && (
              <div>
                <Label className="text-slate-300 text-xs">Internal User (optional)</Label>
                <Select value={form.user_id} onValueChange={(v) => {
                  const u = internalUsers.find(x => x.id === v);
                  setForm({ ...form, user_id: v, name: v === "none" ? form.name : (u?.name || form.name), email: v === "none" ? form.email : (u?.email || form.email) });
                }}>
                  <SelectTrigger className="bg-slate-950 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (external recipient)</SelectItem>
                    {internalUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.name} ({u.role_type})</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-slate-500 text-xs mt-1">Selecting an internal user fills their email; duplicate addresses are deduplicated at send time (one copy).</p>
              </div>
            )}
            <div className="flex items-center justify-between bg-slate-950/40 border border-slate-700/30 rounded-lg p-3">
              <div>
                <p className="text-sm text-white">Daily Access Report Enabled</p>
                <p className="text-xs text-slate-500">Receive the automatic 17:00 Daily Access Control Report.</p>
              </div>
              <Button size="sm" variant={form.daily_access_enabled ? "default" : "outline"}
                onClick={() => setForm({ ...form, daily_access_enabled: !form.daily_access_enabled })}
                className={form.daily_access_enabled ? "bg-emerald-500 hover:bg-emerald-600" : "border-slate-600 text-slate-300"}>
                {form.daily_access_enabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
            <div className="flex items-center justify-between bg-slate-950/40 border border-slate-700/30 rounded-lg p-3">
              <div>
                <p className="text-sm text-white">Status</p>
                <p className="text-xs text-slate-500">Inactive recipients receive no reports.</p>
              </div>
              <Button size="sm" variant={form.active ? "default" : "outline"}
                onClick={() => setForm({ ...form, active: !form.active })}
                className={form.active ? "bg-emerald-500 hover:bg-emerald-600" : "border-slate-600 text-slate-300"}>
                {form.active ? "Active" : "Inactive"}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-600 text-slate-300">Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-emerald-500 hover:bg-emerald-600">
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />} {form.id ? "Save Changes" : "Add Recipient"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}