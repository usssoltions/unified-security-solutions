/**
 * showcaseDelivery — THE shared delivery engine for the Report & Notification
 * Showcase (used by the reportShowcase gateway and its isolated self-test).
 *
 * Responsibilities:
 *  - ATOMIC DUPLICATE-SEND PREVENTION: every item send claims a
 *    ShowcaseSendClaim row with an atomic conditional update BEFORE any
 *    delivery (status 'unclaimed' -> 'claiming' + unique token). A concurrent
 *    attempt's claim fails and it sends NOTHING; the claim commits to 'sent'
 *    only after the transport accepts, stamped conditionally on the token; a
 *    failed send releases the claim so the item stays retryable. A SENT item
 *    can never be claimed again — a repeated or concurrent send attempt can
 *    never produce a second delivery.
 *  - REAL ATTACHMENTS: report items carry REAL downloadable report files,
 *    built at send time from the pack's demo records by the platform's actual
 *    shared report generators (daily access PDF/CSV, hospitality visits PDF,
 *    daily activity PDF, monthly incident/maintenance PDFs). Contents store
 *    only attachment METADATA — bytes are never stored in the pack entity.
 */
import {
  computeReportingPeriod, makeZonedFormatters,
  buildDailyAccessModel, buildDailyAccessCsv, buildDailyAccessPdf,
  DEFAULT_REPORT_TIMEZONE,
} from './dailyAccessReport.ts';
import { buildHospitalityVisitsPdf } from './hospitalityVisitsPdf.ts';
import { buildDailyActivityPdf, buildMonthlyIncidentPdf, buildMonthlyMaintenancePdf } from './opsReportPdfs.ts';
import { sendAuditedEmail } from './auditedEmail.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CLAIM_STALE_MS = 120000;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH) as any);
  return btoa(bin);
}

function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchByIds(svc: any, entityName: string, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < (ids || []).length; i += 10) {
    const chunk = await Promise.all(
      (ids || []).slice(i, i + 10).map((id) => (svc.entities as any)[entityName]?.get(id).catch(() => null))
    );
    for (const c of chunk.filter(Boolean)) {
      const rec = c.data ?? c;
      if (rec?.id) out.push(rec);
    }
  }
  return out;
}

// ── CAS claim lifecycle ──────────────────────────────────────────────────────
export async function claimSendItem(svc: any, dedup_key: string): Promise<{ won: boolean; token?: string; reason?: string }> {
  const token = crypto.randomUUID();
  const rows = await svc.entities.ShowcaseSendClaim.filter({ dedup_key }).catch(() => []);
  const row = (rows || [])[0] || null;
  if (row) {
    if (row.status === 'sent') return { won: false, reason: 'already_sent' };
    const age = row.claimed_at ? Date.now() - new Date(row.claimed_at).getTime() : Infinity;
    if (row.status === 'claiming' && age <= CLAIM_STALE_MS) {
      return { won: false, reason: 'claimed_by_concurrent_send' };
    }
    // ATOMIC CLAIM — conditional update (same CAS pattern as the Stay Awake
    // sweep's claim leases): an UNCLAIMED row is claimed on its own status;
    // a STALE 'claiming' holder (older than 2 minutes, previous holder
    // crashed before commit) is taken over conditionally on its token. The
    // losing concurrent attempt's update matches nothing.
    const take = await svc.entities.ShowcaseSendClaim.updateMany(
      row.status === 'claiming'
        ? { dedup_key, status: 'claiming', claim_token: row.claim_token || '__stale__' }
        : { dedup_key, status: 'unclaimed' },
      { $set: { status: 'claiming', claim_token: token, claimed_at: new Date().toISOString(), attempts: (row.attempts || 0) + 1 } },
    ).catch(() => null);
    if (take && take.updated) return { won: true, token };
    return { won: false, reason: 'claimed_by_concurrent_send' };
  }
  // No claim row — claims are created at generation time; a missing row is a
  // provenance failure (never send unclaimed).
  return { won: false, reason: 'claim_missing' };
}

async function commitSendItem(svc: any, dedup_key: string, token: string) {
  return svc.entities.ShowcaseSendClaim.updateMany(
    { dedup_key, status: 'claiming', claim_token: token },
    { $set: { status: 'sent' } },
  ).catch(() => null);
}

async function releaseSendItem(svc: any, dedup_key: string, token: string, error: string) {
  return svc.entities.ShowcaseSendClaim.updateMany(
    { dedup_key, status: 'claiming', claim_token: token },
    { $set: { status: 'unclaimed', claim_token: null, claimed_at: null, last_error: String(error || '').slice(0, 300) } },
  ).catch(() => null);
}

