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

const RESPONSE_TIMEOUT_SECONDS = 60; // server-authoritative acknowledge window
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 120;
const MANAGEMENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];
const isPlatformUser = (u) =>
  u?.role_type === 'admin' || u?.role_type === 'platform_admin' || u?.admin_level === 'platform';

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
        const stillValid = shift &&
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
        const stillValid = shift &&
          shift.guard_id === log.guard_id &&
          shift.clock_in?.timestamp &&
          !shift.clock_out?.timestamp;
        if (!stillValid) continue; // handled by cancel above
        if (!log.expires_at || new Date(log.expires_at) > now) continue;
        const updated = await svc.entities.StayAwakeLog.update(log.id, {
          status: 'missed',
        }).catch(() => null);
        if (!updated) continue;
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
        }).catch((e) => {
          results.create_errors.push(String(e?.message || e).slice(0, 200));
          return null;
        });
        if (!prompt) { results.skipped++; results.skip_reasons.push(`${shift.id}:create_failed`); continue; }
        results.issued++;
        // Critical native push so a backgrounded/locked device can still be
        // woken; the in-app overlay appears via the guard's realtime
        // subscription to their own StayAwakeLog records.
        await sendNativePush(svc, {
          user_id: shift.guard_id,
          title: '⚡ Stay Awake Check',
          body: 'Confirm you are alert now — open the app and acknowledge.',
          priority: 'critical',
          action_label: 'Open My Shift', action_url: '/GuardShift',
          event_key: 'stayawake_prompt:' + prompt.id,
          customer_id: shift.customer_id || undefined,
          reseller_id: shift.reseller_id || undefined,
        }).catch(() => {});
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
      if (!log) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      if (log.guard_id !== caller.id) {
        return Response.json({ error: 'FORBIDDEN' }, { status: 403 }); // not your prompt
      }
      if (log.status === 'acknowledged') {
        return Response.json({ success: true, already: true }); // idempotent replay
      }
      if (log.status !== 'sent') {
        return Response.json({ error: 'PROMPT_NO_LONGER_ACTIVE', status: log.status }, { status: 409 });
      }
      const now = new Date();
      if (log.expires_at && new Date(log.expires_at) < now) {
        return Response.json({ error: 'PROMPT_EXPIRED' }, { status: 409 }); // sweep will mark missed
      }
      // Revalidate the LIVE shift server-side: still active, still assigned to
      // the acknowledging guard, still clocked in and not clocked out.
      const shiftRows = await svc.entities.Shift.filter({ id: String(log.shift_id) }).catch(() => []);
      const shift = shiftRows?.[0];
      const shiftValid = shift &&
        shift.status === 'active' &&
        shift.guard_id === caller.id &&
        shift.clock_in?.timestamp &&
        !shift.clock_out?.timestamp;
      if (!shiftValid) {
        await svc.entities.StayAwakeLog.update(log.id, { status: 'cancelled' }).catch(() => {});
        return Response.json({ error: 'SHIFT_NO_LONGER_ACTIVE' }, { status: 409 });
      }

      const responseSeconds = Math.max(0, Math.round((now - new Date(log.alert_time)) / 1000));
      const permittedLocation =
        body?.location && Number.isFinite(Number(body.location?.lat)) && Number.isFinite(Number(body.location?.lng))
          ? { lat: Number(body.location.lat), lng: Number(body.location.lng) }
          : undefined;
      await svc.entities.StayAwakeLog.update(log.id, {
        status: 'acknowledged',
        response_time: now.toISOString(),
        response_method: 'button',
        response_time_seconds: responseSeconds,
        ...(permittedLocation ? { location: permittedLocation } : {}),
      });
      return Response.json({ success: true, response_time_seconds: responseSeconds });
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
  const candidates = (allUsers || []).filter((u) =>
    MANAGEMENT_ROLES.includes(u.role_type) &&
    (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
    (isPlatformUser(u) || (scope.customer_id ? u.customer_id === scope.customer_id : false)));
  const recipients = await narrowControlRoomOperators(svc, candidates, scope);

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
    // NATIVE PUSH — deterministic event key dedupes sweep retries
    await sendNativePush(svc, {
      user_id: r.id,
      title, body: bodyText, priority: 'critical',
      action_label: 'Open Scheduling', action_url: '/Scheduling',
      event_key: 'stayawake_missed:' + log.id,
      customer_id: log.customer_id || undefined,
      reseller_id: log.reseller_id || undefined,
    }).catch(() => {});
    // TELEGRAM — verified per-user mapping, deduped
    if (r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
      await sendTaskTelegramDeduped(svc, secrets, 'stayawake_missed:' + log.id,
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
      }).catch(() => {});
    }
    results.escalated++;
  }
}