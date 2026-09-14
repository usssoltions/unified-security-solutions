import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import {
  resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram,
  formatSastDate, formatSastTime, formatSastDateTime,
} from '../../shared/brandedCommunication.ts';

const MANAGEMENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management'];
const isPlatformUser = (u) => u.role_type === 'platform_admin' || u.admin_level === 'platform';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may trigger shift
    // notifications (guards acknowledge, admins/dispatchers assign).
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    let { shiftId, guardId, guardEmail, guardName, siteName, startTime, endTime, notificationType, type, status, notes } = body;

    // TENANT CONTEXT — starts from the caller's authoritative tenant scope and
    // is refined from the shift/guard records below. Branding and recipients
    // are resolved SERVER-SIDE only; the frontend supplies shift FACTS.
    let tenantCustomerId = user.customer_id || null;
    let tenantResellerId = user.reseller_id || null;

    // ROOT-CAUSE FIX (missing Shift Telegram, live 2026-09-14): guardUser was
    // previously declared INSIDE the guardId block while the Telegram leg
    // referenced it OUTSIDE that block — a runtime ReferenceError that aborted
    // the function AFTER email, in-app and push had already succeeded, with
    // the .catch swallowing the failure. guardUser is now function-scoped so
    // every channel leg runs.
    let guardUser = null;

    // Handle shift acknowledgement notification to admins
    if (type === "ack") {
      const statusLabel = (status || "").replace(/_/g, " ");
      const allUsers = await base44.asServiceRole.entities.User.list();
      // TENANT-SCOPED recipients — the caller's OWN customer's operational
      // management (platform oversight always permitted). The previous
      // platform-wide role filter leaked shift acknowledgements across tenants.
      const admins = (allUsers || []).filter(u =>
        MANAGEMENT_ROLES.includes(u.role_type) &&
        (isPlatformUser(u) || !tenantCustomerId || u.customer_id === tenantCustomerId));

      const brand = await resolveCommunicationBrand(base44.asServiceRole, {
        customer_id: tenantCustomerId, reseller_id: tenantResellerId });

      for (const admin of admins) {
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.display_name || admin.full_name,
          type: "shift_reminder",
          priority: status === "declined" ? "high" : "medium",
          title: `Shift ${statusLabel} — ${guardName}`,
          message: `${guardName} has ${statusLabel} their shift at ${siteName}${startTime ? ' on ' + formatSastDate(startTime) : ''}.${notes ? ` Note: ${notes}` : ""}`,
          read: false,
          related_entity: "shift",
          related_id: shiftId,
          customer_id: tenantCustomerId || undefined,
          reseller_id: tenantResellerId || undefined,
        }).catch(() => {});
      }

      // EMAIL — shared branded renderer; failure-isolated from the ack itself.
      try {
        const adminEmails = admins.map(a => a.email).filter(Boolean).join(",");
        if (adminEmails) {
          const tpl = buildBrandedEmail({
            brand,
            heading: `Shift ${statusLabel}`,
            intro: `${guardName} has ${statusLabel} their shift${siteName ? ' at ' + siteName : ''}${startTime ? ' on ' + formatSastDate(startTime) : ''}.${notes ? ' Note: ' + notes : ''}`,
            details: [
              guardName ? { label: 'Guard', value: guardName } : null,
              siteName ? { label: 'Site', value: siteName } : null,
              startTime ? { label: 'Scheduled start', value: formatSastDateTime(startTime) } : null,
            ].filter(Boolean),
            closing: 'Please open the Scheduling view to review the shift.',
          });
          await base44.asServiceRole.integrations.Core.SendEmail({
            from_name: brand.brand_name,
            to: adminEmails,
            subject: `Shift ${statusLabel} — ${guardName}${siteName ? ' @ ' + siteName : ''}`,
            body: tpl.text,
            html: tpl.html,
          });
        }
      } catch (_) {}

      // NATIVE PUSH — shared platform service. A DECLINED shift acknowledgement
      // requires management action even with the app closed. Accepted acks are
      // informational — deliberately no push.
      if (status === "declined") {
        for (const admin of admins) {
          await sendNativePush(base44.asServiceRole, {
            user_id: admin.id,
            title: `Shift ${statusLabel} — ${guardName}`,
            body: `${guardName} has ${statusLabel} their shift at ${siteName}.${notes ? ` Note: ${notes}` : ""}`,
            priority: 'high',
            action_label: 'Open Scheduling', action_url: '/Scheduling',
            event_key: 'shift_ack:' + shiftId + ':' + status,
            customer_id: tenantCustomerId || null,
            reseller_id: tenantResellerId || null,
          }).catch(() => {});
        }
      }
      return Response.json({ success: true });
    }

    /* SERVER-SIDE RECIPIENT RESOLUTION — the browser passes only shift FACTS
       (ids, times, site name). The affected guard's contact details are
       resolved HERE from their authoritative User record and tenant scope is
       validated; the frontend never constructs recipients or contact details.
       A cancelled shift is resolved from the payload (its record is deleted). */
    if (guardId && type !== 'ack') {
      if ((!startTime || !endTime || !siteName) && shiftId) {
        try {
          const rows = await base44.asServiceRole.entities.Shift.filter({ id: String(shiftId) });
          const stored = rows && rows[0];
          if (stored) {
            if (!startTime) startTime = stored.start_time;
            if (!endTime) endTime = stored.end_time;
            if (!siteName) siteName = stored.site_name;
            if (!guardName) guardName = stored.guard_name;
            // The SHIFT record is the authoritative tenant owner for this event.
            if (stored.customer_id) tenantCustomerId = stored.customer_id;
            if (stored.reseller_id) tenantResellerId = stored.reseller_id;
          }
        } catch (_) {}
      }
      try {
        const rows = await base44.asServiceRole.entities.User.filter({ id: String(guardId) });
        guardUser = rows && rows[0];
      } catch (_) {}
      if (!guardUser) {
        return Response.json({ error: 'The affected guard could not be resolved' }, { status: 404 });
      }
      const callerPlatform = isPlatformUser(user);
      if (!callerPlatform && user.customer_id && guardUser.customer_id && guardUser.customer_id !== user.customer_id) {
        return Response.json({ error: 'That guard does not belong to your customer', code: 'forbidden_guard' }, { status: 403 });
      }
      if (!guardEmail) guardEmail = guardUser.email || null;
      if (!guardName) guardName = guardUser.display_name || guardUser.full_name || null;
      if (guardUser.customer_id) tenantCustomerId = guardUser.customer_id;
      if (guardUser.reseller_id) tenantResellerId = guardUser.reseller_id;
    }

    // ONE AUTHORITATIVE BRAND — Customer → Reseller → USS platform default,
    // resolved from the event's authoritative tenant ownership, never from the
    // frontend and never hard-coded per tenant.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: tenantCustomerId, reseller_id: tenantResellerId });

    const shiftDate = formatSastDate(startTime);
    const timeRange = (startTime && endTime) ? `${formatSastTime(startTime)} – ${formatSastTime(endTime)}` : '';

    const headings = {
      assigned: '📅 New Shift Assigned',
      reminder: '⏰ Shift Reminder — Starting Soon',
      updated: '✏️ Shift Updated',
      cancelled: '❌ Shift Cancelled',
    };
    const heading = headings[notificationType] || '📋 Shift Update';
    const intro = {
      assigned: 'You have been assigned a new shift.',
      reminder: 'This is a reminder that your shift is starting soon.',
      updated: 'Your shift has been updated. Please adjust your schedule accordingly.',
      cancelled: 'Your shift has been cancelled. No action is required — this shift is no longer part of your schedule.',
    }[notificationType] || 'You have a shift update.';
    const closing = {
      assigned: 'Please open the app to review and acknowledge the shift, and arrive on time to clock in.',
      reminder: 'Please arrive on time and clock in through the app.',
      updated: 'Please open the app to review the updated details.',
      cancelled: 'Please open the app to review your schedule.',
    }[notificationType] || '';

    const details = [
      siteName ? { label: 'Site', value: siteName } : null,
      startTime ? { label: 'Date', value: shiftDate } : null,
      timeRange ? { label: 'Time', value: timeRange } : null,
      endTime ? { label: 'End', value: formatSastDateTime(endTime) } : null,
    ].filter(Boolean);

    const tpl = buildBrandedEmail({
      brand,
      heading,
      greeting: guardName ? `Hello ${guardName},` : 'Hello,',
      intro,
      details,
      closing,
    });

    // Send email (only if guard has an email and exists in the system)
    let emailSent = false;
    if (guardEmail) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name,
          to: guardEmail,
          subject: heading,
          body: tpl.text,
          html: tpl.html,
        });
        emailSent = true;
      } catch (error) {
        console.error('Email sending failed:', error.message);
      }
    }

    // Create in-app notification
    await base44.asServiceRole.entities.Notification.create({
      recipient_id: guardId,
      recipient_name: guardName,
      type: 'shift_reminder',
      priority: (notificationType === 'assigned' || notificationType === 'cancelled') ? 'high' : 'medium',
      title: heading,
      message: `Shift at ${siteName}${shiftDate ? ' on ' + shiftDate : ''}${timeRange ? ' (' + timeRange + ')' : ''}`,
      related_entity: 'shift',
      related_id: shiftId,
      action_url: '/GuardShift',
      customer_id: tenantCustomerId || undefined,
      reseller_id: tenantResellerId || undefined,
      sent_via: emailSent ? ['email', 'in_app'] : ['in_app']
    });

    // NATIVE PUSH — shared platform service (delivered with the app closed).
    // assigned/cancelled → HIGH (immediate obligation change, foreground banner
    // + chime); updated/reminder → NORMAL.
    if (['assigned', 'updated', 'reminder', 'cancelled'].includes(notificationType)) {
      await sendNativePush(base44.asServiceRole, {
        user_id: guardId,
        title: heading,
        body: `Shift at ${siteName}${startTime ? ' — ' + formatSastDateTime(startTime) : ''}`,
        priority: (notificationType === 'assigned' || notificationType === 'cancelled') ? 'high' : 'normal',
        action_label: 'Open My Shift', action_url: '/GuardShift',
        event_key: 'shift_' + notificationType + ':' + shiftId + ':' + startTime,
        customer_id: tenantCustomerId || null,
        reseller_id: tenantResellerId || null,
      }).catch(() => {});
    }

    // TELEGRAM — automatic operational channel to the guard (verified
    // per-user mapping; same-chat dedupe by the SAME deterministic event
    // key as push; failure-isolated from email/in-app/push and from the
    // scheduling transaction). Rendered through the ONE shared branded
    // Telegram renderer — never a hard-coded tenant identity.
    if (['assigned', 'updated', 'cancelled'].includes(notificationType) && guardUser) {
      if (guardUser.telegram_connected && guardUser.telegram_notifications_enabled !== false && guardUser.telegram_chat_id) {
        const tgHeading = {
          assigned: 'NEW SHIFT ASSIGNMENT',
          updated: 'SHIFT UPDATED',
          cancelled: 'SHIFT CANCELLED',
        }[notificationType];
        const telegramText = buildBrandedTelegram({
          brand,
          heading: tgHeading,
          greeting: guardName ? `Hello ${guardName},` : 'Hello,',
          details,
          closing,
        });
        await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
          'shift_' + notificationType + ':' + shiftId + ':' + startTime,
          guardUser.telegram_chat_id,
          telegramText)
          .catch(() => {});
      }
    }

    return Response.json({ success: true, emailSent });
  } catch (error) {
    console.error('Error sending shift notification:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});