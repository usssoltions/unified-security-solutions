import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, ShieldCheck, Send, RotateCcw, X, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

const ACK_TEXT = "I have reviewed this pack and approve delivery to the customer.";

export default function ReportShowcase() {
  const [user, setUser] = useState(null);
  const [configs, setConfigs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [inv, setInv] = useState(null);
  const [pack, setPack] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [previewTpl, setPreviewTpl] = useState(null);
  const [ack, setAck] = useState("");
  const [confirmCust, setConfirmCust] = useState(false);
  const [confirmPreview, setConfirmPreview] = useState(false);

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  // Configuration lookup goes through the reportShowcase gateway (platform-admin
  // gated server-side) — the direct ShowcaseConfig client read is RLS-restricted
  // and resolved empty for this session.
  useEffect(() => {
    call({ action: "list_configs" }).then((data) => {
      const rows = data?.configs || [];
      setConfigs(rows);
      if (rows.length) setSelected(rows[0]);
    }).catch((e) => setErr(String(e?.message || e)));
  }, []);

  const call = useCallback(async (payload) => {
    const res = await base44.functions.invoke("reportShowcase", payload);
    return res?.data || res;
  }, []);

  const runInventory = async (cfg = selected) => {
    if (!cfg) return;
    setBusy("inventory"); setErr(null); setMsg(null); setPack(null);
    try {
      const data = await call({ action: "inventory", customer_id: cfg.customer_id });
      setInv(data);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  // Load an EXISTING pack (e.g. SHOW-20261002-SHBI) through the gateway's get
  // action — no regeneration, the stored contents are reused as-is.
  const loadPack = async (pack_id) => {
    setBusy("load"); setErr(null); setMsg(null);
    try {
      const full = await call({ action: "get", pack_id });
      setPack(full.pack);
      setMsg(`Loaded existing pack ${full.pack?.pack_number}.`);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const generate = async () => {
    if (!inv) return;
    setBusy("generate"); setErr(null); setMsg(null);
    try {
      const selections = (inv.templates || []).map((t) => ({ template_id: t.template_id, include: t.demo_ready }));
      const data = await call({ action: "generate", customer_id: selected.customer_id, selections });
      const full = await call({ action: "get", pack_id: data.pack_id });
      setPack(full.pack);
      setMsg(`Pack ${data.pack_number} generated — review the contents below.`);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const sendPreview = async () => {
    if (!pack) return;
    setBusy("preview"); setErr(null); setMsg(null);
    try {
      const data = await call({ action: "send_preview", pack_id: pack.id, to: inv?.config?.owner_preview_email });
      const full = await call({ action: "get", pack_id: pack.id });
      setPack(full.pack);
      setMsg(`Owner preview dispatched to ${inv?.config?.owner_preview_email}.`);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const approve = async () => {
    if (!pack) return;
    setBusy("approve"); setErr(null); setMsg(null);
    try {
      await call({ action: "approve", pack_id: pack.id, fingerprint: pack.content_fingerprint, acknowledgment: ack });
      const full = await call({ action: "get", pack_id: pack.id });
      setPack(full.pack);
      setMsg("Pack approved. You can now dispatch it to the customer.");
      setAck("");
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const sendCustomer = async () => {
    if (!pack) return;
    setBusy("customer"); setErr(null); setMsg(null);
    try {
      const data = await call({ action: "send_customer", pack_id: pack.id, to: inv?.config?.customer_email, bcc: inv?.config?.owner_copy_bcc_email || null, confirm: true });
      const full = await call({ action: "get", pack_id: pack.id });
      setPack(full.pack);
      setMsg(data.status === "sent" ? "Customer delivery completed." : "Delivery finished with failures — retry the failed items below.");
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const retryItem = async (stage, template_id) => {
    setBusy(`retry-${template_id}`); setErr(null);
    try {
      await call({ action: "retry", pack_id: pack.id, stage, template_id });
      const full = await call({ action: "get", pack_id: pack.id });
      setPack(full.pack);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  const cancelPack = async () => {
    setBusy("cancel"); setErr(null);
    try {
      await call({ action: "cancel", pack_id: pack.id, reason: "Cancelled by platform administrator" });
      const full = await call({ action: "get", pack_id: pack.id });
      setPack(full.pack);
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(""); }
  };

  if (user && !isPlatformAdminUser(user)) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="pt-6 text-center">
            <ShieldCheck className="w-10 h-10 text-slate-500 mx-auto mb-3" />
            <p className="text-slate-300 text-sm">Platform administration only.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const resultsOf = (stage) =>
    stage === "preview" ? (pack?.preview?.results || []) : (pack?.customer_delivery?.results || []);

  const ResultsTable = ({ stage, title }) => {
    const rows = resultsOf(stage);
    if (!rows.length) return null;
    return (
      <div className="mt-3 rounded-xl border border-slate-700 overflow-hidden">
        <div className="px-3 py-2 bg-slate-800/60 text-xs font-semibold text-slate-300">{title}</div>
        {rows.map((r) => (
          <div key={r.dedup_key || r.template_id} className="flex items-center justify-between px-3 py-2 border-t border-slate-700/60 text-xs">
            <span className="text-slate-300 truncate mr-2">{(inv?.templates || []).find((t) => t.template_id === r.template_id)?.label || r.template_id}</span>
            <span className="flex items-center gap-2 shrink-0">
              <Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "secondary"}
                className={r.status === "sent" ? "bg-emerald-600" : ""}>{r.status}{r.attempts > 1 ? ` ×${r.attempts}` : ""}</Badge>
              {r.status === "failed" && (
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy === `retry-${r.template_id}`} onClick={() => retryItem(stage, r.template_id)}>
                  <RotateCcw className="w-3 h-3 mr-1" /> Retry
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Report &amp; Notification Showcase</h1>
        <p className="text-xs text-slate-400 mt-1">
          Renders example reports and notifications from this customer's demo data using the platform's real templates — inert: nothing operational is triggered, and dispatch is only ever manual.
        </p>
      </div>

      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {err}
        </div>
      )}
      {msg && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {msg}
        </div>
      )}

      {!configs.length && !err && (
        <Card className="bg-slate-900 border-slate-700"><CardContent className="pt-6 text-sm text-slate-300">
          No customer showcase configuration saved yet. Create a ShowcaseConfig for the customer first.
        </CardContent></Card>
      )}

      {configs.length > 0 && (
        <>
          <Card className="bg-slate-900 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-white">Customer</CardTitle>
              <CardDescription className="text-xs">Recipient configuration is saved per customer and validated on every send.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selected?.customer_id || ""} onValueChange={(v) => { setSelected(configs.find((c) => c.customer_id === v)); setInv(null); setPack(null); }}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white"><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>
                  {configs.map((c) => <SelectItem key={c.customer_id} value={c.customer_id}>{c.customer_name || c.customer_id}</SelectItem>)}
                </SelectContent>
              </Select>
              {selected && (
                <div className="text-xs text-slate-400 space-y-0.5">
                  <p>Owner preview: <span className="text-slate-200">{selected.owner_preview_email}</span></p>
                  <p>Customer delivery: <span className="text-slate-200">{selected.customer_email}</span>{selected.owner_copy_bcc_email && <> · identical copy to <span className="text-slate-200">{selected.owner_copy_bcc_email}</span></>}</p>
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => runInventory()} disabled={!selected || busy === "inventory"}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${busy === "inventory" ? "animate-spin" : ""}`} /> Run Inventory
                </Button>
                {inv && (
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-200" onClick={generate} disabled={busy === "generate"}>
                    <Mail className="w-4 h-4 mr-1" /> Generate Pack
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {inv && (
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-white">Template Inventory</CardTitle>
                <CardDescription className="text-xs">
                  Branding: {inv.branding?.brand_name || "—"} · {(inv.templates || []).filter((t) => t.demo_ready).length} of {(inv.templates || []).length} templates ready
                  {inv.branding?.missing_overrides?.length > 0 && <> · <span className="text-amber-400">missing overrides: {inv.branding.missing_overrides.join(", ")}</span></>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(inv.templates || []).map((t) => (
                  <div key={t.template_id} className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{t.label}</p>
                      <p className="text-[11px] text-slate-400">{t.scenario}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px] text-slate-300 border-slate-600">{t.module}</Badge>
                      <Badge variant={t.demo_ready ? "default" : "secondary"} className={`text-[10px] ${t.demo_ready ? "bg-emerald-600" : ""}`}>
                        {t.demo_ready ? "Ready" : t.licensed ? "No demo data" : "Not licensed"}
                      </Badge>
                    </div>
                  </div>
                ))}
                {(inv.packs || []).filter((p) => p.status !== "cancelled").length > 0 && (
                  <div className="pt-1 space-y-1">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Existing packs</p>
                    {(inv.packs || []).filter((p) => p.status !== "cancelled").map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{p.pack_number}</p>
                          <p className="text-[11px] text-slate-400">{String(p.created_date || "").slice(0, 16).replace("T", " ")}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge className="bg-sky-600 text-[10px]">{p.status}</Badge>
                          <Button size="sm" variant="outline" className="border-slate-600 text-slate-200 h-7 px-2" disabled={busy === "load"} onClick={() => loadPack(p.id)}>
                            Load
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {pack && pack.status !== "cancelled" && (
            <>
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-white flex items-center justify-between">
                    <span>Pack {pack.pack_number}</span>
                    <Badge className="bg-sky-600">{pack.status}</Badge>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Fingerprint {String(pack.content_fingerprint || "").slice(0, 12)}… — approval and delivery are bound to it. Every item below carries the DEMONSTRATION — NO ACTION REQUIRED label.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(pack.contents || []).map((c, ci) => (
                    <div key={`${c.template_id}-${ci}`} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white truncate">{c.label}</p>
                        <p className="text-[11px] text-slate-400 truncate">{c.subject}</p>
                        {(c.attachments || []).length > 0 ? (
                          <p className="text-[10px] text-emerald-400/80 truncate mt-0.5">
                            Attached: {(c.attachments || []).map((a) => a.filename).join(", ")}
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">No report attachment for this item</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Badge variant="outline" className="text-[10px] text-slate-300 border-slate-600">{c.channel}</Badge>
                        <Button size="sm" variant="outline" className="h-7 px-2 border-slate-600 text-slate-200" onClick={() => setPreviewTpl(c)}>View</Button>
                      </div>
                    </div>
                  ))}
                  <ResultsTable stage="preview" title="Owner preview delivery" />
                  <ResultsTable stage="customer" title="Customer delivery" />

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!["preview_sent", "approved", "sending", "sent"].includes(pack.status) && (
                      <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={busy === "preview" || !confirmPreview} onClick={sendPreview}>
                        <Send className="w-4 h-4 mr-1" /> Send Preview to Me
                      </Button>
                    )}
                    {pack.status === "preview_sent" && (
                      <Button size="sm" variant="outline" className="border-slate-600 text-slate-200" disabled={busy === "preview"} onClick={sendPreview}>
                        <RotateCcw className="w-4 h-4 mr-1" /> Re-send Preview
                      </Button>
                    )}
                    {["preview_sent", "approved"].includes(pack.status) && (
                      <Button size="sm" variant="outline" className="border-rose-500/40 text-rose-300" disabled={busy === "cancel"} onClick={cancelPack}>
                        <X className="w-4 h-4 mr-1" /> Cancel Pack
                      </Button>
                    )}
                  </div>
                  {!["preview_sent", "approved", "sending", "sent"].includes(pack.status) && (
                    <label className="flex items-start gap-2 text-[11px] text-slate-400 pt-1">
                      <Checkbox checked={confirmPreview} onCheckedChange={(v) => setConfirmPreview(!!v)} className="mt-0.5" />
                      Confirm the preview goes only to {inv?.config?.owner_preview_email}.
                    </label>
                  )}
                </CardContent>
              </Card>

              {pack.status === "preview_sent" && (
                <Card className="bg-slate-900 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">Approve Customer Delivery</CardTitle>
                    <CardDescription className="text-xs">
                      Type the acknowledgment exactly. Approval is bound to fingerprint {String(pack.content_fingerprint || "").slice(0, 12)}… — regenerating the pack invalidates it.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-300">Acknowledgment</Label>
                      <Input value={ack} onChange={(e) => setAck(e.target.value)} placeholder={ACK_TEXT} className="bg-slate-800 border-slate-700 text-white text-xs" />
                    </div>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy === "approve" || ack.trim() !== ACK_TEXT} onClick={approve}>
                      <ShieldCheck className="w-4 h-4 mr-1" /> Approve Pack
                    </Button>
                  </CardContent>
                </Card>
              )}

              {["approved", "sending"].includes(pack.status) && pack.status === "approved" && (
                <Card className="bg-slate-900 border-slate-700">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-white">Send Approved Pack to Customer</CardTitle>
                    <CardDescription className="text-xs">
                      Goes only to {inv?.config?.customer_email}{inv?.config?.owner_copy_bcc_email && <> with an identical copy to {inv?.config?.owner_copy_bcc_email}</>}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="flex items-start gap-2 text-[11px] text-slate-400">
                      <Checkbox checked={confirmCust} onCheckedChange={(v) => setConfirmCust(!!v)} className="mt-0.5" />
                      I confirm recipient checks and authorise dispatch of this approved pack to the configured customer address.
                    </label>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy === "customer" || !confirmCust} onClick={sendCustomer}>
                      <Send className="w-4 h-4 mr-1" /> Send Approved Pack to Customer
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <Dialog open={!!previewTpl} onOpenChange={(o) => !o && setPreviewTpl(null)}>
        <DialogContent className="max-w-2xl bg-slate-900 border-slate-700 max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="text-white text-sm">{previewTpl?.label}</DialogTitle>
            <DialogDescription className="text-xs">{previewTpl?.subject}</DialogDescription>
          </DialogHeader>
          <iframe title="Template preview" srcDoc={previewTpl?.html || ""} sandbox="" className="w-full h-[55vh] rounded-lg bg-white" />
        </DialogContent>
      </Dialog>
    </div>
  );
}