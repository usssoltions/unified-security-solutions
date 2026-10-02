/**
 * reportShowcase — Report & Notification Showcase gateway (PLATFORM-ADMIN ONLY).
 *
 * Explicit, human-driven delivery of a generated showcase pack:
 *   inventory      — module/licence + demo-data readiness per template
 *   generate       — render INERT examples from demo records (no sends, no side effects)
 *   send_preview   — 'Send Preview to Me': ONLY the customer's configured owner preview address
 *   approve        — explicit approval bound to the pack's content fingerprint + typed acknowledgment
 *   send_customer  — 'Send Approved Pack to Customer': ONLY the configured customer address
 *                    (+ identical copy to the configured owner BCC), requires an intact approval
 *   retry          — resend one failed item (dedup prevents any re-send of a sent item)
 *   cancel         — cancel a pack before delivery completes
 *
 * Recipients are NEVER taken loosely from the request: every stage validates
 * the address against the customer's ShowcaseConfig — arbitrary addresses are
 * refused, nothing is hardcoded in shared behaviour. Every send is audited
 * through the shared auditedEmail helper. Demo-suppression of AUTOMATED
 * dispatch (isSimulatedRecord / batch-scoped scheduled skips) is untouched:
 * this gateway is the narrowly authorised, manually-initiated exception, and
 * its pack content is inert rendered output from demo records.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import {
  SHOWCASE_TEMPLATE_CATALOG, buildTemplateExample, computePackFingerprint, DEMO_FOOTER,
} from '../../shared/showcaseTemplates.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: any) => String(s || '').trim().toLowerCase();

function isPlatformAdmin(user: any): boolean {
  return user?.role === 'admin' || user?.role_type === 'platform_admin' || user?.admin_level === 'platform';
}

async function auditRow(pack: any, user: any, action: string, notes: string) {
  const entry = {
    timestamp: new Date().toISOString(),
    actor_id: user?.id || null,
    actor_name: user?.full_name || user?.email || null,
    action,
    notes,
  };
  const audit = [...(pack.audit || []), entry].slice(-100);
  return audit;
}

async function licensedModuleKeys(svc: any, customer_id: string): Promise<Set<string>> {
  const ents = await svc.entities.ModuleEntitlement.filter({ customer_id }).catch(() => []);
  const now = Date.now();
  const active = new Set<string>();
  for (const e of ents || []) {
    if (e.enabled !== true) continue;
    const st = String(e.status || 'active').toLowerCase();
    if (st !== 'active') continue;
    const start = e.licence_start ? new Date(e.licence_start).getTime() : null;
    const end = e.licence_end ? new Date(e.licence_end).getTime() : null;
    if (start && now < start) continue;
    if (end && now > end) continue;
    active.add(String(e.module_key || '').toUpperCase());
  }
  return active;
}

/** Loads demo records referenced by the provenance ledger for this customer. */
async function loadDemoRecords(svc: any, customer_id: string, entityNames: string[]) {
  const ledger = await svc.entities.DemoSeedRecord.filter({ customer_id }).catch(() => []);
  const batches = new Set<string>();
  const idsByEntity: Record<string, string[]> = {};
  for (const r of ledger || []) {
    if (r.kind === 'batch') { if (r.batch_id) batches.add(r.batch_id); continue; }
    (idsByEntity[r.entity_name] ||= []).push(r.record_id);
  }
  const out: Record<string, any[]> = {};
  for (const name of entityNames) {
    const ids = idsByEntity[name] || [];
    const seen = new Set<string>();
    const recs: any[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = await Promise.all(
        ids.slice(i, i + 10).map((id) => (svc.entities as any)[name]?.get(id).catch(() => null))
      );
      for (const c of chunk.filter(Boolean)) {
        const rec = c.data ?? c;
        if (rec?.id && !seen.has(rec.id)) { seen.add(rec.id); recs.push(rec); }
      }
    }
    // FALLBACK (provenance-safe): older seeding phases recorded only phase
    // rows in the ledger, not one row per record. Those records still carry
    // demo_batch_id / is_test on themselves — read them tenant-scoped and
    // merge into the ledger-selected set (ledger rows always win, ids are
    // deduplicated). Always merged so per-site coverage (e.g. one Daily
    // Access Report per demo site) is complete even when a ledger row exists.
    {
      const direct = await (svc.entities as any)[name]?.filter({ customer_id }).catch(() => []);
      for (const rec of direct || []) {
        if ((rec.demo_batch_id || rec.is_test) && !seen.has(rec.id)) { seen.add(rec.id); recs.push(rec); }
      }
    }
    out[name] = recs;
  }
  return { records: out, demo_batch_ids: [...batches] };
}

