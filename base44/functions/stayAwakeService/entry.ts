/**
 * stayAwakeService — SERVER-AUTHORITATIVE Stay Awake (fatigue check) gateway.
 *
 * SECURITY CONTRACT
 * ──────────────────
 *  • Prompts are issued ONLY by the monitor sweep (runAllMonitors tick, which
 *    invokes action 'sweep'), and ONLY for shifts that are status 'active'
 *    WITH a clock-in and WITHOUT a clock-out — no prompt can ever precede
 *    clock-in or survive clock-out, shift completion, cancellation or
 *    reassignment (the shift is reloaded fresh at every decision).
 *  • Guard, shift, site, customer and reseller are resolved SERVER-SIDE from
 *    the authoritative shift + user records. Browser-supplied identity is
 *    never read.
 *  • Every prompt carries a unique server-generated challenge_id and a
 *    server-issued expires_at; acknowledgement revalidates ownership, prompt
 *    state, expiry AND the live shift before stamping response time/status.
 *    Acknowledgement is idempotent (replaying an already-acknowledged own
 *    prompt succeeds without side effects); stale/forged/replayed-for-another
 *    acknowledgements are rejected.
 *  • Missed prompts escalate ONLY to same-tenant authorized management roles
 *    (control-room narrowed), one Notification per recipient, deduplicated
 *    across sweep retries on every channel. Branding is customer → reseller
 *    → platform. Emails go through the shared audited email helper.
 *  • Configuration changes (per-guard enable + interval) are validated:
 *    management roles only, same-tenant guards only, interval clamped.
 *  • LATE/OFFLINE RESPONSE RULE (documented): an acknowledgement is valid
 *    only before the server-issued deadline. A device that was offline and
 *    responds after expiry receives PROMPT_EXPIRED — the missed outcome and
 *    its escalation stand, and the guard's cycle resets with the next
 *    scheduled prompt. No late acknowledgement can reverse or split a
 *    missed outcome, and no expired challenge can be acknowledged as
 *    current.
 *
 * ACTIONS
 *  • sweep       — platform/monitor only: cancel voided prompts, mark missed
 *                  (+ escalate), issue due prompts (+ critical push).
 *  • acknowledge — the guard: idempotent own-prompt acknowledgement.
 *  • configure   — management roles: per-guard enable/interval.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { secrets } from 'base44:runtime';
import {
  RESPONSE_TIMEOUT_SECONDS, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES,
  MANAGEMENT_ROLES, isPlatformUser, evaluateAck, classifyAckStale,
  ackCas, missedCas, isEscalationRecipient,
  promptPushEventKey, missedEventKey, missedEmailIdemKey,
} from '../../shared/stayAwakeCore.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    // ─────────────────────────────────────────────────────────────────────
    // SWEEP — monitor only (platform administration; the Combined Monitor
    // workflow's authenticated invocation).
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'sweep') {
      const user = await resolveTenantCaller(base44);
      if (!user || !isPlatformUser(user)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      const now = new Date();
      const results = { cancelled: 0, missed: 0, escalated: 0, issued: 0, skipped: 0 };

      const [allLogs, activeShifts, enabledGuards, allUsers] = await Promise.all([
        svc.entities.StayAwakeLog.list('-alert_time', 1000).catch(() => []),
        svc.entities.Shift.filter({ status: 'active' }).catch(() => []),
        svc.entities.User.filter({ stay_awake_enabled: true }).catch(() => []),
        svc.entities.User.list().catch(() => []),
      ]);
      const shiftById = new Map((activeShifts || []).map((s) => [s.id, s]));
      const enabledById = new Set((enabledGuards || []).map((u) => u.id));
      const logs = allLogs || [];
      const pending = logs.filter((l) => l.status === 'sent');
      const latestByShift = new Map();
      for (const l of logs) {
        if (!latestByShift.has(l.shift_id)) latestByShift.set(l.shift_id, l); // sorted desc
      }

      // 1) CANCEL prompts whose shift is no longer an active clocked-in shift
      //    assigned to the same guard (clock-out, completion, cancellation,
      //    reassignment). Cancelled prompts are NEVER escalated.
      for (const log of pending) {
        const shift = shiftById.get(log.shift_id);
        // A pending prompt is also voided the moment Stay Awake monitoring is
        // DISABLED for its guard — a disabled guard can never drift into a
        // 'missed' escalation (disablement cancels pending/future checks).
        const guardStillMonitored = enabledById.has(log.guard_id);
        const stillValid = guardStillMonitored && shift &&
          shift.guard_id === log.guard_id &&
          shift.clock_in?.timestamp &&
          !shift.clock_out?.timestamp;
        if (stillValid) continue;
        await svc.entities.StayAwakeLog.update(log.id, { status: 'cancelled' }).catch(() => {});
        results.cancelled++;
      }

      // 2) MISSED — still-valid prompts past their server deadline. Mark once,
      //    escalate once (dedupe on every channel; the status transition itself
      //    guards double escalation between concurrent sweeps).
      for (const log of pending) {
        const shift = shiftById.get(log.shift_id);
        const guardStillMonitored = enabledById.has(log.guard_id);
        const stillValid = guardStillMonitored && shift &&
          shift.guard_id === log.guard_id &&
          shift.clock_in?.timestamp &&
          !shift.clock_out?.timestamp;
        if (!stillValid) continue; // handled by cancel above
        if (!log.expires_at || new Date(log.expires_at) > now) continue;
        // ATOMIC CAS TRANSITION — the conditional update matches the EXACT
        // challenge id, requires status to STILL be 'sent' and the STORED
        // deadline to be expired, then flips pending → missed and stamps
        // missed_at server-side in ONE operation. A concurrent worker that
        // already transitioned this record matches ZERO rows and continues
        // without escalating — exactly one missed outcome per challenge.
        const cas = await svc.entities.StayAwakeLog.updateMany(
          missedCas.query({ logId: log.id, nowIso: now.toISOString() }),
          missedCas.set({ nowIso: now.toISOString() })
        ).catch(() => null);
        if (!cas || !cas.updated) continue;
        // Only escalate if THIS run performed the transition (a concurrent
        // sweep may have marked it first — re-read and check status came back
        // as missed with our update; the per-recipient Notification check below
        // is the final dedupe).
        results.missed++;
        try {
          await escalateMissed(svc, { log, shift, allUsers, results });
        } catch (e) {
          console.error('stayAwake escalation failed:', e.message);
        }
      }

      // 3) ISSUE — one prompt per due shift. Due = active + clocked-in + no
      //    clock-out + guard has Stay Awake enabled + no pending prompt +
      //    the configured interval has elapsed since the last prompt/response
      //    (or since clock-in when none). Catch-up safe: a delayed sweep never
      //    issues obsolete prompts — the shift is reloaded above and any shift
      //    that ended is simply absent from the map.
      results.skip_reasons = [];
      results.create_errors = [];
      for (const shift of activeShifts || []) {
        if (!shift.guard_id || !shift.clock_in?.timestamp || shift.clock_out?.timestamp) continue;
        if (!enabledById.has(shift.guard_id)) {
          results.skipped++; results.skip_reasons.push(`${shift.id}:guard_not_enabled:${shift.guard_id}`); continue;
        }
        const guard = (allUsers || []).find((u) => u.id === shift.guard_id);
        const intervalMinutes = Math.min(MAX_INTERVAL_MINUTES,
          Math.max(MIN_INTERVAL_MINUTES, Number(guard?.stay_awake_interval_minutes) || 30));
        const latest = latestByShift.get(shift.id);
        if (latest && latest.status === 'sent') {
          results.skipped++; results.skip_reasons.push(`${shift.id}:pending_prompt`); continue;
        }
        const reference = latest
          ? new Date(latest.response_time || latest.alert_time)
          : new Date(shift.clock_in.timestamp);
        if ((now - reference) < intervalMinutes * 60000) {
          results.skipped++; results.skip_reasons.push(`${shift.id}:interval_not_elapsed`); continue;
        }
        const challengeId = crypto.randomUUID();
        const expiresAt = new Date(now.getTime() + RESPONSE_TIMEOUT_SECONDS * 1000);
        const isTestFixture = shift.is_test === true;
        const prompt = await svc.entities.StayAwakeLog.create({
          customer_id: shift.customer_id || undefined,
          reseller_id: shift.reseller_id || undefined,
          guard_id: shift.guard_id,
          guard_name: shift.guard_name || guard?.display_name || guard?.full_name || 'Guard',
          shift_id: shift.id,
          site_id: shift.site_id || undefined,
          site_name: shift.site_name || undefined,
          challenge_id: challengeId,
          alert_time: now.toISOString(),
          expires_at: expiresAt.toISOString(),
          status: 'sent',
          is_test: isTestFixture || undefined,
        }).catch((e) => {
          results.create_errors.push(String(e?.message || e).slice(0, 200));
          return null;
        });
        if (!prompt) { results.skipped++; results.skip_reasons.push(`${shift.id}:create_failed`); continue; }
        // CONCURRENT-ISSUANCE RECONCILE: two overlapping monitor executions
        // can both observe "no pending prompt" and both create one. The
        // earliest-issued prompt wins; later duplicates are deleted, so a
        // guard is never shown two challenges for one interval and monitor
        // retries can never issue overlapping challenges.
        const openForShift = await svc.entities.StayAwakeLog.filter({
          shift_id: shift.id, status: 'sent',
        }).catch(() => []);
        const duplicates = (openForShift || []).filter((p) => p.id !== prompt.id);
        const lostRace = duplicates.some((d) => new Date(d.alert_time) <= new Date(prompt.alert_time));
        if (lostRace) {
          await svc.entities.StayAwakeLog.delete(prompt.id).catch(() => {});
          results.skipped++; results.skip_reasons.push(`${shift.id}:concurrent_duplicate`);
          continue;
        } else if (duplicates.length) {
          await Promise.all(duplicates.map((d) => svc.entities.StayAwakeLog.delete(d.id).catch(() => {})));
        }
        results.issued++;
        // Critical native push so a backgrounded/locked device can still be
        // woken; the in-app overlay appears via the guard's realtime
        // subscription to their own StayAwakeLog records. Test fixtures
        // NEVER wake a real device.
        if (!isTestFixture) {
          await sendNativePush(svc, {
            user_id: shift.guard_id,
            title: '⚡ Stay Awake Check',
            body: 'Confirm you are alert now — open the app and acknowledge.',
            priority: 'critical',
            action_label: 'Open My Shift', action_url: '/GuardShift',
            event_key: promptPushEventKey(prompt.id),
            customer_id: shift.customer_id || undefined,
            reseller_id: shift.reseller_id || undefined,
          }).catch(() => {});
        }
      }

      return Response.json({ success: true, results });
    }

    // ─────────────────────────────────────────────────────────────────────
    // ACKNOWLEDGE — the guard, own prompt only, before expiry, idempotent.
    // Accepts ONLY the log id (+ optional location as permitted actor input).
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'acknowledge') {
      const caller = await resolveTenantCaller(base44);
      if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const logId = String(body?.log_id || '');
      if (!logId) return Response.json({ error: 'Missing log_id' }, { status: 400 });

      const rows = await svc.entities.StayAwakeLog.filter({ id: logId }).catch(() => []);
      const log = rows?.[0];
      const now = new Date();
      if (!log) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });

      // PURE DECISION CORE — classification from the authoritative prompt
      // record plus the LIVE shift record (both re-read server-side above).
      const shiftRows = await svc.entities.Shift.filter({ id: String(log.shift_id) }).catch(() => []);
      const decision = evaluateAck({ log, callerId: caller.id, shift: shiftRows?.[0], now });
      if (decision.error === 'FORBIDDEN') {
        return Response.json({ error: 'FORBIDDEN' }, { status: 403 }); // not your prompt
      }
      if (decision.ok && decision.already) {
        return Response.json({ success: true, already: true }); // idempotent replay
      }
      if (decision.error === 'PROMPT_NO_LONGER_ACTIVE') {
        return Response.json({ error: 'PROMPT_NO_LONGER_ACTIVE', status: log.status }, { status: 409 });
      }
      if (decision.error === 'PROMPT_EXPIRED') {
        return Response.json({ error: 'PROMPT_EXPIRED' }, { status: 409 }); // documented late rule; sweep marks missed
      }
      if (decision.error === 'SHIFT_NO_LONGER_ACTIVE') {
        // The LIVE shift is no longer an active clocked-in shift assigned to
        // the acknowledging guard (ended / clocked out / reassigned).
        await svc.entities.StayAwakeLog.update(log.id, { status: 'cancelled' }).catch(() => {});
        return Response.json({ error: 'SHIFT_NO_LONGER_ACTIVE' }, { status: 409 });
      }

      const permittedLocation =
        body?.location && Number.isFinite(Number(body.location?.lat)) && Number.isFinite(Number(body.location?.lng))
          ? { lat: Number(body.location.lat), lng: Number(body.location.lng) }
          : undefined;
      // ATOMIC CAS ACKNOWLEDGEMENT — ownership (guard_id), still-'sent' and
      // not-expired are enforced by the UPDATE CONDITION itself: two rapid
      // taps, an offline double-send or a concurrent sweep resolve to exactly
      // ONE acknowledged transition with the server-stamped response time.
      const cas = await svc.entities.StayAwakeLog.updateMany(
        ackCas.query({ logId: log.id, callerId: caller.id, nowIso: now.toISOString() }),
        ackCas.set({ nowIso: now.toISOString(), responseSeconds: decision.responseSeconds, location: permittedLocation })
      ).catch(() => null);
      if (!cas || !cas.updated) {
        // Lost the race — classify from the authoritative record (idempotent
        // replay, documented late rule, or inactive) and NEVER re-stamp.
        const fresh = (await svc.entities.StayAwakeLog.filter({ id: log.id }).catch(() => []))?.[0];
        const stale = classifyAckStale({ fresh, now });
        if (stale === 'already') return Response.json({ success: true, already: true });
        if (stale === 'expired') return Response.json({ error: 'PROMPT_EXPIRED' }, { status: 409 });
        return Response.json({ error: 'PROMPT_NO_LONGER_ACTIVE', status: fresh?.status || log.status }, { status: 409 });
      }
      return Response.json({ success: true, response_time_seconds: decision.responseSeconds });
    }

    // ─────────────────────────────────────────────────────────────────────
    // CONFIGURE — authorized management roles only, same-tenant guards only.
    // ─────────────────────────────────────────────────────────────────────
    if (action === 'configure') {
      const caller = await resolveTenantCaller(base44);
      if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      const isManagement = isPlatformUser(caller) ||
        (MANAGEMENT_ROLES.includes(caller.role_type) &&
          (Boolean(caller.admin_level) || Boolean(caller.customer_id)));
      if (!isManagement) return Response.json({ error: 'Forbidden' }, { status: 403 });

      const guardId = String(body?.guard_id || '');
      if (!guardId) return Response.json({ error: 'Missing guard_id' }, { status: 400 });
      const guardRows = await svc.entities.User.filter({ id: guardId }).catch(() => []);
      const guard = guardRows?.[0];
      if (!guard) return Response.json({ error: 'GUARD_NOT_FOUND' }, { status: 404 });
      // Tenant isolation: non-platform managers may only configure guards in
      // their own customer (or, for reseller admins, their own reseller).
      if (!isPlatformUser(caller)) {
        const sameTenant = caller.customer_id && guard.customer_id === caller.customer_id;
        const resellerOk = caller.admin_level === 'reseller' && caller.reseller_id &&
          guard.reseller_id === caller.reseller_id;
        if (!sameTenant && !resellerOk) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      const enabled = Boolean(body?.stay_awake_enabled);
      const interval = Math.min(MAX_INTERVAL_MINUTES,
        Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(body?.stay_awake_interval_minutes) || 30)));
      await svc.entities.User.update(guard.id, {
        stay_awake_enabled: enabled,
        stay_awake_interval_minutes: interval,
      });
      return Response.json({ success: true, guard_id: guard.id, stay_awake_enabled: enabled, stay_awake_interval_minutes: interval });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('stayAwakeService error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * escalateMissed — same-tenant authorized recipients only, one Notification
 * per recipient, deduplicated across sweep retries on every channel.
 */
