/**
 * activatePanic — THE ONE central server-side PANIC GATEWAY.
 *
 * Every legitimate Panic trigger in the platform funnels through this single
 * function (Guard Shift panic button, global header panic button, any future
 * operational module). There are NO module-specific panic engines: this
 * gateway authenticates the sender, resolves the authoritative organisation
 * context SERVER-SIDE (never from frontend-supplied recipient lists), creates
 * ONE durable PanicAlert record, resolves the authorised recipients, and fans
 * out in-app + Telegram + email + native push with FULL FAILURE ISOLATION —
 * one channel failing never blocks the others and the panic record always
 * survives.
 *
 * RECIPIENT RESOLUTION (post-module-split role catalog — the regression that
 * silenced production panics was the resolver still matching only the legacy
 * pre-split roles admin/dispatcher/supervisor/estate_manager/management,
 * returning 0 recipients for tenants staffed by control_room_operator /
 * customer_admin):
 *   - Platform sender  → platform-level emergency oversight users only.
 *   - Tenant sender    → same-customer RECIPIENT_ROLES users (customer
 *     admins, control room operators, dispatchers/supervisors/estate
 *     managers), narrowed to the CONTROL ROOM(s) linked to the sender's site
 *     when that linkage exists, so Control Room 1 is not auto-alerted for a
 *     Control Room 2 panic. customer_admins always stay in scope.
 *   - ZERO-RECIPIENT POLICY: there is NO organisational-hierarchy fallback.
 *     A customer panic is NEVER auto-disclosed to reseller administrators,
 *     platform administrators or unrelated management users merely because
 *     the resolver returned zero users. When zero authorised recipients
 *     remain, the panic record is still created and retained, a CRITICAL
 *     PANIC_RECIPIENT_CONFIGURATION_MISSING delivery/configuration failure
 *     is recorded in the platform audit log (panic_id, customer_id, site_id,
 *     control_room_id, sender, timestamp, recipient_count = 0), and the
 *     sender UI is told to show a safe critical state instead of a false
 *     'Control Room has been notified'. Reseller/platform escalation may
 *     happen ONLY via recipients explicitly configured/authorised for that
 *     customer/site/control room — never inferred from hierarchy.
 *
 * TENANT ISOLATION: a customer panic can only ever reach users of the same
 * customer. Cross-tenant recipient
 * ids supplied by callers are ignored completely — recipients are derived
 * from server-side data only.
 *
 * EVENT KEY / IDEMPOTENCY: every channel delivery for one panic uses the
 * deterministic logical event key 'panic:<panicId>'. Telegram is deduplicated
 * by event key + chat id (several same-tenant users sharing ONE physical
 * Telegram chat receive exactly ONE physical message, while their in-app,
 * email and audit records stay separate per user). Native push uses
 * 'panic:<panicId>:<recipientId>' (one push per recipient per panic).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { buildPanicEmail } from '../../shared/panicEmailTemplate.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

/** Roles authorised to RECEIVE a panic in the panic's own tenant. Includes
 * the current (post-split) operational/administration roles AND the legacy
 * pre-split role identifiers, so no migrated tenant is left unrouted. */
const RECIPIENT_ROLES = [
  'admin', 'dispatcher', 'supervisor', 'estate_manager', 'management',
  'customer_admin', 'control_room_operator',
];
/** Platform-level emergency oversight recipients — used ONLY for a platform
 * sender's own panic (the sender's own scope), never as a fallback for
 * tenant panics. */
const PLATFORM_RECIPIENT_ROLES = ['admin', 'platform_admin'];

const isPlatformSender = (u) =>
  u.role_type === 'platform_admin' || u.admin_level === 'platform';

const sastTime = (iso) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

/**
 * Resolves the AUTHORITATIVE, EXPLICITLY AUTHORISED recipient list for one
 * panic, entirely from server-side tenant/site/control-room data:
 *   - platform sender → platform-level emergency oversight users only
 *     (the sender's own scope — not a fallback),
 *   - tenant sender → same-customer RECIPIENT_ROLES users, site-narrowed to
 *     the linked control room's operators/supervisors when a linkage exists
 *     (customer_admins always included).
 * The result may legitimately be EMPTY — there is NO hierarchy fallback.
 * The caller records PANIC_RECIPIENT_CONFIGURATION_MISSING when it is.
 */
