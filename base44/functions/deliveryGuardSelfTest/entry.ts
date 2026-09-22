/**
 * deliveryGuardSelfTest — ISOLATED, NON-DESTRUCTIVE verification of the
 * delivery guard and the guarded audited sender.
 *
 * Every test runs against INJECTED configuration and a MOCKED transport +
 * MOCKED audit store: no real email can be sent, no real audit rows are
 * written, no entities are read. Proves, without any production delivery:
 *   1. Invalid or missing delivery mode fails closed.
 *   2. Production mode never rewrites recipients (and adds no [TEST]).
 *   3. Test mode always rewrites ALL recipients to the allowlist.
 *   4. Preview mode never invokes the transport.
 *   5. Audit/test/fixture records cannot deliver in production.
 *   6. Missing test mailbox in test mode fails closed.
 *   7. CC/BCC cannot bypass the guard (payload carries no cc/bcc; the
 *      recipient is always the guarded one).
 *   8. Secondary sends, escalations and retries all pass through the guard
 *      (and explicit idempotency keys suppress duplicates).
 *
 * Authorization: platform administrators only. The function is side-effect
 * free by construction, but remains admin-gated as defense in depth.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { applyDeliveryGuard, sendAuditedEmail } from '../../shared/auditedEmail.ts';

const MAILBOX = 'sales@unifiedbusiness.co.za';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const platform = user.role === 'admin' || user.role_type === 'admin' ||
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    if (!platform) return Response.json({ error: 'Forbidden — platform administrators only' }, { status: 403 });

    // ── MOCK TRANSPORT + MOCK AUDIT STORE (no real side effects) ──────────
    const transportCalls: any[] = [];
    const auditRows: any[] = [];
    let priorSent: any[] = [];
    const mockSvc = {
      integrations: { Core: { SendEmail: async (payload: any) => {
        transportCalls.push(payload);
        return { ok: true };
      } } },
      entities: { NotificationDelivery: {
        create: async (row: any) => { auditRows.push(row); return { id: 'mock-' + auditRows.length }; },
        filter: async () => priorSent, // configurable prior 'sent' rows for idempotency
      } },
    };
    const BRAND = { brand_name: 'Unit Test Brand', customer_id: null, reseller_id: null };
    const S = (p: any) => sendAuditedEmail(mockSvc, { brand: BRAND, event_type: 'guard_unit_test', ...p });

    const results: any[] = [];
    const t = (name: string, pass: boolean, detail?: any) =>
      results.push({ name, pass, ...(detail !== undefined ? { detail } : {}) });
    const count = () => transportCalls.length;

    // ── PURE GUARD MATRIX (injected configuration) ─────────────────────────
    const gm = (p: any) => applyDeliveryGuard({ testMailboxes: [MAILBOX], ...p });
    t('1a. guard: invalid mode fails closed',
      gm({ mode: 'bogus', to: 'a@b.co', subject: 'x' }).reason === 'BLOCKED_INVALID_DELIVERY_MODE');
    t('1b. guard: missing mode fails closed',
      gm({ mode: null, to: 'a@b.co', subject: 'x' }).reason === 'BLOCKED_INVALID_DELIVERY_MODE');
    t('2. guard: production never rewrites recipient or subject',
      (() => { const g = gm({ mode: 'production', to: 'real@company.co.za', subject: 'Shift Alert' });
        return g.deliver && g.to === 'real@company.co.za' && g.subject === 'Shift Alert'; })());
    t('3. guard: test mode rewrites recipient and prefixes [TEST]',
      (() => { const g = gm({ mode: 'test', to: 'real@company.co.za', subject: 'Shift Alert' });
        return g.deliver && g.to === MAILBOX && g.subject.startsWith('[TEST]'); })());
    t('4. guard: preview mode never delivers',
      gm({ mode: 'preview', to: 'a@b.co', subject: 'x' }).reason === 'PREVIEW_MODE');
    t('5. guard: production blocks test/audit/fixture records',
      gm({ mode: 'production', to: 'a@b.co', subject: 'x', isTestRecord: true }).reason === 'TEST_RECORD_BLOCKED_IN_PRODUCTION' &&
      gm({ mode: 'production', to: 'a@b.co', subject: 'x', referenceId: 'AUDIT-1' }).reason === 'TEST_RECORD_BLOCKED_IN_PRODUCTION');
    t('6. guard: test mode without allowlisted mailbox fails closed',
      applyDeliveryGuard({ mode: 'test', testMailboxes: [], to: 'a@b.co', subject: 'x' }).reason === 'TEST_MODE_NO_ALLOWLISTED_MAILBOX');

    // ── TRANSPORT MATRIX (mocked transport, injected configuration) ────────
    // T2 production delivers to the ORIGINAL recipient, subject untouched
    let n = count();
    const r2 = await S({ to: 'real@company.co.za', subject: 'Shift Alert', config: { mode: 'production' } });
    t('2. transport: production delivers to original recipient, no [TEST]',
      r2.ok && count() === n + 1 && transportCalls[n].to === 'real@company.co.za' &&
      !String(transportCalls[n].subject).startsWith('[TEST]'));
    t('2b. transport: audit row records the effective recipient (no intended override)',
      auditRows.some((r) => r.status === 'sent' && r.recipient_address === 'real@company.co.za' && !r.intended_recipient_address));

    // T3 test mode rewrites ALL recipients
    n = count();
    const r3 = await S({ to: 'anyone@anywhere.co.za', subject: 'Incident Alert', config: { mode: 'test', testMailboxes: [MAILBOX] } });
    t('3. transport: test mode rewrites recipient to allowlist + [TEST] prefix',
      r3.ok && transportCalls[n].to === MAILBOX && String(transportCalls[n].subject).startsWith('[TEST]'));
    t('3b. transport: audit row preserves the INTENDED recipient separately',
      auditRows.some((r) => r.intended_recipient_address === 'anyone@anywhere.co.za' &&
        r.recipient_address === MAILBOX && r.delivery_mode === 'test'));
    n = count();
    for (const to of ['a@x.co', 'b@y.co', 'c@z.co']) {
      await S({ to, subject: 'Multi', config: { mode: 'test', testMailboxes: [MAILBOX] } });
    }
    t('3c. transport: test mode rewrites ALL recipients (no partial rewrites)',
      count() === n + 3 && transportCalls.slice(n).every((c) => c.to === MAILBOX));

    // T4 preview mode never invokes transport
    n = count();
    const r4 = await S({ to: 'x@y.co', subject: 'P', config: { mode: 'preview' } });
    t('4. transport: preview mode never invokes transport (audited skipped)',
      !r4.ok && !!r4.skipped && count() === n &&
      auditRows.some((r) => r.status === 'skipped' && r.skip_reason === 'PREVIEW_MODE'));

    // T5 test mode with no allowlisted mailbox fails closed
    n = count();
    const r5 = await S({ to: 'x@y.co', subject: 'P', config: { mode: 'test', testMailboxes: [] } });
    t('5. transport: test mode with missing mailbox fails closed (no transport)',
      !r5.ok && count() === n && r5.error === 'TEST_MODE_NO_ALLOWLISTED_MAILBOX');

    // T6/7 production blocks synthetic records
    n = count();
    const r6 = await S({ to: 'x@y.co', subject: 'P', is_test_record: true, config: { mode: 'production' } });
    const r7 = await S({ to: 'x@y.co', subject: 'P', reference_id: 'AUDIT-1', config: { mode: 'production' } });
    t('6/7. transport: audit/test/fixture records cannot deliver in production',
      !r6.ok && !r7.ok && count() === n && r6.error === 'TEST_RECORD_BLOCKED_IN_PRODUCTION');

    // T8 invalid injected mode fails closed through the sender too
    n = count();
    const r8 = await S({ to: 'x@y.co', subject: 'P', config: { mode: 'staging' } });
    t('1c. transport: invalid injected mode fails closed (blocked, no transport)',
      !r8.ok && count() === n && r8.error === 'BLOCKED_INVALID_DELIVERY_MODE');

    // T9 cc/bcc bypass attempt — payload cannot carry them; recipient guarded
    n = count();
    const ccAttempt: any = { to: 'x@y.co', subject: 'CC attempt', cc: 'hidden@evil.co', bcc: 'bcc@evil.co',
      config: { mode: 'test', testMailboxes: [MAILBOX] } };
    await S(ccAttempt);
    t('7. transport: cc/bcc cannot bypass the guard (no cc/bcc in payload, recipient rewritten)',
      count() === n + 1 && !('cc' in transportCalls[n]) && !('bcc' in transportCalls[n]) &&
      transportCalls[n].to === MAILBOX);

    // T10 secondary sends / retries all pass through the guard
    n = count();
    await S({ to: 'retry@x.co', subject: 'R', config: { mode: 'test', testMailboxes: [MAILBOX] } });
    await S({ to: 'retry@x.co', subject: 'R', config: { mode: 'test', testMailboxes: [MAILBOX] } });
    t('8a. transport: secondary/retry sends all pass through the guard (all rewritten)',
      count() === n + 2 && transportCalls.slice(n).every((c) => c.to === MAILBOX));

    // T11 explicit idempotency key + prior sent row → no duplicate transport
    priorSent = [{ id: 'existing-sent-row' }];
    n = count();
    const r11 = await S({ to: 'dedupe@x.co', subject: 'D', idempotency_key: 'guard_unit_test:dedupe',
      config: { mode: 'test', testMailboxes: [MAILBOX] } });
    t('8b. transport: idempotent retry skips transport (no duplicate send)',
      !!r11.ok && !!r11.skipped && count() === n);

    return Response.json({
      success: true,
      all_passed: results.every((r) => r.pass),
      passed: results.filter((r) => r.pass).length,
      failed: results.filter((r) => !r.pass).map((r) => r.name),
      matrix: results,
      transport_invocations_total: transportCalls.length,
      note: 'All tests ran against a MOCKED transport and MOCKED audit store with INJECTED configuration — no email was sent and no audit rows were written by this run.',
    });
  } catch (error) {
    console.error('deliveryGuardSelfTest error:', error);
    return Response.json({ error: error?.message || 'Self-test failed' }, { status: 500 });
  }
});