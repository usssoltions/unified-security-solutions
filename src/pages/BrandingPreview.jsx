import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldCheck, Send, Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * BrandingPreview — administrator preview of the representative
 * transactional emails (incident alert, missed Stay Awake check, scheduled
 * report, maintenance request, estate notification, medical notification)
 * rendered through the central transactional renderer with the tenant's
 * authoritative resolved brand, in desktop (600px) and narrow-mobile (375px)
 * widths, with branding validation (logo, WCAG AA contrast, support contact
 * formats) and an optional guarded test delivery.
 */
const EVENT_LABELS = {
  incident_alert: "Incident Alert",
  missed_stay_awake_check: "Missed Stay Awake Check",
  scheduled_report: "Scheduled Report",
  maintenance_request: "Maintenance Request",
  estate_notification: "Estate Notification",
  medical_notification: "Medical Notification",
};

const ADMIN_ROLES = ["admin", "platform_admin", "customer_admin", "reseller_admin", "practice_admin", "estate_manager"];

function ValidityRow({ ok, label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800 last:border-0">
      <span className="text-sm text-slate-300">{label}</span>
      <span className="flex items-center gap-2">
        {value && <span className="text-sm text-slate-400 max-w-[220px] truncate">{value}</span>}
        {ok === true && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
        {ok === false && <XCircle className="w-4 h-4 text-rose-400" />}
        {ok === null && <span className="text-xs text-slate-500">not set</span>}
      </span>
    </div>
  );
}

export default function BrandingPreview() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResults, setSendResults] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
        if (me && (me.role === "admin" || me.role_type === "platform_admin" || me.admin_level === "platform")) {
          const list = await base44.entities.Customer.list();
          setCustomers(list || []);
        } else if (me && me.customer_id) {
          setCustomerId(me.customer_id);
        }
      } catch (_) {}
      setLoading(false);
    })();
  }, []);

  const runPreview = async (send = false) => {
    send ? setSending(true) : setBusy(true);
    try {
      const res = await base44.functions.invoke("brandingDeliverySelfTest", {
        customer_id: customerId || undefined,
        send,
      });
      const data = res?.data ?? res;
      if (send) setSendResults(data?.sends || []);
      else setPreview(data);
    } catch (e) {
      setPreview({ error: e?.response?.data?.error || String(e?.message || e) });
    }
    send ? setSending(false) : setBusy(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user || !ADMIN_ROLES.includes(user.role_type) && user.role !== "admin" && user.admin_level !== "platform") {
    return (
      <div className="max-w-lg mx-auto mt-10 p-6 rounded-xl bg-slate-900 border border-slate-700 text-center">
        <ShieldCheck className="w-8 h-8 text-amber-400 mx-auto mb-3" />
        <p className="text-slate-300 text-sm">Branding preview is available to administrators only.</p>
      </div>
    );
  }

  const v = preview?.validations;

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Email Branding Preview</h1>
          <p className="text-sm text-slate-400">
            Representative transactional emails rendered with the tenant&apos;s authoritative resolved brand.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {customers.length > 0 && (
            <Select value={customerId || "platform"} onValueChange={(val) => setCustomerId(val === "platform" ? "" : val)}>
              <SelectTrigger className="w-[200px] bg-slate-900 border-slate-700 text-slate-200">
                <SelectValue placeholder="Brand context" />
              </SelectTrigger>
              <SelectContent className="bg-slate-900 border-slate-700">
                <SelectItem value="platform">Platform (unscoped)</SelectItem>
                {customers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={() => runPreview(false)} disabled={busy} className="active:scale-95">
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Render Preview
          </Button>
          <Button variant="outline" onClick={() => runPreview(true)} disabled={sending} className="active:scale-95">
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send Test Emails
          </Button>
        </div>
      </div>

      {preview?.error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
          {preview.error}
        </div>
      )}

      {sendResults && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Guarded Test Delivery</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Mode: {preview?.delivery_mode || "—"} — every intended recipient is rewritten server-side to the
              allowlisted test mailbox with a &quot;[TEST]&quot; subject prefix. Nothing can reach a real customer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {sendResults.map((s) => (
              <div key={s.template} className="flex items-center justify-between gap-2 text-xs border-b border-slate-800 pb-1.5 last:border-0">
                <span className="text-slate-300">{EVENT_LABELS[s.template] || s.template}</span>
                <span className="text-slate-500 truncate max-w-[160px]">{s.intended_recipient}</span>
                <span className="text-slate-600">→</span>
                <span className="text-emerald-400 font-medium truncate max-w-[200px]">{s.effective_recipient}</span>
                {s.ok ? <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">sent</Badge>
                  : <Badge variant="destructive">{s.reason || "blocked"}</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {v && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">Resolved Brand &amp; Validation</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Branding source: {v.branding_source} — the same resolved brand is used for sender, logo, header,
              accent, buttons, footer and contact details in every template below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-x-8">
              <div>
                <ValidityRow ok={!!v.brand_name} label="Brand name" value={v.brand_name} />
                <ValidityRow ok={v.logo_valid_for_email} label="Logo (valid email image)" value={v.logo_url || "text-only header"} />
                <ValidityRow ok={v.support_email_valid} label="Support email" value={v.support_email} />
                <ValidityRow ok={v.support_phone_valid} label="Support telephone" value={v.support_phone} />
                <ValidityRow ok={v.website_valid} label="Website" value={v.website} />
              </div>
              <div>
                <ValidityRow
                  ok={v.contrast?.passes_AA}
                  label={`Button contrast (WCAG AA ≥ 4.5:1)`}
                  value={`${v.contrast?.button_vs_white_text}:1`}
                />
                <ValidityRow ok={true} label="Brand primary" value={v.contrast?.primary} />
                <ValidityRow ok={true} label="AA-adjusted button colour" value={v.contrast?.button} />
                <ValidityRow ok={true} label="Missing-logo behaviour" value="Professional text-only header" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {(preview?.templates || []).map((t) => (
        <Card key={t.key} className="bg-slate-900 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-base">{EVENT_LABELS[t.key] || t.key}</CardTitle>
            <CardDescription className="text-slate-400 text-xs">{t.subject}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid lg:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Desktop (600px)</p>
                <iframe
                  title={`${t.key} desktop`}
                  srcDoc={t.html}
                  className="w-full h-[520px] rounded-lg border border-slate-700 bg-white"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Narrow mobile (375px)</p>
                <div className="mx-auto" style={{ width: 375, maxWidth: "100%" }}>
                  <iframe
                    title={`${t.key} mobile`}
                    srcDoc={t.html}
                    className="w-full h-[520px] rounded-lg border border-slate-700 bg-white"
                  />
                </div>
              </div>
            </div>
            <details className="text-xs text-slate-400">
              <summary className="cursor-pointer text-slate-500">Plain-text alternative</summary>
              <pre className="mt-2 p-3 rounded-lg bg-slate-950 border border-slate-800 whitespace-pre-wrap text-slate-300">{t.text}</pre>
            </details>
          </CardContent>
        </Card>
      ))}

      {preview && !preview.templates && !preview.error && (
        <p className="text-slate-400 text-sm">Press “Render Preview” to generate the representative emails.</p>
      )}
    </div>
  );
}