async function resolvePanicRecipients(svc, sender, siteId) {
  const seen = new Set();
  const add = (list) => (list || []).filter((u) => {
    if (!u || !u.id || u.id === sender.id) return false;
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    return true;
  });

  // 1. Platform sender → platform-level emergency oversight only (a platform
  //    panic must not fan out to every tenant's admins).
  if (isPlatformSender(sender)) {
    const all = await svc.entities.User.filter({}).catch(() => []);
    return add(all.filter((u) =>
      PLATFORM_RECIPIENT_ROLES.includes(u.role_type) || u.admin_level === 'platform'));
  }

  const customerId = sender.customer_id;
  // A sender with no customer scope has no authorised tenant recipients —
  // NO hierarchy fallback. The caller records the configuration failure.

  // 2. Tenant recipients — same customer only.
  let recipients = [];
  if (customerId) {
    const tenantUsers = (await svc.entities.User
      .filter({ customer_id: customerId }).catch(() => [])) || [];
    const base = tenantUsers.filter((u) => RECIPIENT_ROLES.includes(u.role_type));

    // Site-aware CONTROL ROOM narrowing: when the sender's site is linked to
    // active control room(s), only THOSE rooms' operators/supervisors are
    // alerted (plus the customer administrators). No linkage → all tenant
    // recipients. Either way the result can be empty (no hierarchy fallback).
    if (siteId && base.length) {
      const rooms = (await svc.entities.ControlRoom
        .filter({ customer_id: customerId, status: 'active' }).catch(() => [])) || [];
      const linkedRooms = rooms.filter((r) => (r.linked_site_ids || []).includes(siteId));
      if (linkedRooms.length) {
        const roomUserIds = new Set();
        for (const room of linkedRooms) {
          (room.operator_user_ids || []).forEach((id) => roomUserIds.add(id));
          (room.supervisor_user_ids || []).forEach((id) => roomUserIds.add(id));
        }
        const narrowed = base.filter((u) =>
          roomUserIds.has(u.id) || u.role_type === 'customer_admin' || u.role_type === 'admin');
        recipients = add(narrowed.length ? narrowed : base);
      } else {
        recipients = add(base);
      }
    } else {
      recipients = add(base);
    }
  }

  // NO reseller/platform fallback — a zero result is a CRITICAL configuration
  // failure handled (and audited) by the caller. Escalation outside the
  // customer may only ever come from recipients EXPLICITLY configured or
  // authorised for this customer/site/control room, never inferred from
  // organisational hierarchy.
  return recipients;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const svc = base44.asServiceRole;

    const body = await req.json();
    const { location, gps_accuracy, location_captured_at, location_source, notes, shiftId, siteId, siteName } = body;

    const nowIso = new Date().toISOString();
    const panicNumber = `PNC-${Date.now()}`;
    const userName = user.display_name || user.full_name || 'Unknown User';

    // Server-side SITE resolution. The sender's authoritative site assignment
    // (User.site_id) applies when the trigger supplied no site context, and a
    // valid site_id is ALWAYS paired with its resolved Site name — a panic
    // must never display "Site: Unknown" when real site data exists (live
    // trace 2026-09-11: a guard panic carried a valid site_id but an empty
    // site_name because the User record holds site_id without site_name).
    const senderSiteId = siteId || user.site_id || '';
    let resolvedSiteName = siteName || user.site_name || '';
    if (senderSiteId && !resolvedSiteName) {
      const siteRows = (await svc.entities.Site
        .filter({ id: senderSiteId }).catch(() => [])) || [];
      if (siteRows[0] && siteRows[0].name) resolvedSiteName = siteRows[0].name;
    }

    // CONTROL ROOM SCOPE RETENTION — an OPERATOR-ORIGINATED panic records the
    // sender's UNAMBIGUOUS control room assignment at activation time (exactly
    // one active room with the sender in operator_user_ids). This stored scope
    // governs which operators may view/respond: only operators assigned to
    // that room. Ambiguity (zero or multiple rooms) is NEVER guessed — nothing
    // is stored and the panic is NOT shown to customer operators at large,
    // only to explicitly authorised configured responders / customer emergency
    // oversight. Guard/site panics scope via panic.site_id → linked control
    // rooms at view time (panicScope). Delivery/recipient resolution is NOT
    // touched by this block.
    let senderControlRoomId = null;
    if (user.role_type === 'control_room_operator' && user.customer_id) {
      const senderRooms = (await svc.entities.ControlRoom
        .filter({ customer_id: user.customer_id, status: 'active' }).catch(() => [])) || [];
      const mineRooms = senderRooms.filter((r) => (r.operator_user_ids || []).includes(user.id));
      if (mineRooms.length === 1) senderControlRoomId = mineRooms[0].id;
    }

    // 1. Create the PanicAlert record IMMEDIATELY (before any notifications)
    //    — the durable event always exists even if every channel fails.
    const panic = await svc.entities.PanicAlert.create({
      panic_number: panicNumber,
      user_id: user.id,
      user_name: userName,
      user_role: user.role_type || '',
      badge_number: user.badge_number || '',
      site_id: senderSiteId,
      site_name: resolvedSiteName,
      shift_id: shiftId || '',
      control_room_id: senderControlRoomId,
      status: 'active',
      priority: 'critical',
      notes: notes || '',
      location: location || null,
      gps_accuracy: gps_accuracy || null,
      location_captured_at: location_captured_at || nowIso,
      location_source: location_source || (location ? 'cached' : 'unavailable'),
      location_updated: false,
      activated_at: nowIso,
      notification_sent: false,
      escalated: false,
      escalation_count: 0,
      // NO automatic escalation. next_escalation_at is kept null on new panics;
      // the field is retained on the entity only for historical data.
      next_escalation_at: null,
      customer_id: user.customer_id || undefined,
      reseller_id: user.reseller_id || undefined,
      activity_log: [{
        timestamp: nowIso,
        action: 'activated',
        by_user_id: user.id,
        by_user_name: userName,
        from_status: null,
        to_status: 'active',
        notes: notes || 'Panic activated'
      }]
    });

    // Deterministic logical event key — used consistently across Telegram,
    // native push and delivery audits for this panic.
    const eventKey = 'panic:' + panic.id;

    // 2. Resolve the tenant/organisation name for the notification context.
    let customerName = '';
    if (user.customer_id) {
      const custRows = await svc.entities.Customer
        .filter({ id: user.customer_id }).catch(() => []);
      customerName = (custRows && custRows[0] && custRows[0].name) || '';
    }

    // 3. Resolve the AUTHORITATIVE recipients (server-side only).
    const recipients = await resolvePanicRecipients(svc, user, senderSiteId);

    // 3b. ZERO-RECIPIENT POLICY — no hierarchy fallback was applied (there
    //     is none). The panic record is already durable above. Record the
    //     CRITICAL delivery/configuration failure for authorised platform
    //     oversight — WITHOUT sending the customer's panic content to any
    //     unauthorised reseller/platform recipient.
    if (!recipients.length) {
      const roomSiteId = siteId || user.site_id || '';
      let controlRoomIds = null;
      if (user.customer_id && roomSiteId) {
        const rooms = (await svc.entities.ControlRoom
          .filter({ customer_id: user.customer_id, status: 'active' }).catch(() => [])) || [];
        const linked = rooms.filter((r) => (r.linked_site_ids || []).includes(roomSiteId));
        controlRoomIds = linked.length ? linked.map((r) => r.id).join(',') : null;
      }
      const failureAudit = {
        panic_id: panic.id,
        customer_id: user.customer_id || null,
        site_id: roomSiteId || null,
        control_room_id: controlRoomIds,
        sender_id: user.id,
        sender_name: userName,
        timestamp: new Date().toISOString(),
        recipient_count: 0,
      };
      await svc.entities.PlatformAuditLog.create({
        event_type: 'panic.recipient_configuration_missing',
        user_id: user.id,
        user_name: userName,
        customer_id: user.customer_id || undefined,
        reseller_id: user.reseller_id || undefined,
        module_key: 'PANIC',
        entity_name: 'PanicAlert',
        entity_id: panic.id,
        action: 'PANIC_RECIPIENT_CONFIGURATION_MISSING',
        notes: JSON.stringify(failureAudit),
      }).catch(e => console.error('Panic recipient-configuration audit log failed:', e));
    }

    const googleMapsUrl = location?.lat && location?.lng
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;
    const contextLine = [resolvedSiteName, customerName]
      .filter(Boolean).join(' — ') || 'Unknown location';

    const emailBody = buildPanicEmail({
      userName, userRole: user.role_type, badgeNumber: user.badge_number,
      siteName: resolvedSiteName, panicNumber, activatedAt: nowIso,
      location, gpsAccuracy: gps_accuracy, notes, status: 'ACTIVE',
      customerName,
    });

    const telegramText = [
      '🚨 *PANIC ALERT*',
      `Person: ${userName} (${user.role_type || 'user'})`,
      `Organisation: ${contextLine}`,
      `Time: ${sastTime(nowIso)} (SAST)`,
      `Ref: ${panicNumber}`,
      googleMapsUrl ? `Location: ${googleMapsUrl}` : 'Location: not yet available',
      'Acknowledge in the USS Panic Queue immediately.',
    ].join('\n');

    // 4. Fan out IN-APP + EMAIL + TELEGRAM + NATIVE PUSH per recipient with
    //    FULL FAILURE ISOLATION: every channel is independently caught
    //    (Promise.allSettled + per-channel .catch) — no channel failure can
    //    abort the others, and the panic record above is already durable.
    const notifResults = await Promise.allSettled(recipients.map(async (recipient) => {
      // 4a. IN-APP (required) — critical Notification record: bell badge,
      //     Notification Centre entry, foreground critical banner, deep link.
      try {
        await svc.entities.Notification.create({
          recipient_id: recipient.id,
          recipient_name: recipient.display_name || recipient.full_name || '',
          type: 'system',
          priority: 'critical',
          title: `🚨 PANIC ALERT — ${userName}`,
          message: `EMERGENCY: ${userName} (${user.role_type || 'user'}) triggered a PANIC alert at ${sastTime(nowIso)}${resolvedSiteName ? ` — site: ${resolvedSiteName}` : ''}${customerName ? ` — ${customerName}` : ''}. Immediate response required!`,
          read: false,
          related_entity: 'panic',
          related_id: panic.id,
          // Exact-panic deep link: Bell → tap → Panic Queue with this exact
          // panic highlighted/opened (now reachable by control_room_operator).
          action_url: '/PanicManagement?panic=' + panic.id,
          sent_via: ['in_app']
        });
      } catch (e) {
        console.error(`Panic in-app notification failed for ${recipient.id}:`, e);
      }

      // 4b. EMAIL (required) — branded panic email, independently isolated.
      if (recipient.email) {
        await svc.integrations.Core.SendEmail({
          to: recipient.email,
          from_name: 'USS EMERGENCY',
          subject: `🚨 PANIC ALERT — ${userName} — IMMEDIATE RESPONSE REQUIRED`,
          body: emailBody
        }).catch(e => console.error(`Panic email failed for ${recipient.email}:`, e));
      }

      // 4c. TELEGRAM (where configured/connected) — event-key + chat dedupe:
      //     several recipients sharing ONE physical chat get exactly ONE
      //     physical message for this panic; per-user in-app/email/audit
      //     records above stay separate.
      if (recipient.telegram_connected && recipient.telegram_notifications_enabled !== false && recipient.telegram_chat_id) {
        await sendTaskTelegramDeduped(svc, secrets, eventKey, recipient.telegram_chat_id, telegramText)
          .catch(e => console.error(`Panic telegram failed for ${recipient.id}:`, e));
      }

      // 4d. NATIVE PUSH (attempted, never blocking) — one push per recipient
      //     per panic; failure is logged and NEVER breaks other channels.
      await sendNativePush(svc, {
        user_id: recipient.id,
        title: `🚨 PANIC ALERT — ${userName}`,
        body: `EMERGENCY: ${userName} triggered a PANIC alert at ${contextLine}` +
          (googleMapsUrl ? `. Location: ${googleMapsUrl}` : '. Immediate response required!'),
        priority: 'critical',
        force: true,
        action_label: 'Open Panic Queue',
        action_url: '/PanicManagement?panic=' + panic.id,
        event_key: eventKey + ':' + recipient.id,
        customer_id: user.customer_id || null,
        reseller_id: user.reseller_id || null,
      }).catch(e => console.error('native panic push failed:', e?.message || e));

      return { ok: true };
    }));

    const successCount = notifResults.filter(r => r.status === 'fulfilled').length;
    const noRecipients = recipients.length === 0;

    // 5. Mark notification_sent + record the ONE-TIME initial notification
    //    event — ONLY when at least one authorised recipient was resolved.
    //    With zero recipients no notification event occurred: the failure is
    //    recorded on the panic itself and initial_notification_sent_at stays
    //    unset. No automatic escalation/re-send in either case.
    const activityEntry = noRecipients
      ? {
          timestamp: new Date().toISOString(),
          action: 'PANIC_RECIPIENT_CONFIGURATION_MISSING',
          by_user_id: 'system',
          by_user_name: 'System',
          from_status: 'active',
          to_status: 'active',
          notes: 'No authorised emergency recipients configured (0/0) — CRITICAL delivery/configuration failure recorded for platform oversight'
        }
      : {
          timestamp: new Date().toISOString(),
          action: 'notifications_sent',
          by_user_id: 'system',
          by_user_name: 'System',
          from_status: 'active',
          to_status: 'active',
          notes: `Initial notifications sent to ${successCount}/${recipients.length} recipients`
        };
    const panicUpdate = {
      notification_sent: !noRecipients && successCount > 0,
      activity_log: [...(panic.activity_log || []), activityEntry]
    };
    if (!noRecipients) panicUpdate.initial_notification_sent_at = nowIso;
    await svc.entities.PanicAlert.update(panic.id, panicUpdate);

    return Response.json({
      success: true,
      panicId: panic.id,
      panicNumber: panicNumber,
      recipientCount: recipients.length,
      notificationsSent: successCount,
      // Sender-UI signal for the SAFE CRITICAL state — the UI must never
      // claim 'Control Room has been notified' when this is true. No
      // technical detail leaks to the sender through this flag.
      recipientConfigurationMissing: noRecipients
    });

  } catch (error) {
    console.error('Panic activation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});