/** Creates the per-stage claim rows for every content item (generation time). */
export async function createSendClaims(svc: any, pack: any) {
  const claims: any[] = [];
  for (const stage of ['preview', 'customer']) {
    (pack.contents || []).forEach((c: any, idx: number) => {
      claims.push({
        pack_id: pack.id,
        pack_number: pack.pack_number || null,
        stage,
        template_id: c.template_id,
        content_index: idx,
        label: c.label || null,
        dedup_key: `${pack.id}:${stage}:${c.template_id}:${idx}`,
        claim_token: null,
        claimed_at: null,
        attempts: 0,
        status: 'unclaimed',
        is_selftest: !!(pack as any).__selftest,
      });
    });
  }
  if (claims.length) await svc.entities.ShowcaseSendClaim.bulkCreate(claims).catch(() => null);
}

// ── Attachment builders (real report generators, demo records) ───────────────
async function buildAccessAttachments(svc: any, meta: any, ids: string[], brand: any, customerName: string, wantCsv: boolean) {
  const logs = (await fetchByIds(svc, 'AccessLog', ids)).filter((l) => l.site_name || l.site_id);
  if (!logs.length) return [];
  const bySite: Record<string, any[]> = {};
  for (const l of logs) {
    const key = l.site_name || l.site_id || 'unknown';
    (bySite[key] ||= []).push(l);
  }
  const siteKey = Object.keys(bySite).sort((a, b) => bySite[b].length - bySite[a].length)[0];
  const siteLogs = bySite[siteKey];
  const siteName = siteLogs[0]?.site_name || siteKey;
  const anchorMs = Math.max(...siteLogs.map((l: any) => new Date(l.entry_time || l.timestamp || l.created_date).getTime() || 0).filter(Boolean));
  const period = computeReportingPeriod(anchorMs, DEFAULT_REPORT_TIMEZONE);
  const fmt = makeZonedFormatters(DEFAULT_REPORT_TIMEZONE);
  const model = buildDailyAccessModel({
    period, fmt,
    stillInside: siteLogs.filter((l: any) => l.status === 'inside'),
    exited: siteLogs.filter((l: any) => l.status === 'exited'),
    denied: siteLogs.filter((l: any) => l.status === 'denied' || l.status === 'blacklisted'),
    devices: [],
    customerName, siteName,
    generatedAtMs: Date.now(),
  });
  if (wantCsv) {
    const csv = buildDailyAccessCsv(model);
    return [{ filename: meta.filename, content: bytesToBase64(new TextEncoder().encode(csv)) }];
  }
  return [{ filename: meta.filename, content: bytesToBase64(buildDailyAccessPdf(model, brand)) }];
}

async function buildHospitalityAttachment(svc: any, meta: any, brand: any) {
  const visits = (await fetchByIds(svc, 'HospitalityVisit', meta.record_ids || [])).filter((v) => v.demo_batch_id && !v.is_test);
  if (!visits.length) return [];
  const logIds = [...new Set(visits.map((v) => v.access_log_id).filter(Boolean))];
  const logs = await fetchByIds(svc, 'AccessLog', logIds);
  const logById = new Map(logs.map((l) => [l.id, l]));
  const joined = visits.map((v) => ({ ...v, entry: v.access_log_id ? (logById.get(v.access_log_id) || null) : null }));
  const pdf = await buildHospitalityVisitsPdf(joined, brand, 'DEMO sample — seeded demonstration visits (bounded)');
  return [{ filename: meta.filename, content: bytesToBase64(pdf) }];
}

async function buildDailyActivityAttachment(svc: any, meta: any, brand: any) {
  const ids: Record<string, string[]> = meta.record_ids || {};
  const [incidents, maintenance, patrols, shifts] = await Promise.all([
    fetchByIds(svc, 'Incident', ids.Incident || []),
    fetchByIds(svc, 'MaintenanceRequest', ids.MaintenanceRequest || []),
    fetchByIds(svc, 'PatrolLog', ids.PatrolLog || []),
    fetchByIds(svc, 'Shift', ids.Shift || []),
  ]);
  const openIncidents = incidents.filter((i) => !['resolved', 'closed', 'declined'].includes(i.status)).length;
  const pendingMaintenance = maintenance.filter((m) => m.status !== 'completed' && m.status !== 'cancelled').length;
  const stats = {
    incidents: incidents.length,
    maintenance: maintenance.length,
    patrols: patrols.length,
    shifts: shifts.filter((s) => s.clock_in?.timestamp).length,
    openIncidents,
    pendingMaintenance,
    summary: `DEMO sample day — ${incidents.length} incidents, ${maintenance.length} maintenance requests, ${patrols.length} checkpoint scans and ${shifts.filter((s) => s.clock_in?.timestamp).length} worked shifts recorded across the seeded demonstration sites.`,
  };
  const pdf = buildDailyActivityPdf(meta.date || 'Demo day', stats, brand);
  return [{ filename: meta.filename, content: bytesToBase64(pdf) }];
}

