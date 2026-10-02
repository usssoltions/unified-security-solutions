/**
 * showcaseDedupSelfTest — ISOLATED duplicate-send verification for the
 * Report & Notification Showcase (PLATFORM-ADMIN ONLY, run on demand).
 *
 * Proves that a repeated AND concurrent send attempt can never produce a
 * second delivery, WITHOUT any email ever leaving the system:
 *  - Transport: INTERCEPTED — a recorder stands in for Core.SendEmail, so
 *    every attempted delivery is counted, none delivered.
 *  - Delivery mode: an isolated injected config (mode 'test' with an
 *    intercept address) — the same fail-closed guard normalisation runs, but
 *    the transport is the recorder.
 *  - Ledger: an ISOLATED self-test pack (pack_number SHOW-SELFTEST-…,
 *    is_selftest claims) — created, exercised and DELETED in one run.
 *
 * Tests: (1) sequential repeat send → second attempt skipped 'already_sent',
 * exactly one recorded delivery; (2) four CONCURRENT attempts → exactly one
 * recorded delivery, losers 'claimed_by_concurrent_send'; (3) the audited
 * idempotency store holds exactly one 'sent' row per item+recipient.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { sendOne } from '../../shared/showcaseDelivery.ts';

function isPlatformAdmin(user: any): boolean {
  return user?.role === 'admin' || user?.role_type === 'platform_admin' || user?.admin_level === 'platform';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPlatformAdmin(user)) return Response.json({ error: 'Forbidden — platform administration only' }, { status: 403 });

    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    // Frozen-attachment verification file — a tiny text file uploaded to
    // PRIVATE storage, carried as a frozen attachment (file_uri) exactly like
    // a generation-frozen report attachment. The recorder proves it reaches
    // the transport payload; nothing external is ever sent.
    let checkFileUri: string | null = null;
    try {
      const up = await svc.integrations.Core.UploadPrivateFile({
        file: new File([new TextEncoder().encode('Self-test frozen attachment payload')], 'selftest-frozen-check.txt', { type: 'text/plain' }),
      });
      checkFileUri = up?.file_uri || up?.data?.file_uri || null;
    } catch (_) {}
    const pack = await svc.entities.ReportShowcasePack.create({
      pack_number: `SHOW-SELFTEST-${rand}`,
      customer_id: 'SELFTEST',
      customer_name: 'Dedup Self-Test (isolated)',
      demo_batch_ids: [],
      status: 'generated',
      selections: [{ template_id: 'dedup_selftest', include: true }],
      contents: [{
        template_id: 'dedup_selftest',
        label: 'Duplicate-Send Verification Item',
        module: 'SELFTEST',
        channel: 'email',
        scenario: 'Isolated duplicate-send verification (intercepted transport).',
        subject: 'DEMO | Duplicate-send verification item',
        html: '<p>Isolated self-test body — intercepted transport, never delivered externally. This body exists so the content-validity path runs exactly as a real item would.</p>',
        text: 'DEMO | Duplicate-send verification item — isolated self-test, never delivered externally.',
        demo_record_ids: [],
        attachments: checkFileUri
          ? [{ filename: 'selftest-frozen-check.txt', generator: 'frozen_selftest', file_uri: checkFileUri }]
          : [],
      }],
      branding_snapshot: { brand_name: null, primary_color: null, accent_color: null, logo_url: null, missing_overrides: [] },
      content_fingerprint: 'selftest',
      preview: { sent_at: null, recipient: null, results: [] },
      approval: {},
      customer_delivery: { to: null, bcc_copy_to: null, started_at: null, completed_at: null, results: [] },
      audit: [{ timestamp: new Date().toISOString(), actor_id: user?.id || null, actor_name: user?.full_name || user?.email || null, action: 'selftest', notes: 'Isolated duplicate-send verification created' }],
    }) as any;
    const packId = (pack as any)?.id || (pack as any)?.data?.id;
    const dedupKey = `${packId}:preview:dedup_selftest:0`;
    await svc.entities.ShowcaseSendClaim.create({
      pack_id: packId, pack_number: `SHOW-SELFTEST-${rand}`, stage: 'preview',
      template_id: 'dedup_selftest', content_index: 0, label: 'Duplicate-Send Verification Item',
      dedup_key: dedupKey, claim_token: null, claimed_at: null, attempts: 0,
      status: 'unclaimed', is_selftest: true,
    });

    const userArg = { id: user?.id || null, full_name: user?.full_name || null, email: user?.email || null };
    const brand = { brand_name: 'Self-Test' };
    // INTERCEPTED transport — counts deliveries, delivers nothing.
    const sent: any[] = [];
    const transport = async (p: any) => {
      sent.push({ to: p?.to || null, subject: p?.subject || null, attachments: (p?.attachments || []).map((a: any) => a.filename || a.file_url || null) });
    };
    // ISOLATED injected config — same fail-closed normalisation as secrets.
    const config = { mode: 'test', testMailboxes: ['intercepted@selftest.invalid'] };
    const to = 'intercepted@selftest.invalid';
    const content = (pack as any).contents?.[0] || (pack as any)?.data?.contents?.[0];

    const results: any = {};
    results.debug = {
      check_file_uri: checkFileUri,
      content_attachments: (content?.attachments || []).map((a: any) => ({ keys: Object.keys(a), file_uri: a.file_uri || null })),
    };

    // ── TEST 1 — sequential repeat send ───────────────────────────────────
    const packView1 = { ...(pack as any), id: packId, preview: { sent_at: null, recipient: null, results: [] } };
    const r1 = await sendOne(svc, packView1, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config });
    const r2 = await sendOne(svc, packView1, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config });
    results.sequential = {
      first_ok: !!r1.ok,
      first_deliveries: sent.length,
      second_skipped: !!r2.skipped,
      second_reason: r2.reason || null,
      total_deliveries: sent.length,
      attachment_passthrough: checkFileUri
        ? sent.filter((d) => (d.attachments || []).includes('selftest-frozen-check.txt')).length
        : null,
    };
    await sleep(300);

    // ── TEST 2 — concurrent attempts ──────────────────────────────────────
    // Reset the isolated claim + ledger AND the audit idempotency rows left
    // by TEST 1, so TEST 2 exercises the CONCURRENCY layer in isolation (the
    // audit store is proven separately in TEST 3).
    await svc.entities.ShowcaseSendClaim.updateMany(
      { dedup_key: dedupKey, is_selftest: true },
      { $set: { status: 'unclaimed', claim_token: null, claimed_at: null } },
    );
    await svc.entities.NotificationDelivery.deleteMany({ idempotency_key: `${dedupKey}:${to}`, channel: 'email' }).catch(() => null);
    const packView2 = { ...(pack as any), id: packId, preview: { sent_at: null, recipient: null, results: [] } };
    const before = sent.length;
    const concurrent = await Promise.all([
      sendOne(svc, packView2, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config }),
      sendOne(svc, packView2, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config }),
      sendOne(svc, packView2, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config }),
      sendOne(svc, packView2, userArg, 'preview', content, to, brand, 'SELFTEST', null, 0, { transport, config }),
    ]);
    results.concurrent = {
      attempts: 4,
      deliveries_during_test: sent.length - before,
      total_deliveries: sent.length,
      sent_attempts: concurrent.filter((r) => !r.skipped && r.ok).length,
      concurrent_block_reasons: concurrent.map((r) => (r.skipped ? r.reason : 'sent')),
    };
    await sleep(300);

    // ── TEST 3 — audited idempotency store (third layer) ──────────────────
    const auditRows = await svc.entities.NotificationDelivery
      .filter({ idempotency_key: `${dedupKey}:${to}`, channel: 'email' }).catch(() => []);
    results.audit_store = {
      sent_rows: (auditRows || []).filter((r: any) => r.status === 'sent').length,
      failed_or_skipped_rows: (auditRows || []).filter((r: any) => r.status !== 'sent').length,
    };

    // ── CLEANUP — the isolated ledger leaves nothing behind ───────────────
    await svc.entities.ShowcaseSendClaim.deleteMany({ pack_id: packId, is_selftest: true }).catch(() => null);
    for (const key of [`${dedupKey}:${to}`]) {
      await svc.entities.NotificationDelivery.deleteMany({ idempotency_key: key }).catch(() => null);
    }
    await svc.entities.ReportShowcasePack.delete(packId).catch(() => null);

    results.pass = (
      results.sequential.first_deliveries === 1 &&
      results.sequential.second_skipped === true &&
      results.concurrent.deliveries_during_test === 1 &&
      results.concurrent.sent_attempts === 1 &&
      results.audit_store.sent_rows === 1 &&
      (checkFileUri === null || results.sequential.attachment_passthrough === 1)
    );
    return Response.json({ success: true, selftest: results });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});