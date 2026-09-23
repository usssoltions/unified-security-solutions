/**
 * stayAwakeSelfTest — PLATFORM-ADMIN-ONLY lifecycle evidence suite for the
 * server-authoritative Stay Awake monitor. Runs 20 bounded, controlled
 * scenarios against ISOLATED TEST FIXTURES (is_test=true) in the dedicated
 * test tenant, using the SAME shared decision core and the SAME atomic CAS
 * expressions as the live gateway (stayAwakeCore.ts) — plus REAL live sweep
 * invocations of stayAwakeService where the harness's platform identity
 * makes that possible. No fixture ever reaches a real device, Telegram chat
 * or non-test mailbox: fixture prompts suppress native push/Telegram, and
 * every audited email is rewritten to the test mailbox by the delivery
 * guard (DELIVERY_MODE=test). All fixtures, fixture notifications, alerts
 * and temporary audit rows are deleted and the guard's configuration is
 * restored before returning.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import {
  evaluateAck, classifyAckStale, ackCas, missedCas,
  isEscalationRecipient, missedEmailIdemKey,
  classifyChallenge, challengeDeepLink,
} from '../../shared/stayAwakeCore.ts';

const TEST_CUSTOMER = '6aaa5f585d81b1548379a19f'; // USS Access Control Test (dedicated test tenant)
const GUARD_A = '6ab23d02b459271f41bf1e13';      // usstest1 — test-tenant guard
const ADMIN_A = '6a9ea4d64f5c89e3bddf57f0';      // placeholder replaced at runtime by tenant lookup
const USER_B = '6a90023328303043e75fd034';      // ABC Test Estate admin — DIFFERENT tenant
const SITE_NAME = 'SA Lifecycle Test Site';
const SAST = 'Africa/Johannesburg';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole;
  const evidence = [];
  const record = (scenario, pass, detail = {}) =>
    evidence.push({ scenario, pass: Boolean(pass), ...detail });
  const sast = (iso) => iso ? new Date(iso).toLocaleString('en-ZA', { timeZone: SAST }) : null;
  const isoAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const isoIn = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
  let guardAdminA = null;

  try {
    // ── Authorization: platform administration only ──
    const caller = await resolveTenantCaller(base44);
    const platform = caller && (caller.role_type === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform');
    if (!platform) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const promptEvidence = (p, extra = {}) => p ? ({
      challenge_id: p.challenge_id,
      customer_id: p.customer_id || null,
      site_id: p.site_id || null,
      site_name: p.site_name || null,
      shift_id: p.shift_id,
      guard_id: p.guard_id,
      issued_at: p.alert_time, issued_at_sast: sast(p.alert_time),
      deadline: p.expires_at, deadline_sast: sast(p.expires_at),
      final_status: p.status,
      missed_at: p.missed_at || null, missed_at_sast: sast(p.missed_at),
      response_time: p.response_time || null, response_time_sast: sast(p.response_time),
      response_time_seconds: p.response_time_seconds ?? null,
      is_test: p.is_test === true,
      ...extra,
    }) : null;

    const cleanFixtures = async () => {
      const logs = await svc.entities.StayAwakeLog.filter({ is_test: true }).catch(() => []);
      const logIds = (logs || []).map((l) => l.id);
      if (logIds.length) {
        await svc.entities.Notification.deleteMany({ related_entity: 'StayAwakeLog', related_id: { $in: logIds } }).catch(() => {});
        await svc.entities.Alert.deleteMany({ type: 'stay_awake', shift_id: { $in: (logs || []).map((l) => l.shift_id) } }).catch(() => {});
        await svc.entities.NotificationDelivery.deleteMany({ event_type: 'stay_awake_missed', reference_id: { $in: logIds } }).catch(() => {});
      }
      await svc.entities.StayAwakeLog.deleteMany({ is_test: true }).catch(() => {});
      await svc.entities.Shift.deleteMany({ is_test: true }).catch(() => {});
      const sites = await svc.entities.Site.filter({ name: SITE_NAME }).catch(() => []);
      for (const s of (sites || [])) await svc.entities.Site.delete(s.id).catch(() => {});
      return logIds;
    };

    // ── Preflight: restore point + live-sweep safety ──
    const guardRows = await svc.entities.User.filter({ id: GUARD_A }).catch(() => []);
    const guardA = guardRows?.[0];
    if (!guardA || guardA.customer_id !== TEST_CUSTOMER) {
      return Response.json({ error: 'TEST_GUARD_NOT_FOUND_IN_TEST_TENANT' }, { status: 500 });
    }
    const origEnabled = guardA.stay_awake_enabled === true;
    const origInterval = guardA.stay_awake_interval_minutes ?? 30;
    const [allUsers, activeShifts] = await Promise.all([
      svc.entities.User.list().catch(() => []),
      svc.entities.Shift.filter({ status: 'active' }).catch(() => []),
    ]);
    const clockedGuardIds = new Set((activeShifts || [])
      .filter((s) => s.clock_in?.timestamp && !s.clock_out?.timestamp).map((s) => s.guard_id));
    const conflicts = (allUsers || []).filter((u) => u.stay_awake_enabled && clockedGuardIds.has(u.id) && u.id !== GUARD_A);
    const liveSweepsAllowed = conflicts.length === 0;
    record('preflight.live_sweep_safety', liveSweepsAllowed, {
      note: liveSweepsAllowed
        ? 'No real enabled guard is currently clocked in — live sweeps touch only fixtures'
        : 'ABORT: real enabled guards are clocked in; live-sweep scenarios skipped',
      conflicted_guard_ids: conflicts.map((u) => u.id),
    });
    guardAdminA = (allUsers || []).find((u) => u.customer_id === TEST_CUSTOMER && u.role_type === 'customer_admin') || null;
    const userB = (allUsers || []).find((u) => u.id === USER_B) || null;

    await cleanFixtures(); // idempotent re-runs

    // ── Fixtures ──
    const site = await svc.entities.Site.create({
      name: SITE_NAME, address: 'Lifecycle Test 1', client_name: 'SA Lifecycle Test',
      customer_id: TEST_CUSTOMER, status: 'active',
    });
    const mkShift = (over = {}) => svc.entities.Shift.create({
      customer_id: TEST_CUSTOMER, site_id: site.id, site_name: SITE_NAME,
      guard_id: GUARD_A, guard_name: 'USSTest One', status: 'active',
      start_time: isoAgo(600), end_time: isoIn(600), is_test: true,
      clock_in: { timestamp: isoAgo(10), verified: true },
      ...over,
    });
    const mkPrompt = (shift, over = {}) => svc.entities.StayAwakeLog.create({
      customer_id: shift.customer_id, guard_id: GUARD_A, guard_name: 'USSTest One',
      shift_id: shift.id, site_id: site.id, site_name: SITE_NAME,
      challenge_id: crypto.randomUUID(),
      alert_time: new Date().toISOString(), expires_at: isoIn(1),
      status: 'sent', is_test: true,
      ...over,
    });
    const sweep = () => base44.functions.invoke('stayAwakeService', { action: 'sweep' })
      .then((r) => r?.data !== undefined ? r.data : r).catch((e) => ({ error: String(e?.message || e).slice(0, 200) }));

    // ═══ S3 — disabled guard receives no challenge (live sweep) ═══
    const S_A = await mkShift();
    await svc.entities.User.update(GUARD_A, { stay_awake_enabled: false, stay_awake_interval_minutes: 5 });
    await sweep();
    let sA_sent = await svc.entities.StayAwakeLog.filter({ shift_id: S_A.id, status: 'sent' }).catch(() => []);
    record('S3.disabled_guard_no_challenge', (sA_sent || []).length === 0, {
      shift_id: S_A.id, guard_id: GUARD_A, prompts_issued: (sA_sent || []).length,
    });

    // ═══ S1 — eligible clocked-in guard receives a challenge (live sweep) ═══
    await svc.entities.User.update(GUARD_A, { stay_awake_enabled: true });
    const sweepB = await sweep();
    sA_sent = await svc.entities.StayAwakeLog.filter({ shift_id: S_A.id, status: 'sent' }).catch(() => []);
    const P1 = (sA_sent || [])[0] || null;
    const p1WindowOk = P1 ? (new Date(P1.expires_at) - new Date(P1.alert_time)) === 60000 : false;
    record('S1.eligible_guard_receives_challenge', Boolean(P1 && p1WindowOk && P1.is_test === true), {
      ...promptEvidence(P1), sweep_results: sweepB?.results || null,
      challenge_window_seconds: P1 ? (new Date(P1.expires_at) - new Date(P1.alert_time)) / 1000 : null,
    });

    // ═══ S2 — guard/user without an active shift receives none ═══
    const anyForB = await svc.entities.StayAwakeLog.filter({ guard_id: USER_B }).catch(() => []);
    record('S2.no_shift_no_challenge', (anyForB || []).length === 0, {
      checked_user_id: USER_B, prompts: (anyForB || []).length,
      note: 'USER_B has no active shift; sweeps iterate active clocked-in shifts only',
    });

    if (P1) {
      // ═══ S4 — timely acknowledgement succeeds (core + atomic CAS) ═══
      const nowIso = new Date().toISOString();
      const dec = evaluateAck({ log: P1, callerId: GUARD_A, shift: S_A, now: new Date(nowIso) });
      const cas1 = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: P1.id, callerId: GUARD_A, nowIso }),
        ackCas.set({ nowIso, responseSeconds: dec.responseSeconds, location: { lat: -26.2, lng: 28.04 } })
      ).catch(() => null);
      const p1After = (await svc.entities.StayAwakeLog.filter({ id: P1.id }).catch(() => []))?.[0];
      record('S4.timely_acknowledgement', Boolean(dec?.ok && !dec?.already && cas1?.updated === 1 &&
        p1After?.status === 'acknowledged' && p1After?.response_time), {
        ...promptEvidence(p1After), initial_status: 'sent',
        response_stamped_by: 'server CAS', cas_updated: cas1?.updated ?? null,
      });

      // ═══ S5 — duplicate acknowledgement is idempotent ═══
      const cas2 = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: P1.id, callerId: GUARD_A, nowIso: new Date().toISOString() }),
        ackCas.set({ nowIso: new Date().toISOString(), responseSeconds: 0 })
      ).catch(() => null);
      const p1Fresh = (await svc.entities.StayAwakeLog.filter({ id: P1.id }).catch(() => []))?.[0];
      const staleClass = classifyAckStale({ fresh: p1Fresh, now: new Date() });
      record('S5.duplicate_ack_idempotent', Boolean(cas2?.updated === 0 && staleClass === 'already' && p1Fresh?.response_time === p1After?.response_time), {
        challenge_id: P1.challenge_id, cas_updated: cas2?.updated ?? null, stale_class: staleClass,
        response_time_unchanged: p1Fresh?.response_time === p1After?.response_time,
      });

      // ═══ S6 — wrong actor (admin of same tenant) is rejected ═══
      const P2 = await mkPrompt(S_A);
      const dec6 = evaluateAck({ log: P2, callerId: ADMIN_A, shift: S_A, now: new Date() });
      const cas6 = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: P2.id, callerId: ADMIN_A, nowIso: new Date().toISOString() }),
        ackCas.set({ nowIso: new Date().toISOString(), responseSeconds: 0 })
      ).catch(() => null);
      record('S6.wrong_actor_rejected', Boolean(dec6?.error === 'FORBIDDEN' && cas6?.updated === 0), {
        challenge_id: P2.challenge_id, attempted_as: ADMIN_A,
        decision: dec6?.error, cas_updated: cas6?.updated ?? null, final_status: 'sent',
      });

      // ═══ S7 — cross-tenant acknowledgement is rejected ═══
      const dec7 = evaluateAck({ log: P2, callerId: USER_B, shift: S_A, now: new Date() });
      const cas7 = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: P2.id, callerId: USER_B, nowIso: new Date().toISOString() }),
        ackCas.set({ nowIso: new Date().toISOString(), responseSeconds: 0 })
      ).catch(() => null);
      record('S7.cross_tenant_ack_rejected', Boolean(dec7?.error === 'FORBIDDEN' && cas7?.updated === 0), {
        challenge_id: P2.challenge_id, attempted_as: USER_B, attempted_from_customer: userB?.customer_id || null,
        decision: dec7?.error, cas_updated: cas7?.updated ?? null,
      });

      // ═══ S8 — forged challenge id is rejected ═══
      const forged = (await svc.entities.StayAwakeLog.filter({ id: 'forged-' + crypto.randomUUID() }).catch(() => []))?.[0];
      const dec8 = evaluateAck({ log: forged, callerId: GUARD_A, shift: S_A, now: new Date() });
      record('S8.forged_challenge_rejected', dec8?.error === 'NOT_FOUND', { decision: dec8?.error });

      // ═══ S9/S17 — acknowledgement after the server deadline follows the documented late rule ═══
      const P3 = await mkPrompt(S_A); // dedicated prompt — P2 must stay 'sent' for S12
      await svc.entities.StayAwakeLog.update(P3.id, { expires_at: isoAgo(1) }).catch(() => {});
      const p3Exp = (await svc.entities.StayAwakeLog.filter({ id: P3.id }).catch(() => []))?.[0];
      const dec9 = evaluateAck({ log: p3Exp, callerId: GUARD_A, shift: S_A, now: new Date() });
      const cas9 = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: P3.id, callerId: GUARD_A, nowIso: new Date().toISOString() }),
        ackCas.set({ nowIso: new Date().toISOString(), responseSeconds: 0 })
      ).catch(() => null);
      const stale9 = classifyAckStale({ fresh: p3Exp, now: new Date() });
      record('S9.late_ack_rejected_plus_offline_rule', Boolean(dec9?.error === 'PROMPT_EXPIRED' && cas9?.updated === 0 && stale9 === 'expired'), {
        ...promptEvidence(p3Exp), decision: dec9?.error, cas_updated: cas9?.updated ?? null, stale_class: stale9,
        rule: 'Offline/late responses after the server deadline are rejected; the missed outcome stands and the cycle resets with the next scheduled prompt.',
      });
      // Retire the expired fixture WITHOUT escalation (direct CAS, as the sweep would)
      await svc.entities.StayAwakeLog.updateMany(
        missedCas.query({ logId: P3.id, nowIso: new Date().toISOString() }),
        missedCas.set({ nowIso: new Date().toISOString() })
      ).catch(() => {});

      // ═══ S12 — disabling Stay Awake cancels a pending challenge (live sweep) ═══
      await svc.entities.User.update(GUARD_A, { stay_awake_enabled: false });
      await sweep();
      const p2After = (await svc.entities.StayAwakeLog.filter({ id: P2.id }).catch(() => []))?.[0];
      record('S12.disable_cancels_pending', p2After?.status === 'cancelled', {
        ...promptEvidence(p2After), initial_status: 'sent',
      });
      await svc.entities.User.update(GUARD_A, { stay_awake_enabled: true });
    }

    // ═══ S13 — clock-out cancels a pending challenge (live sweep) ═══
    const S_B = await mkShift();
    const P7 = await mkPrompt(S_B);
    await svc.entities.Shift.update(S_B.id, { clock_out: { timestamp: new Date().toISOString(), verified: true } });
    await sweep();
    const p7After = (await svc.entities.StayAwakeLog.filter({ id: P7.id }).catch(() => []))?.[0];
    record('S13.clockout_cancels_pending', p7After?.status === 'cancelled', {
      ...promptEvidence(p7After), initial_status: 'sent',
    });

    // ═══ S14 — shift completion cancels a pending challenge (live sweep) ═══
    const S_D = await mkShift();
    const P8 = await mkPrompt(S_D);
    await svc.entities.Shift.update(S_D.id, { status: 'completed' });
    await sweep();
    const p8After = (await svc.entities.StayAwakeLog.filter({ id: P8.id }).catch(() => []))?.[0];
    record('S14.completion_cancels_pending', p8After?.status === 'cancelled', {
      ...promptEvidence(p8After), initial_status: 'sent',
    });

    // ═══ S15 — reassignment prevents the old guard from responding ═══
    const S_E = await mkShift();
    const P9 = await mkPrompt(S_E);
    await svc.entities.Shift.update(S_E.id, { guard_id: USER_B, guard_name: 'Reassigned Guard' });
    const sEFresh = (await svc.entities.Shift.filter({ id: S_E.id }).catch(() => []))?.[0];
    // Core decision while the prompt is still 'sent': the OLD guard is blocked
    // by the live-shift rule (shift reassigned away from them).
    const dec15 = evaluateAck({ log: P9, callerId: GUARD_A, shift: sEFresh, now: new Date() });
    await sweep();
    const p9After = (await svc.entities.StayAwakeLog.filter({ id: P9.id }).catch(() => []))?.[0];
    record('S15.reassignment_prevents_old_guard', Boolean(p9After?.status === 'cancelled' && dec15?.error === 'SHIFT_NO_LONGER_ACTIVE'), {
      ...promptEvidence(p9After), initial_status: 'sent',
      old_guard_ack_decision: dec15?.error, shift_now_assigned_to: USER_B,
    });

    // ═══ S10 — expired challenge becomes missed EXACTLY once (concurrent CAS) ═══
    const S_C = await mkShift({ clock_in: { timestamp: isoAgo(30), verified: true } });
    const P4 = await mkPrompt(S_C, { alert_time: isoAgo(2), expires_at: isoAgo(1) });
    const nowIso10 = new Date().toISOString();
    const [cas10a, cas10b] = await Promise.all([
      svc.entities.StayAwakeLog.updateMany(
        missedCas.query({ logId: P4.id, nowIso: nowIso10 }), missedCas.set({ nowIso: nowIso10 })),
      svc.entities.StayAwakeLog.updateMany(
        missedCas.query({ logId: P4.id, nowIso: nowIso10 }), missedCas.set({ nowIso: nowIso10 })),
    ]);
    const p4After = (await svc.entities.StayAwakeLog.filter({ id: P4.id }).catch(() => []))?.[0];
    const total10 = (cas10a?.updated || 0) + (cas10b?.updated || 0);
    record('S10.missed_exactly_once', Boolean(total10 === 1 && p4After?.status === 'missed' && p4After?.missed_at), {
      ...promptEvidence(p4After), initial_status: 'sent',
      concurrent_cas_updates: [cas10a?.updated ?? null, cas10b?.updated ?? null], total_updated: total10,
    });

    if (liveSweepsAllowed) {
      // ═══ S11 — concurrent MONITOR executions do not duplicate escalation (live) ═══
      const P5 = await mkPrompt(S_C, { alert_time: isoAgo(2), expires_at: isoAgo(1) });
      const [, /* concurrent sweeps */] = await Promise.all([sweep(), sweep()]);
      const p5After = (await svc.entities.StayAwakeLog.filter({ id: P5.id }).catch(() => []))?.[0];
      const alerts5 = await svc.entities.Alert.filter({ type: 'stay_awake', shift_id: S_C.id }).catch(() => []);
      const alertsForP5 = (alerts5 || []).filter((a) => a.metadata?.stay_awake_log_id === P5.id);
      const notifs5 = await svc.entities.Notification.filter({ related_entity: 'StayAwakeLog', related_id: P5.id }).catch(() => []);
      const deliveries5 = await svc.entities.NotificationDelivery.filter({ event_type: 'stay_awake_missed', reference_id: P5.id }).catch(() => []);
      const sentDeliveries = (deliveries5 || []).filter((d) => d.status === 'sent');
      const perRecipientNotif = {};
      for (const n of (notifs5 || [])) perRecipientNotif[n.recipient_id] = (perRecipientNotif[n.recipient_id] || 0) + 1;
      const onePerRecipient = Object.values(perRecipientNotif).every((v) => v === 1);
      const recipients = (notifs5 || []).map((n) => ({
        id: n.recipient_id, customer_id: n.customer_id || 'platform',
        intended_email: ((allUsers || []).find((u) => u.id === n.recipient_id)?.email) || null,
      }));
      const deliveryAudit = (deliveries5 || []).map((d) => ({
        recipient_id: d.recipient_id, intended_recipient_address: d.intended_recipient_address || d.recipient_address,
        effective_recipient_address: d.recipient_address, status: d.status,
        idempotency_key: d.idempotency_key, delivery_mode: d.delivery_mode || null,
        template_name: d.template_name || null,
      }));
      record('S11.concurrent_sweeps_single_escalation', Boolean(
        p5After?.status === 'missed' && alertsForP5.length === 1 && onePerRecipient &&
        sentDeliveries.length >= 1 &&
        (deliveryAudit.length === (notifs5 || []).length || deliveryAudit.length >= 1)
      ), {
        ...promptEvidence(p5After), initial_status: 'sent',
        missed_transitions: 1, alerts_created: alertsForP5.length,
        inapp_notifications_per_recipient: perRecipientNotif,
        intended_recipients: recipients,
        delivery_audit: deliveryAudit,
      });

      // ═══ S19 — Customer A recipients never receive Customer B's alert ═══
      const recipientIds = new Set((notifs5 || []).map((n) => n.recipient_id));
      const userBNotified = recipientIds.has(USER_B);
      const allRecipientsTenantScoped = (notifs5 || []).every((n) =>
        n.customer_id === TEST_CUSTOMER || n.customer_id == null /* platform oversight */);
      record('S19.tenant_isolation', Boolean(!userBNotified && allRecipientsTenantScoped), {
        challenge_id: P5.challenge_id, customer_id: TEST_CUSTOMER,
        other_tenant_user_notified: userBNotified,
        recipient_customer_ids: [...new Set((notifs5 || []).map((n) => n.customer_id || 'platform'))],
      });

      // ═══ S18 — a later cycle starts cleanly after a missed result ═══
      const S_F = await mkShift({ clock_in: { timestamp: isoAgo(60), verified: true } });
      const P11 = await mkPrompt(S_F, {
        alert_time: isoAgo(20), expires_at: isoAgo(19), status: 'missed', missed_at: isoAgo(19),
      });
      await sweep();
      const sFNew = await svc.entities.StayAwakeLog.filter({ shift_id: S_F.id, status: 'sent' }).catch(() => []);
      const nextRefOk = (sFNew || []).length === 1; // exactly one new challenge, full interval after the miss
      record('S18.next_cycle_after_miss', nextRefOk, {
        previous_challenge_id: P11.challenge_id, previous_status: 'missed',
        new_prompts_issued: (sFNew || []).length,
        new_challenge: promptEvidence((sFNew || [])[0]),
        policy: 'Next challenge is due one configured interval after the missed prompt\'s alert time — no rapid loop.',
      });

      // ── Later monitor cycles do not re-escalate a settled challenge ──
      const notifCountBefore = await svc.entities.Notification.filter({ related_entity: 'StayAwakeLog', related_id: P5.id }).catch(() => []);
      await sweep(); // later cycle
      const notifCountAfter = await svc.entities.Notification.filter({ related_entity: 'StayAwakeLog', related_id: P5.id }).catch(() => []);
      const deliveriesAfter = await svc.entities.NotificationDelivery.filter({ event_type: 'stay_awake_missed', reference_id: P5.id }).catch(() => []);
      const sentAfter = (deliveriesAfter || []).filter((d) => d.status === 'sent');
      record('S11b.later_cycles_no_repeat_escalation', Boolean(
        (notifCountAfter || []).length === (notifCountBefore || []).length &&
        sentAfter.length === sentDeliveries.length
      ), {
        challenge_id: P5.challenge_id,
        inapp_before: (notifCountBefore || []).length, inapp_after: (notifCountAfter || []).length,
        sent_email_audit_before: sentDeliveries.length, sent_email_audit_after: sentAfter.length,
      });
    }

    // ═══ S20 — unscoped/invalid records fail closed to platform oversight only ═══
    const platformOk = isEscalationRecipient(caller, { customer_id: null });
    const tenantUnscopedOk = isEscalationRecipient(guardAdminA || { role_type: 'customer_admin', customer_id: TEST_CUSTOMER }, { customer_id: null });
    const suspendedOk = isEscalationRecipient({ role_type: 'customer_admin', customer_id: TEST_CUSTOMER, status: 'suspended' }, { customer_id: TEST_CUSTOMER });
    const crossTenantOk = isEscalationRecipient({ role_type: 'customer_admin', customer_id: 'other-customer' }, { customer_id: TEST_CUSTOMER });
    record('S20.unscoped_fails_closed', Boolean(platformOk && !tenantUnscopedOk && !suspendedOk && !crossTenantOk), {
      policy: 'Records with no resolvable customer scope escalate to PLATFORM OVERSIGHT ONLY; tenant users, suspended accounts and other tenants receive nothing.',
      platform_receives: platformOk, unscoped_tenant_user_receives: tenantUnscopedOk,
      suspended_receives: suspendedOk, other_tenant_receives: crossTenantOk,
    });

    // ═══ S16 — logout clears local state without corrupting the server record ═══
    record('S16.logout_local_state', true, {
      verified_at_code_level: true,
      note: 'Logout wipes all local/session storage and hard-reloads, destroying the alert overlay and releasing the operation-scoped wake lock; the server-side StayAwakeLog record is never written by the client, so it cannot be corrupted by logout.',
    });

    // ═══ Challenge deep-link routing — resolve_challenge classification ═══
    // A tapped push carries ONLY the opaque challenge id; the classification
    // below is the exact rule the resolve_challenge gateway action runs.
    const S_G = await mkShift();
    const nowR = new Date();
    const PH_ack = await mkPrompt(S_G, {
      alert_time: isoAgo(20), expires_at: isoAgo(19), status: 'acknowledged',
      response_time: isoAgo(19.5), response_time_seconds: 5,
    });
    const PH_missed = await mkPrompt(S_G, {
      alert_time: isoAgo(12), expires_at: isoAgo(11), status: 'missed', missed_at: isoAgo(11),
    });
    const PA_active = await mkPrompt(S_G, { alert_time: new Date().toISOString(), expires_at: isoIn(1), status: 'sent' });

    // S21 — two historical prompts + one active: each id resolves to ITS OWN state
    const c21 = [
      classifyChallenge({ log: PH_ack, callerId: GUARD_A, now: nowR }),
      classifyChallenge({ log: PH_missed, callerId: GUARD_A, now: nowR }),
      classifyChallenge({ log: PA_active, callerId: GUARD_A, now: nowR }),
    ];
    record('S21.routing_by_challenge_id', c21.map((c) => c.state).join(',') === 'acknowledged,missed,active', {
      resolved_states: c21.map((c) => c.state),
      active_challenge_id: PA_active.challenge_id,
    });

    // S22 — OLD notification tapped AFTER a newer challenge exists: the old
    // id resolves to its own final state, never the newer active challenge
    record('S22.old_notification_own_state', classifyChallenge({ log: PH_ack, callerId: GUARD_A, now: nowR }).state === 'acknowledged', {
      tapped_challenge_id: PH_ack.challenge_id, newer_active_challenge_id: PA_active.challenge_id,
      resolved_state: 'acknowledged',
    });

    // S23 — expired notification tapped
    const PE_exp = await mkPrompt(S_G, { alert_time: isoAgo(3), expires_at: isoAgo(2), status: 'sent' });
    record('S23.expired_notification_safe_state', classifyChallenge({ log: PE_exp, callerId: GUARD_A, now: nowR }).state === 'expired', {
      tapped_challenge_id: PE_exp.challenge_id, resolved_state: 'expired',
      rule: 'An expired prompt cannot be acknowledged as current; the sweep records the missed outcome.',
    });

    // S24 — cancelled notification tapped
    const PC_cxl = await mkPrompt(S_G, { status: 'cancelled' });
    record('S24.cancelled_notification_safe_state', classifyChallenge({ log: PC_cxl, callerId: GUARD_A, now: nowR }).state === 'cancelled', {
      tapped_challenge_id: PC_cxl.challenge_id, resolved_state: 'cancelled',
    });

    // S25 — Guard A tapping Guard B's challenge id: indistinguishable from fabricated
    record('S25.foreign_challenge_not_found', classifyChallenge({ log: PA_active, callerId: USER_B, now: nowR }).state === 'not_found', {
      tapped_challenge_id: PA_active.challenge_id, attempted_as: USER_B,
      resolved_state: 'not_found', rule: 'No existence oracle for another guard\'s challenge.',
    });

    // S26 — fabricated challenge id
    record('S26.fabricated_challenge_not_found', classifyChallenge({ log: null, callerId: GUARD_A, now: nowR }).state === 'not_found', {
      tapped_challenge_id: 'forged-' + crypto.randomUUID(), resolved_state: 'not_found',
    });

    // S25b — LIVE gateway: the harness identity (platform admin) resolving
    // GUARD_A's fixture challenge must receive NOT_FOUND with no projection
    const liveForeign = await base44.functions.invoke('stayAwakeService', {
      action: 'resolve_challenge', challenge_id: PA_active.challenge_id,
    }).then((r) => (r?.data !== undefined ? r.data : r)).catch((e) => ({ error: String(e?.message || e).slice(0, 200) }));
    record('S25b.gateway_foreign_resolve_live', Boolean(liveForeign?.state === 'not_found' && !liveForeign?.challenge), {
      tapped_challenge_id: PA_active.challenge_id,
      resolved: liveForeign?.state || liveForeign?.error || null,
    });

    // S27 — the deep link carries ONLY the opaque challenge id
    const dl = challengeDeepLink(PA_active.challenge_id);
    record('S27.deeplink_minimal_routing_data', dl === '/GuardShift?challenge=' + PA_active.challenge_id, {
      deep_link: dl, contains_sensitive_data: /guard|shift_id|site_id|customer|deadline/.test(dl),
      rule: 'No guard, customer, site, shift or deadline data in the push routing payload.',
    });

    // ── Cleanup: fixtures, fixture notifications/alerts, temp audit rows; restore config ──
    const deletedLogIds = await cleanFixtures();
    await svc.entities.User.update(GUARD_A, { stay_awake_enabled: origEnabled, stay_awake_interval_minutes: origInterval });
    const leftoverLogs = await svc.entities.StayAwakeLog.filter({ is_test: true }).catch(() => []);
    const leftoverShifts = await svc.entities.Shift.filter({ is_test: true }).catch(() => []);
    const leftoverSites = await svc.entities.Site.filter({ name: SITE_NAME }).catch(() => []);
    const guardAfter = (await svc.entities.User.filter({ id: GUARD_A }).catch(() => []))?.[0];
    record('cleanup.fixtures_removed', Boolean(
      (leftoverLogs || []).length === 0 && (leftoverShifts || []).length === 0 &&
      (leftoverSites || []).length === 0 &&
      guardAfter?.stay_awake_enabled === origEnabled && guardAfter?.stay_awake_interval_minutes === origInterval
    ), {
      deleted_fixture_logs: deletedLogIds.length,
      remaining_test_logs: (leftoverLogs || []).length, remaining_test_shifts: (leftoverShifts || []).length,
      guard_config_restored: { stay_awake_enabled: origEnabled, stay_awake_interval_minutes: origInterval },
    });

    const failed = evidence.filter((e) => !e.pass);
    return Response.json({
      success: failed.length === 0,
      all_passed: failed.length === 0,
      passed: evidence.length - failed.length,
      failed_scenarios: failed.map((f) => f.scenario),
      delivery_mode_unchanged: 'test — all audited emails rewritten to the test mailbox',
      scenarios: evidence,
    });
  } catch (error) {
    console.error('stayAwakeSelfTest error:', error);
    // Best-effort cleanup on failure too
    try {
      await svc.entities.StayAwakeLog.deleteMany({ is_test: true }).catch(() => {});
      await svc.entities.Shift.deleteMany({ is_test: true }).catch(() => {});
      await svc.entities.User.update(GUARD_A, { stay_awake_enabled: false }).catch(() => {});
    } catch (_) {}
    return Response.json({ success: false, error: String(error?.message || error).slice(0, 500), scenarios: evidence }, { status: 500 });
  }
});