async function escalateMissed(svc, { log, shift, allUsers, results }) {
  const scope = { customer_id: shift?.customer_id || log.customer_id || null, site_id: shift?.site_id || null };
  const brand = await resolveCommunicationBrand(svc, {
    customer_id: shift?.customer_id || log.customer_id || null,
    reseller_id: shift?.reseller_id || log.reseller_id || null,
  });
  const title = '⚠️ Missed Stay Awake Check';
  const bodyText = `${log.guard_name || 'Guard'} did not acknowledge the stay awake check at ${log.site_name || shift?.site_name || 'site'} — verify immediately.`;

  // Server-side tenant-scoped recipient resolution + control-room narrowing.
  const candidates = (allUsers || []).filter((u) => isEscalationRecipient(u, scope));
  const recipients = await narrowControlRoomOperators(svc, candidates, scope);
  // Test fixtures never reach real devices or chats: native push and Telegram
  // are suppressed; in-app notifications to test-tenant test users and the
  // audited email (rewritten to the test mailbox by the delivery guard)
  // remain, so escalation evidence is still produced and audited.
  const isFixture = log.is_test === true;

  // Tenant-stamped operational alert (RLS-scoped tenant visibility).
  const existingAlerts = await svc.entities.Alert.filter({
    type: 'stay_awake', shift_id: log.shift_id, status: 'active',
  }).catch(() => []);
  if (!(existingAlerts || []).some((a) => a.metadata?.stay_awake_log_id === log.id)) {
    await svc.entities.Alert.create({
      type: 'stay_awake', priority: 'critical',
      title: '⚠️ MISSED STAY AWAKE RESPONSE',
      message: bodyText,
      guard_id: log.guard_id, guard_name: log.guard_name,
      site_id: log.site_id || undefined,
      shift_id: log.shift_id, status: 'active',
      customer_id: log.customer_id || undefined,
      reseller_id: log.reseller_id || undefined,
      metadata: { stay_awake_log_id: log.id },
    }).catch(() => {});
  }

  const tpl = buildBrandedEmail({
    brand,
    heading: title,
    greeting: 'Hello,',
    intro: 'A guard missed their stay awake check and requires immediate follow-up.',
    details: [
      { label: 'Guard', value: log.guard_name || 'N/A' },
      { label: 'Site', value: log.site_name || shift?.site_name || 'N/A' },
      { label: 'Issued', value: new Date(log.alert_time).toLocaleString('en-ZA') },
      { label: 'Deadline', value: log.expires_at ? new Date(log.expires_at).toLocaleString('en-ZA') : 'N/A' },
      { label: 'Outcome', value: 'NO RESPONSE' },
    ],
    closing: 'Please contact the guard and verify their wellbeing immediately.',
  });

  for (const r of recipients) {
    // IN-APP — one record per recipient, deduped on sweep retries
    const prior = await svc.entities.Notification.filter({
      related_entity: 'StayAwakeLog', related_id: log.id, recipient_id: r.id,
    }).catch(() => []);
    if (!(prior || []).length) {
      await svc.entities.Notification.create({
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name,
        type: 'system', priority: 'critical',
        title, message: bodyText, read: false,
        related_entity: 'StayAwakeLog', related_id: log.id,
        action_url: '/Scheduling', sent_via: ['in_app'],
        customer_id: log.customer_id || undefined,
        reseller_id: log.reseller_id || undefined,
      }).catch(() => {});
    }
    // NATIVE PUSH — deterministic event key dedupes sweep retries. Test
    // fixtures never wake a real device.
    if (!isFixture) {
      await sendNativePush(svc, {
        user_id: r.id,
        title, body: bodyText, priority: 'critical',
        action_label: 'Open Scheduling', action_url: '/Scheduling',
        event_key: missedEventKey(log.id),
        customer_id: log.customer_id || undefined,
        reseller_id: log.reseller_id || undefined,
      }).catch(() => {});
    }
    // TELEGRAM — verified per-user mapping, deduped. Test fixtures never
    // reach a real chat.
    if (!isFixture && r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
      await sendTaskTelegramDeduped(svc, secrets, missedEventKey(log.id),
        r.telegram_chat_id,
        buildBrandedTelegram({ brand, heading: title, details: [
          { label: 'Guard', value: log.guard_name || 'N/A' },
          { label: 'Site', value: log.site_name || 'N/A' },
        ], closing: bodyText }))
        .catch(() => {});
    }
    // EMAIL — audited, branded, idempotent
    if (r.email) {
      await sendAuditedEmail(svc, {
        to: r.email,
        subject: `${title} — ${log.site_name || 'site'}`,
        html: tpl.html,
        brand,
        customer_id: log.customer_id || null,
        reseller_id: log.reseller_id || null,
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name || null,
        event_type: 'stay_awake_missed',
        reference_id: log.id,
        // Escalation idempotency: exactly ONE missed-check email per
        // recipient per challenge, even across concurrent sweep retries.
        idempotency_key: missedEmailIdemKey(log.id, r.id || r.email),
      }).catch(() => {});
    }
    results.escalated++;
  }
}