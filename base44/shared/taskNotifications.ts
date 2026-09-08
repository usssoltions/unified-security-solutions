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

export async function sendTaskEmail(svc, { to, subject, body, html, from_name }) {
  if (!to) return false;
  try {
    const payload = { to, subject, from_name: from_name || 'Task Scheduling' };
    // Branded HTML email: html is the rich body, body rides along as the
    // plain-text alternative (multipart/alternative). Plain send keeps body.
    if (html) { payload.html = html; payload.text = body; }
    else { payload.body = body; }
    await svc.integrations.Core.SendEmail(payload);
    return true;
  } catch (e) {
    console.error('task email failed:', e?.message || e);
    return false;
  }
}

export async function sendTaskTelegram(secrets, chatId, text) {
  if (!chatId) return false;
  const token = secrets.get('TELEGRAM_BOT_TOKEN');
  if (!token) return false;
  try {
    const res = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
    return res.ok;
  } catch (e) {
    console.error('task telegram failed:', e?.message || e);
    return false;
  }
}

/** Sends one notification to every recipient via email + Telegram.
 * emailHtml (the branded template rendering) rides along as the rich body
 * with emailBody as the plain-text alternative; from_name brands the sender. */
export async function notifyTaskRecipients(svc, secrets, recipients, { subject, emailBody, emailHtml, telegramText, from_name }) {
  const out = { email: 0, telegram: 0 };
  for (const r of recipients) {
    if (r.email && await sendTaskEmail(svc, { to: r.email, subject, body: emailBody, html: emailHtml, from_name })) out.email++;
    if (r.telegram_chat_id && await sendTaskTelegram(secrets, r.telegram_chat_id, telegramText)) out.telegram++;
  }
  return out;
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