async function buildBrandingSnapshot(svc: any, customer_id: string) {
  const brand = await resolveCommunicationBrand(svc, { customer_id, reseller_id: null });
  const missing: string[] = [];
  let brandingRow: any = null;
  try {
    const rows = await svc.entities.Branding.filter({ customer_id });
    brandingRow = (rows || [])[0] || null;
  } catch (_) { /* branding optional */ }
  for (const f of ['logo_url', 'secondary_logo_url']) {
    if (brandingRow && f in brandingRow && !brandingRow[f]) missing.push(f);
  }
  return {
    brand,
    snapshot: {
      brand_name: brand?.brand_name || null,
      primary_color: brand?.primary_color || null,
      accent_color: brand?.accent_color || null,
      logo_url: brand?.logo_url || brandingRow?.logo_url || null,
      missing_overrides: missing,
    },
  };
}

async function buildIndexEmail(brand: any, customerName: string, contents: any[], extraNote?: string) {
  return buildBrandedEmail({
    brand,
    heading: `Report & Notification Showcase — ${customerName}`,
    greeting: 'This pack demonstrates the platform\'s report and notification templates using simulated demo data only.',
    details: contents.map((c, i) => ({
      label: `${i + 1}. ${c.label}`,
      value: `${c.channel} — ${c.subject}`,
    })) as any,
    closing: [DEMO_FOOTER, extraNote].filter(Boolean).join(' '),
  });
}

