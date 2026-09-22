/**
 * Task Scheduling module — OWN notification + audit infrastructure.
 *
 * MODULAR INDEPENDENCE (production requirement): the two-hour reminders,
 * immediate completion notifications and the deadline Task Completion Report
 * are MANDATORY Task Scheduling functionality. They are therefore delivered
 * by this module's OWN infrastructure — Base44 Core.SendEmail (platform-core
 * shared email) and the Telegram Bot API (platform-core shared Telegram) —
 * and NEVER depend on the separate Notification Engine module
 * (sendComprehensiveNotification), which may be disabled for a customer.
 */

import { resolveTenantBrand, tenantDisplayName } from './tenantBranding.ts';
import { sendNativePush } from './nativePush.ts';
import { sendAuditedEmail } from './auditedEmail.ts';

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg, UTC+2, no DST

/** Current SAST wall clock as ISO (used for date/time-window maths only). */
export function sastNowIso() {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString();
}

/** SAST calendar date (YYYY-MM-DD) for "today". */
export function sastTodayYmd() {
  return sastNowIso().slice(0, 10);
}

/** SAST time-of-day minutes since midnight. */
export function sastNowMinutes() {
  const iso = sastNowIso();
  return Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
}

/**
 * UTC instant for a SAST wall-clock date + HH:MM.
 * Operational times (batch windows, task times) are SAST wall-clock values;
 * comparing them against Date.now() requires this explicit +02:00 parse.
 */
export function sastInstantYmd(dateYmd, timeHHMM) {
  return Date.parse(dateYmd + 'T' + timeHHMM + ':00+02:00');
}

/** ── Delivery channels (module-owned) ─────────────────────────────────── */

export async function sendTaskEmail(svc, { to, subject, body, html, from_name, brand, customer_id, reseller_id, reference_id }) {
  if (!to) return false;
  try {
    // GUARDED AUDITED DELIVERY — the delivery-mode guard applies to Task
    // Scheduling emails exactly like every other channel (test-mode rewrite
    // to the allowlisted mailbox, '[TEST]' subjects, fail-closed test data).
    const res = await sendAuditedEmail(svc, {
      to, subject,
      ...(html ? { html, text: body } : { body }),
      from_name: from_name || 'Task Scheduling',
      brand, customer_id: customer_id || null, reseller_id: reseller_id || null,
      event_type: 'task_scheduling',
      reference_id: reference_id || null,
      template_name: 'task_scheduling',
    });
    return !!res.ok;
  } catch (e) {
    console.error('task email failed:', e?.message || e);
    return false;
  }
}

export async function sendTaskTelegram(secrets, chatId, text, button) {
  if (!chatId) return false;
  const token = secrets.get('TELEGRAM_BOT_TOKEN');
  if (!token) return false;
  const t0 = Date.now();
  try {
    const payload = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
    // Optional INLINE URL ACTION button (e.g. REVIEW & VERIFY TASK). Plain
    // sendMessage with reply_markup only — no media, no parse-mode change,
    // so delivery reliability is exactly the same as the working text path.
    if (button && button.text && button.url) {
      payload.reply_markup = { inline_keyboard: [[{ text: String(button.text).slice(0, 64), url: button.url }]] };
    }
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // DELIVERY LOGGING — send-request timing, HTTP status, Telegram message
    // id and any API error, so delivery delay/failure is diagnosable from
    // the function logs. Never affects the boolean result.
    let body = null;
    try { body = await res.json(); } catch (_) { /* non-JSON response */ }
    console.log('[telegram] send', JSON.stringify({
      chat_id: chatId, request_ms: Date.now() - t0, http_status: res.status,
      telegram_ok: !!(body && body.ok),
      message_id: (body && body.result && body.result.message_id) || null,
      error: (body && body.description) || null,
    }));
    return res.ok;
  } catch (e) {
    console.error('[telegram] send failed', JSON.stringify({ chat_id: chatId, request_ms: Date.now() - t0, error: e?.message || e }));
    return false;
  }
}

/** Telegram delivery with EVENT-KEY + CHAT idempotency. When several
 * same-tenant app users share ONE physical Telegram chat (the verified
 * shared-chat mapping), the SAME logical event (event_key) reaches that chat
 * exactly once — per-user in-app records, per-user email and per-user audit
 * recipient records stay separate. Every attempt is logged to
 * NotificationDelivery (channel 'telegram'). */