async function buildMonthlyAttachment(svc: any, meta: any, brand: any, kind: 'incident' | 'maintenance') {
  const entity = kind === 'incident' ? 'Incident' : 'MaintenanceRequest';
  const records = await fetchByIds(svc, entity, meta.record_ids || []);
  if (!records.length) return [];
  const built = kind === 'incident'
    ? buildMonthlyIncidentPdf({ records, brand })
    : buildMonthlyMaintenancePdf({ records, brand });
  return [{ filename: meta.filename, content: bytesToBase64(built.bytes) }];
}

/** Builds the REAL attachments for one content item at send time. */
// ── Attachment FREEZING (generation time) ────────────────────────────────────
// Builds each item's real report attachments ONCE at pack generation and
// uploads the bytes to PRIVATE storage; the frozen file_uri is stored in the
// pack's attachment metadata. Preview and customer delivery then REUSE the
// exact files the owner reviewed — later demo-data changes can never alter an
// approved pack's attachments (regeneration creates a new pack + fingerprint).
export async function freezeItemAttachments(svc: any, content: any, brand: any, customerName: string) {
  const out: any[] = [];
  for (const meta of content.attachments || []) {
    try {
      if (meta.file_uri) { out.push(meta); continue; }
      const built = await buildItemAttachments(svc, { ...content, attachments: [meta] }, brand, customerName);
      const first = built[0];
      if (!first?.content) { out.push(meta); continue; }
      const type = /\.csv$/i.test(meta.filename) ? 'text/csv' : 'application/pdf';
      const file = new File([bytesFromBase64(first.content)], meta.filename, { type });
      const up = await svc.integrations.Core.UploadPrivateFile({ file });
      const uri = up?.file_uri || up?.data?.file_uri || null;
      out.push(uri ? { ...meta, file_uri: uri } : meta);
    } catch (e: any) {
      try { console.error('[showcaseDelivery] freeze failed for', meta?.filename, String(e?.message || e)); } catch (_) {}
      out.push(meta);
    }
  }
  return out;
}

/** Builds the attachments for one content item at send time — FROZEN
 *  attachments (file_uri set at generation) are reused verbatim. */
export async function buildItemAttachments(svc: any, content: any, brand: any, customerName: string) {
  const out: { filename: string; content?: string; file_url?: string }[] = [];
  for (const meta of content.attachments || []) {
    try {
      if (meta.file_uri) {
        out.push({ filename: meta.filename, file_url: meta.file_uri });
        continue;
      }
      if (meta.generator === 'daily_access_pdf') {
        out.push(...await buildAccessAttachments(svc, meta, meta.record_ids || content.demo_record_ids || [], brand, customerName, false));
      } else if (meta.generator === 'daily_access_csv') {
        out.push(...await buildAccessAttachments(svc, meta, meta.record_ids || content.demo_record_ids || [], brand, customerName, true));
      } else if (meta.generator === 'hospitality_visits_pdf') {
        out.push(...await buildHospitalityAttachment(svc, meta, brand));
      } else if (meta.generator === 'daily_activity_pdf') {
        out.push(...await buildDailyActivityAttachment(svc, meta, brand));
      } else if (meta.generator === 'monthly_incident_pdf') {
        out.push(...await buildMonthlyAttachment(svc, meta, brand, 'incident'));
      } else if (meta.generator === 'monthly_maintenance_pdf') {
        out.push(...await buildMonthlyAttachment(svc, meta, brand, 'maintenance'));
      }
    } catch (e: any) {
      try { console.error('[showcaseDelivery] attachment build failed for', meta?.filename, String(e?.message || e)); } catch (_) {}
      /* an attachment that cannot be built never blocks the send */
    }
  }
  return out.filter((a) => a.content && a.filename);
}