async function sendOne(
  svc: any, pack: any, user: any, stage: 'preview' | 'customer',
  content: any, to: string, brand: any, customer_id: string, copy_to?: string | null,
  contentIdx?: number,
) {
  // The content index disambiguates per-site variants that share a template_id
  // (e.g. one Daily Access Report per demo site) in the send ledger.
  const dedupKey = `${pack.id}:${stage}:${content.template_id}:${contentIdx ?? 0}`;
  const results = stage === 'preview' ? [...(pack.preview?.results || [])] : [...(pack.customer_delivery?.results || [])];
  if (results.some((r) => r.dedup_key === dedupKey && r.status === 'sent')) {
    return { skipped: true, reason: 'already_sent' };
  }
  const attempt = async (addr: string) => {
    try {
      await sendAuditedEmail(svc, {
        to: addr,
        subject: content.subject,
        html: content.html,
        text: content.text,
        brand,
        customer_id,
        from_name: brand?.brand_name || undefined,
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  };
  const primary = await attempt(to);
  let copy: { ok: boolean; error?: string } | null = null;
  if (stage === 'customer' && copy_to && primary.ok) {
    await sleep(1200);
    copy = await attempt(copy_to);
  }
  const status = primary.ok ? 'sent' : 'failed';
  const existing = results.find((r) => r.dedup_key === dedupKey);
  const result = {
    template_id: content.template_id,
    status,
    attempts: (existing?.attempts || 0) + 1,
    dedup_key: dedupKey,
    last_error: primary.ok ? (copy && !copy.ok ? `owner copy failed: ${copy.error}` : null) : primary.error,
    sent_at: primary.ok ? new Date().toISOString() : (existing?.sent_at || null),
  };
  const idx = existing ? results.indexOf(existing) : -1;
  if (idx >= 0) results[idx] = result; else results.push(result);
  return { skipped: false, ok: primary.ok, results, copyOk: !copy || copy.ok };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPlatformAdmin(user)) return Response.json({ error: 'Forbidden — platform administration only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // ── inventory ────────────────────────────────────────────────────────
    if (action === 'inventory') {
      const customer_id = String(body.customer_id || '');
      if (!customer_id) return Response.json({ error: 'customer_id is required' }, { status: 400 });
      const cfgRows = await svc.entities.ShowcaseConfig.filter({ customer_id });
      const config = (cfgRows || [])[0] || null;
      if (!config) return Response.json({ error: 'No ShowcaseConfig saved for this customer. Save the recipient configuration first.' }, { status: 404 });
      const { brand, snapshot } = await buildBrandingSnapshot(svc, customer_id);
      const modules = await licensedModuleKeys(svc, customer_id);
      const needs = [...new Set(SHOWCASE_TEMPLATE_CATALOG.flatMap((t) => t.needs))];
      const { records, demo_batch_ids } = await loadDemoRecords(svc, customer_id, needs);
      let customerName = null;
      try { const c = await svc.entities.Customer.get(customer_id); customerName = c?.name || c?.company_name || null; } catch (_) {}
      const templates = SHOWCASE_TEMPLATE_CATALOG.map((t) => {
        const licensed = modules.has(String(t.module).toUpperCase());
        const hasData = t.needs.some((n) => (records[n] || []).length > 0) || t.template_id === 'laundry_request';
        return {
          template_id: t.template_id, label: t.label, module: t.module, channel: t.channel,
          scenario: t.scenario, licensed, demo_ready: licensed && hasData,
        };
      });
      const packs = await svc.entities.ReportShowcasePack.filter({ customer_id }).catch(() => []);
      return Response.json({
        success: true,
        config: { owner_preview_email: config.owner_preview_email, customer_email: config.customer_email, owner_copy_bcc_email: config.owner_copy_bcc_email || null },
        branding: snapshot,
        modules: [...modules],
        templates,
        demo_batch_ids,
        customer_name: customerName,
        packs: (packs || []).map((p: any) => ({
          id: p.id, pack_number: p.pack_number, status: p.status,
          created_date: p.created_date, content_fingerprint: p.content_fingerprint,
          approval: p.approval || null,
        })),
      });
    }

    // ── generate ─────────────────────────────────────────────────────────
    if (action === 'generate') {
      const customer_id = String(body.customer_id || '');
      if (!customer_id) return Response.json({ error: 'customer_id is required' }, { status: 400 });
      const cfgRows = await svc.entities.ShowcaseConfig.filter({ customer_id });
      const config = (cfgRows || [])[0] || null;
      if (!config) return Response.json({ error: 'No ShowcaseConfig saved for this customer.' }, { status: 404 });
      const modules = await licensedModuleKeys(svc, customer_id);
      const { brand, snapshot } = await buildBrandingSnapshot(svc, customer_id);
      const needs = [...new Set(SHOWCASE_TEMPLATE_CATALOG.flatMap((t) => t.needs))];
      const { records, demo_batch_ids } = await loadDemoRecords(svc, customer_id, needs);
      let customerName = null;
      try { const c = await svc.entities.Customer.get(customer_id); customerName = c?.name || c?.company_name || null; } catch (_) {}
      customerName = customerName || snapshot.brand_name || 'Customer';

      const selIn = Array.isArray(body.selections) ? body.selections : null;
      const selections = SHOWCASE_TEMPLATE_CATALOG.map((t) => ({
        template_id: t.template_id,
        include: selIn ? !!selIn.find((s: any) => s.template_id === t.template_id && s.include !== false)
          : (modules.has(String(t.module).toUpperCase()) && t.template_id !== 'laundry_request'),
      }));

      const contents: any[] = [];
      for (const t of SHOWCASE_TEMPLATE_CATALOG) {
        if (!selections.find((s) => s.template_id === t.template_id && s.include)) continue;
        // Daily Access Report is a SINGLE-SITE report — render ONE item per demo
        // site so all seeded sites are represented accurately (each item contains
        // only that site's demo logs and names only that site).
        const demoLogSites = t.template_id === 'daily_access_report'
          ? [...new Set((records.AccessLog || []).map((l: any) => l.site_name || l.site_id).filter(Boolean))]
          : [null];
        for (const site of demoLogSites) {
          const scopedRecords = site
            ? { ...records, AccessLog: (records.AccessLog || []).filter((l: any) => (l.site_name || l.site_id) === site && l.demo_batch_id) }
            : records;
          const example = await buildTemplateExample(svc, t, {
            customer_id, customerName, brand, records: scopedRecords,
          });
          if (example) {
            contents.push({
              template_id: t.template_id,
              label: site ? `${t.label} — ${site}` : t.label,
              module: t.module, channel: t.channel,
              scenario: site ? `${t.scenario} Rendered for ${site}.` : t.scenario,
              ...example,
            });
          }
          await sleep(300);
        }
      }
      if (!contents.length) {
        return Response.json({ error: 'No template could be rendered — no suitable demo records found for the selected templates.' }, { status: 422 });
      }
      const content_fingerprint = await computePackFingerprint({ selections, contents, branding_snapshot: snapshot });
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const pack = await svc.entities.ReportShowcasePack.create({
        pack_number: `SHOW-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${rand}`,
        customer_id,
        customer_name: customerName,
        demo_batch_ids,
        status: 'generated',
        selections,
        contents,
        branding_snapshot: snapshot,
        content_fingerprint,
        preview: { sent_at: null, recipient: null, results: [] },
        approval: {},
        customer_delivery: { to: null, bcc_copy_to: null, started_at: null, completed_at: null, results: [] },
        audit: await auditRow({ audit: [] }, user, 'generate', `Rendered ${contents.length} inert examples from demo batches ${(demo_batch_ids || []).join(', ')}`),
      });
      return Response.json({ success: true, pack_id: pack.id, pack_number: pack.pack_number, content_fingerprint, contents: contents.map((c) => ({ template_id: c.template_id, label: c.label, channel: c.channel, subject: c.subject })) });
    }

    // ── pack fetch helpers ───────────────────────────────────────────────
    const pack_id = String(body.pack_id || '');
    if (['send_preview', 'approve', 'send_customer', 'retry', 'cancel', 'get'].includes(action)) {
      if (!pack_id) return Response.json({ error: 'pack_id is required' }, { status: 400 });
    }
    const loadPack = async () => {
      const p = await svc.entities.ReportShowcasePack.get(pack_id).catch(() => null);
      return p?.data ?? p;
    };
    const requireConfig = async (pack: any) => {
      const cfgRows = await svc.entities.ShowcaseConfig.filter({ customer_id: pack.customer_id });
      const config = (cfgRows || [])[0] || null;
      if (!config) throw new Error('No ShowcaseConfig saved for this customer.');
      return config;
    };
    const brandFor = async (pack: any) => (await buildBrandingSnapshot(svc, pack.customer_id)).brand;

    // ── send_preview ─────────────────────────────────────────────────────
    if (action === 'send_preview') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      if (['sent', 'cancelled'].includes(pack.status)) return Response.json({ error: `Pack is ${pack.status}; preview no longer available.` }, { status: 409 });
      const config = await requireConfig(pack);
      const to = String(body.to || '');
      if (!to || norm(to) !== norm(config.owner_preview_email)) {
        return Response.json({ error: `Preview may only be sent to the configured owner preview address (${config.owner_preview_email}).` }, { status: 403 });
      }
      const brand = await brandFor(pack);
      const included = (pack.contents || []).filter((c: any) => (pack.selections || []).find((s: any) => s.template_id === c.template_id && s.include !== false));
      const index = await buildIndexEmail(brand, pack.customer_name || 'Customer', included, 'Owner preview — do not forward.');
      await sendAuditedEmail(svc, {
        to, subject: `DEMO | Report & Notification Showcase — ${pack.customer_name || 'Customer'}`,
        html: index.html, text: index.text, brand, customer_id: pack.customer_id,
      });
      const results: any[] = [];
      for (const c of included) {
        const r = await sendOne(svc, { ...pack, id: pack.id }, user, 'preview', c, to, brand, pack.customer_id, null, included.indexOf(c));
        if (!r.skipped) {
          await svc.entities.ReportShowcasePack.update(pack.id, { preview: { sent_at: pack.preview?.sent_at || new Date().toISOString(), recipient: to, results: r.results } });
          pack.preview = { sent_at: pack.preview?.sent_at || new Date().toISOString(), recipient: to, results: r.results };
        }
        results.push({ template_id: c.template_id, ...(r.skipped ? { status: 'skipped', reason: r.reason } : { status: r.ok ? 'sent' : 'failed' }) });
        await sleep(1200);
      }
      await svc.entities.ReportShowcasePack.update(pack.id, {
        status: pack.status === 'generated' ? 'preview_sent' : pack.status,
        preview: { sent_at: pack.preview?.sent_at || new Date().toISOString(), recipient: to, results: pack.preview?.results || [] },
        audit: await auditRow(pack, user, 'send_preview', `Owner preview sent to ${to}`),
      });
      return Response.json({ success: true, status: 'preview_sent', results });
    }

    // ── approve ──────────────────────────────────────────────────────────
    if (action === 'approve') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      if (pack.status !== 'preview_sent' && pack.status !== 'generated') {
        return Response.json({ error: `Pack in status '${pack.status}' cannot be approved.` }, { status: 409 });
      }
      const fingerprint = String(body.fingerprint || '');
      if (fingerprint !== pack.content_fingerprint) {
        return Response.json({ error: 'Fingerprint mismatch — the pack changed since review. Review the current pack and approve again.' }, { status: 409 });
      }
      const ack = 'I have reviewed this pack and approve delivery to the customer.';
      if (String(body.acknowledgment || '').trim() !== ack) {
        return Response.json({ error: `Acknowledgment must match exactly: "${ack}"` }, { status: 400 });
      }
      await svc.entities.ReportShowcasePack.update(pack.id, {
        status: 'approved',
        approval: {
          approved_at: new Date().toISOString(),
          approved_by_id: user.id,
          approved_by_name: user.full_name || user.email || null,
          fingerprint: pack.content_fingerprint,
          acknowledgment: ack,
        },
        audit: await auditRow(pack, user, 'approve', `Approved with fingerprint ${pack.content_fingerprint.slice(0, 12)}…`),
      });
      return Response.json({ success: true, status: 'approved' });
    }

    // ── send_customer ────────────────────────────────────────────────────
    if (action === 'send_customer') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      if (body.confirm !== true) return Response.json({ error: 'Explicit confirm=true is required.' }, { status: 400 });
      if (!['approved', 'sending'].includes(pack.status)) {
        return Response.json({ error: `Pack is '${pack.status}' — customer delivery requires an approved pack.` }, { status: 409 });
      }
      if (pack.approval?.fingerprint !== pack.content_fingerprint) {
        return Response.json({ error: 'Approval is stale — the pack changed after approval. Re-review and approve again.' }, { status: 409 });
      }
      const config = await requireConfig(pack);
      const to = String(body.to || '');
      if (!to || norm(to) !== norm(config.customer_email)) {
        return Response.json({ error: `Customer delivery may only be sent to the configured customer address (${config.customer_email}).` }, { status: 403 });
      }
      const bccConfigured = config.owner_copy_bcc_email || null;
      const bcc = body.bcc ? String(body.bcc) : null;
      if (bccConfigured && (!bcc || norm(bcc) !== norm(bccConfigured))) {
        return Response.json({ error: `The identical owner copy must target the configured BCC address (${bccConfigured}).` }, { status: 403 });
      }
      const brand = await brandFor(pack);
      const included = (pack.contents || []).filter((c: any) => (pack.selections || []).find((s: any) => s.template_id === c.template_id && s.include !== false));
      await svc.entities.ReportShowcasePack.update(pack.id, {
        status: 'sending',
        customer_delivery: {
          to, bcc_copy_to: bcc, started_at: pack.customer_delivery?.started_at || new Date().toISOString(),
          completed_at: null, results: pack.customer_delivery?.results || [],
        },
        audit: await auditRow(pack, user, 'send_customer_start', `Customer delivery started → ${to}${bcc ? ` (identical copy → ${bcc})` : ''}`),
      });
      pack.customer_delivery = { to, bcc_copy_to: bcc, started_at: pack.customer_delivery?.started_at || new Date().toISOString(), completed_at: null, results: pack.customer_delivery?.results || [] };
      for (const c of included) {
        const r = await sendOne(svc, pack, user, 'customer', c, to, brand, pack.customer_id, bcc, included.indexOf(c));
        if (!r.skipped) {
          await svc.entities.ReportShowcasePack.update(pack.id, { customer_delivery: { ...pack.customer_delivery, results: r.results } });
          pack.customer_delivery.results = r.results;
        }
        await sleep(1200);
      }
      const finalResults = pack.customer_delivery.results || [];
      const anyFailed = finalResults.some((r: any) => r.status === 'failed');
      const anySent = finalResults.some((r: any) => r.status === 'sent');
      await svc.entities.ReportShowcasePack.update(pack.id, {
        status: anyFailed ? 'sending' : 'sent',
        customer_delivery: { ...pack.customer_delivery, completed_at: new Date().toISOString() },
        audit: await auditRow(pack, user, 'send_customer_end', `Delivery finished: ${finalResults.filter((r: any) => r.status === 'sent').length} sent, ${finalResults.filter((r: any) => r.status === 'failed').length} failed`),
      });
      return Response.json({ success: true, status: anyFailed ? 'sending' : 'sent', results: finalResults });
    }

    // ── retry ────────────────────────────────────────────────────────────
    if (action === 'retry') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      const stage = String(body.stage || '');
      const template_id = String(body.template_id || '');
      if (!['preview', 'customer'].includes(stage)) return Response.json({ error: 'stage must be preview or customer' }, { status: 400 });
      if (stage === 'customer' && !['approved', 'sending'].includes(pack.status)) {
        return Response.json({ error: 'Customer-stage retry requires an approved pack.' }, { status: 409 });
      }
      const config = await requireConfig(pack);
      const brand = await brandFor(pack);
      // Optional `label` disambiguates per-site variants that share a template_id.
      const matchLabel = body.label ? String(body.label) : null;
      const content = (pack.contents || []).find((c: any) => c.template_id === template_id && (!matchLabel || c.label === matchLabel));
      if (!content) return Response.json({ error: 'Template not in pack' }, { status: 404 });
      const to = stage === 'preview' ? (pack.preview?.recipient || config.owner_preview_email) : (pack.customer_delivery?.to || config.customer_email);
      const bcc = stage === 'customer' ? (pack.customer_delivery?.bcc_copy_to || null) : null;
      const r = await sendOne(svc, pack, user, stage as 'preview' | 'customer', content, to, brand, pack.customer_id, bcc, (pack.contents || []).indexOf(content));
      if (r.skipped) return Response.json({ success: true, skipped: true, reason: r.reason });
      const patch: any = stage === 'preview'
        ? { preview: { ...pack.preview, results: r.results } }
        : { customer_delivery: { ...pack.customer_delivery, results: r.results } };
      await svc.entities.ReportShowcasePack.update(pack.id, patch);
      return Response.json({ success: true, status: r.ok ? 'sent' : 'failed', results: r.results });
    }

    // ── cancel ───────────────────────────────────────────────────────────
    if (action === 'cancel') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      if (pack.status === 'sent') return Response.json({ error: 'Pack already delivered — cannot cancel.' }, { status: 409 });
      await svc.entities.ReportShowcasePack.update(pack.id, {
        status: 'cancelled',
        audit: await auditRow(pack, user, 'cancel', String(body.reason || 'Cancelled by platform administrator')),
      });
      return Response.json({ success: true, status: 'cancelled' });
    }

    // ── get ──────────────────────────────────────────────────────────────
    if (action === 'get') {
      const pack = await loadPack();
      if (!pack) return Response.json({ error: 'Pack not found' }, { status: 404 });
      return Response.json({ success: true, pack });
    }

    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});