export async function sendTaskTelegramDeduped(svc, secrets, eventKey, chatId, text, button) {
  if (!chatId) return false;
  const idempKey = String(eventKey || ('tg_' + Date.now())) + ':tg:' + chatId;
  try {
    const existing = await svc.entities.NotificationDelivery.filter(
      { idempotency_key: idempKey }, '-created_date', 1).catch(() => []);
    if (existing && existing.length && existing[0].status === 'sent') return true;
  } catch (_) { /* idempotency check failure never blocks delivery */ }
  // CONSERVATIVE RETRY — one immediate re-attempt on failure. A message
  // Telegram has already CONFIRMED is never re-sent (idempotency above); a
  // still-failing send is recorded 'failed' and the next sweep run
  // re-attempts it (idempotency only skips status 'sent').
  let ok = await sendTaskTelegram(secrets, chatId, text, button);
  let retries = 0;
  if (!ok) { retries = 1; ok = await sendTaskTelegram(secrets, chatId, text, button); }
  try {
    await svc.entities.NotificationDelivery.create({
      event_key: eventKey || ('telegram_' + Date.now()),
      channel: 'telegram',
      status: ok ? 'sent' : 'failed',
      recipient_id: chatId,
      send_time: new Date().toISOString(),
      idempotency_key: idempKey,
      retries,
      provider_response: ok ? 'accepted' : 'failed after 1 immediate retry',
    });
  } catch (_) { /* delivery logging must never break the notification */ }
  return ok;
}

/** Sends one notification to every recipient via email + Telegram +
 * NATIVE PUSH (shared platform service — reaches the phone with the app
 * closed). emailHtml (the branded template rendering) rides along as the
 * rich body with emailBody as the plain-text alternative; from_name brands
 * the sender. Native push fires only when pushTitle/pushBody are provided;
 * eventKey makes every channel idempotent per recipient (refresh/API/sweep
 * retries can never double-send). */
export async function notifyTaskRecipients(svc, secrets, recipients, { subject, emailBody, emailHtml, telegramText, from_name,
    eventKey, actionUrl, pushTitle, pushBody, telegramButton, push = true, priority = 'normal', customerId, resellerId }) {
  const out = { email: 0, telegram: 0, push: 0 };
  for (const r of recipients) {
    if (r.email && await sendTaskEmail(svc, { to: r.email, subject, body: emailBody, html: emailHtml, from_name })) out.email++;
    if (r.telegram_chat_id) {
      // SAME-CHAT DEDUPLICATION: when several same-tenant users share ONE
      // physical Telegram chat, the same logical event (event_key) reaches
      // that chat exactly once — per-user in-app/email/audit records stay
      // separate. Callers without an event key send per recipient as before.
      // telegramButton (optional) adds the DIRECT inline URL action.
      const tgOk = eventKey
        ? await sendTaskTelegramDeduped(svc, secrets, eventKey, r.telegram_chat_id, telegramText, telegramButton)
        : await sendTaskTelegram(secrets, r.telegram_chat_id, telegramText, telegramButton);
      if (tgOk) out.telegram++;
    }
    if (push && r.id && pushTitle && pushBody) {
      const pr = await sendNativePush(svc, {
        user_id: r.id, title: pushTitle, body: pushBody,
        priority, action_label: 'Open', action_url: actionUrl,
        event_key: eventKey || null,
        customer_id: customerId || null, reseller_id: resellerId || null,
      }).catch(() => ({ status: 'failed' }));
      if (pr && pr.status === 'sent') out.push++;
    }
  }
  return out;
}

/** ONE-SHOT multi-channel task event: the WHOLE event (email + Telegram +
 * push; per-recipient in-app records are created by the caller) is
 * dispatched at most ONCE per event key. A NotificationDelivery marker
 * (channel 'task_event', idempotency 'task_event:<eventKey>') makes later
 * sweep runs skip it entirely — an immediate deadline-threshold alert can
 * never be re-sent as a duplicate, even though the sweep re-evaluates the
 * same batch every 30 minutes. Used ONLY for deadline-crossing events
 * (guard task overdue, verification overdue) — the 2-hour reminder cadence
 * keeps its own per-cycle event keys. */