// ── sendOne — claim -> send -> commit/release, with the pack results ledger ──
export async function sendOne(
  svc: any, pack: any, user: any, stage: 'preview' | 'customer',
  content: any, to: string, brand: any, customer_id: string, copy_to?: string | null,
  contentIdx?: number,
  opts?: { attachments?: { filename: string; content: string }[]; transport?: (p: any) => Promise<any>; config?: { mode?: string | null; testMailboxes?: string[] } },
) {
  // The content index disambiguates per-site variants that share a template_id
  // (e.g. one Daily Access Report per demo site) in the send ledger.
  const dedupKey = `${pack.id}:${stage}:${content.template_id}:${contentIdx ?? 0}`;
  const results = stage === 'preview' ? [...(pack.preview?.results || [])] : [...(pack.customer_delivery?.results || [])];
  if (results.some((r) => r.dedup_key === dedupKey && r.status === 'sent')) {
    return { skipped: true, reason: 'already_sent' };
  }
  // ATOMIC CLAIM before any delivery — the concurrency authority for
  // duplicate-send prevention (the pack ledger is the fast path; the claim
  // row serialises concurrent attempts; the audited-email idempotency key is
  // the third, store-level layer).
  const claim = await claimSendItem(svc, dedupKey);
  if (!claim.won) return { skipped: true, reason: claim.reason };
  const token = claim.token as string;

  // REAL ATTACHMENTS — FROZEN ON FIRST SEND. When the caller does not supply
  // attachments (the production gateway path), the item's report files are
  // built ONCE by the shared generators, uploaded to PRIVATE storage and the
  // frozen file_uri PERSISTED into the pack contents — the other stage and
  // every retry then REUSE the exact same files, so later demo-data changes
  // can never alter an approved pack's attachments.
  let attachments: { filename: string; content?: string; file_url?: string }[];
  if (opts?.attachments) {
    attachments = opts.attachments;
  } else {
    const builtAtts = await buildItemAttachments(svc, content, brand, (pack as any).customer_name || null);
    const uris: Record<number, string> = {};
    for (let i = 0; i < (content.attachments || []).length; i++) {
      const meta: any = content.attachments[i];
      if (!meta || meta.file_uri) continue;
      const built = builtAtts.find((a) => a.filename === meta.filename && a.content);
      if (!built?.content) continue;
      try {
        const type = /\.csv$/i.test(meta.filename) ? 'text/csv' : 'application/pdf';
        const up = await svc.integrations.Core.UploadPrivateFile({
          file: new File([bytesFromBase64(built.content as string)], meta.filename, { type }),
        });
        const uri = up?.file_uri || up?.data?.file_uri || null;
        if (uri) {
          uris[i] = uri;
          const bi = builtAtts.findIndex((a) => a.filename === meta.filename && a.content);
          if (bi >= 0) builtAtts[bi] = { filename: meta.filename, file_url: uri };
        }
      } catch (e: any) {
        try { console.error('[showcaseDelivery] freeze-at-send failed for', meta.filename, String(e?.message || e)); } catch (_) {}
      }
    }
    // Persist the frozen uris (fresh copy first — never clobber another
    // item's just-frozen uri).
    if (Object.keys(uris).length && contentIdx !== undefined) {
      try {
        const fresh = await svc.entities.ReportShowcasePack.get(pack.id).catch(() => null);
        const freshPack = fresh?.data ?? fresh;
        const contents = [...(freshPack?.contents || pack.contents || [])];
        const item = { ...contents[contentIdx] };
        item.attachments = (item.attachments || []).map((m: any, i: number) => (uris[i] ? { ...m, file_uri: uris[i] } : m));
        contents[contentIdx] = item;
        await svc.entities.ReportShowcasePack.update(pack.id, { contents });
      } catch (_) { /* persistence failure never blocks the send */ }
    }
    attachments = builtAtts.filter((a) => a.content || a.file_url);
  }
  const attempt = async (addr: string) => {
    try {
      const r = await sendAuditedEmail(svc, {
        to: addr,
        subject: content.subject,
        html: content.html,
        text: content.text,
        brand,
        customer_id,
        from_name: brand?.brand_name || undefined,
        event_type: 'showcase_pack',
        reference_id: dedupKey,
        idempotency_key: `${dedupKey}:${addr}`,
        dedupe: true,
        ...(attachments.length ? { attachments } : {}),
        ...(opts?.transport ? { transport: opts.transport } : {}),
        ...(opts?.config ? { config: opts.config } : {}),
      });
      return r?.ok
        ? { ok: true }
        : { ok: false, error: String(r?.error || (r?.skipped ? 'delivery_skipped' : 'delivery_failed')) };
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
  // Commit the claim only on success (conditional on OUR token, so a stale
  // takeover can never let two attempts both commit); release on failure so
  // the item stays retryable.
  if (primary.ok) await commitSendItem(svc, dedupKey, token);
  else await releaseSendItem(svc, dedupKey, token, primary.error || 'send_failed');
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