export async function notifyTaskRecipientsOnce(svc, secrets, recipients, opts) {
  const eventKey = String((opts && opts.eventKey) || ('task_event_' + Date.now()));
  const markerKey = 'task_event:' + eventKey;
  try {
    const seen = await svc.entities.NotificationDelivery.filter(
      { idempotency_key: markerKey }, '-created_date', 1).catch(() => []);
    if (seen && seen.length) return { email: 0, telegram: 0, push: 0, skipped: true };
  } catch (_) { /* idempotency check failure never blocks a first delivery */ }
  const sent = await notifyTaskRecipients(svc, secrets, recipients, opts);
  try {
    await svc.entities.NotificationDelivery.create({
      event_key: eventKey,
      channel: 'task_event',
      status: 'sent',
      recipient_id: 'event',
      send_time: new Date().toISOString(),
      idempotency_key: markerKey,
      retries: 0,
      provider_response: 'email:' + sent.email + ' telegram:' + sent.telegram + ' push:' + sent.push,
    });
  } catch (_) { /* marker logging must never break the notification */ }
  return sent;
}

/**
 * Resolves the effective tenant brand context (customer → reseller →
 * platform default) for one customer. Used by every Task Scheduling email
 * path so the whole module shares the tenant's branding uniformly.
 */
export async function resolveTaskBrandContext(svc, customerId) {
  const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
  const customer = (custRows && custRows[0]) || null;
  let reseller = null;
  if (customer && customer.reseller_id) {
    const rRows = await svc.entities.Reseller.filter({ id: customer.reseller_id }).catch(() => []);
    reseller = (rRows && rRows[0]) || null;
  }
  return {
    customer, reseller,
    brand: resolveTenantBrand(customer, reseller),
    brandName: tenantDisplayName(customer, reseller) || 'Task Scheduling',
    customerName: (customer && customer.name) || 'Customer',
  };
}

/**
 * Resolves User records for recipient ids, enforcing TENANT ISOLATION:
 * a recipient is only accepted when they belong to the batch's customer
 * (or are a platform admin — oversight). Foreign-tenant ids are dropped.
 */
export async function resolveTaskRecipients(svc, customerId, userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await svc.entities.User.filter({ id: { $in: ids } }).catch(() => []);
  return (rows || [])
    .filter((u) => u.customer_id === customerId || u.admin_level === 'platform' || u.role_type === 'platform_admin')
    .map((u) => ({
      id: u.id,
      name: u.display_name || u.full_name || u.email,
      email: u.email,
      status: u.status || null,
      telegram_chat_id: (u.telegram_connected && u.telegram_notifications_enabled !== false) ? (u.telegram_chat_id || null) : null,
    }));
}

/** ── Audit (PlatformAuditLog — platform-core shared infrastructure) ────── */

export async function logTaskAudit(svc, { event_type, actor, task, batch, from_status, to_status, notes }) {
  try {
    await svc.entities.PlatformAuditLog.create({
      event_type,
      user_id: actor?.id || 'system',
      user_name: actor?.display_name || actor?.full_name || actor?.email || 'Task Scheduling Automation',
      customer_id: (task && task.customer_id) || (batch && batch.customer_id) || null,
      reseller_id: (task && task.reseller_id) || (batch && batch.reseller_id) || null,
      module_key: 'TASK_SCHEDULING',
      entity_name: task ? 'OperationalTask' : 'TaskBatch',
      entity_id: (task && task.id) || (batch && batch.id) || null,
      action: from_status ? from_status + ' -> ' + to_status : (to_status || ''),
      old_values: from_status ? JSON.stringify({ status: from_status }) : null,
      new_values: to_status ? JSON.stringify({ status: to_status }) : null,
      notes: notes || null,
    });
  } catch (e) {
    console.error('task audit failed:', e?.message || e);
  }
}

/** Audit for control-room level events (no task/batch record). */
export async function logTaskScopeAudit(svc, { event_type, actor, customerId, resellerId, controlId, notes }) {
  try {
    await svc.entities.PlatformAuditLog.create({
      event_type,
      user_id: actor?.id || 'system',
      user_name: actor?.display_name || actor?.full_name || actor?.email || 'Task Scheduling Automation',
      customer_id: customerId || null,
      reseller_id: resellerId || null,
      module_key: 'TASK_SCHEDULING',
      entity_name: 'ControlRoom',
      entity_id: controlId || null,
      action: '',
      notes: notes || null,
    });
  } catch (e) {
    console.error('task scope audit failed:', e?.message || e);
  }
}