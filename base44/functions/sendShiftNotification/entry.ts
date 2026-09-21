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

    /* SHARED ACK DISPATCHER — one branded, tenant-scoped notification set
       (in-app + email + Telegram, plus the existing declined-only push) to
       the shift's OWN customer's scheduling management. Recipients are
       resolved SERVER-SIDE; platform oversight always permitted; every other
       customer, site, control room and user is excluded. */
    const notifyShiftAckManagement = async ({ heading, summary, detailRows, relatedShiftId, status, eventKey }) => {
      const linkUrl = 'https://guard-track-pro-26cedab8.base44.app/Scheduling';
      const brand = await resolveCommunicationBrand(base44.asServiceRole, {
        customer_id: tenantCustomerId, reseller_id: tenantResellerId });
      const allUsers = await base44.asServiceRole.entities.User.list();
      // ACK RECIPIENTS: the shift's own customer's scheduling management.
      // customer_admin joins the legacy management roles — a customer whose
      // managers hold customer_admin previously resolved ZERO recipients,
      // which is why no in-app/email/telegram was ever received.
      const ACK_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin'];
      const admins = (allUsers || []).filter(u =>
        ACK_ROLES.includes(u.role_type) &&
        (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
        (isPlatformUser(u) || (!!tenantCustomerId && u.customer_id === tenantCustomerId)));
      let email = 0, telegram = 0;
      for (const admin of admins) {
        // IN-APP — real per-recipient record, deep-links to Scheduling.
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.display_name || admin.full_name,
          type: 'shift_reminder',
          priority: status === 'accepted' ? 'medium' : 'high',
          title: heading,
          message: summary,
          read: false,
          related_entity: 'shift',
          related_id: relatedShiftId || null,
          action_url: '/Scheduling',
          customer_id: tenantCustomerId || undefined,
          reseller_id: tenantResellerId || undefined,
          sent_via: ['in_app'],
        }).catch(() => {});

        // EMAIL — existing shared branded renderer (Customer → Reseller →
        // Platform), one per recipient; failure-isolated per recipient.
        try {
          if (admin.email) {
            const firstName = String(admin.display_name || admin.full_name || '').trim().split(/\s+/)[0];
            const tpl = buildBrandedEmail({
              brand,
              greeting: firstName ? `Hello ${firstName},` : 'Hello,',
              heading,
              intro: summary,
              details: detailRows,
              closing: 'Open Scheduling to review the shift: ' + linkUrl,
            });
            await base44.asServiceRole.integrations.Core.SendEmail({
              from_name: brand.brand_name,
              to: admin.email,
              subject: heading,
              text: tpl.text,
              html: tpl.html,
            });
            email++;
          }
        } catch (mailErr) {
          // Visible failure diagnosis (email still never breaks the ack).
          console.error('shift ack email failed:', admin.email, mailErr?.message || mailErr);
        }

        // TELEGRAM — verified per-user mapping, same-chat dedupe (same
        // deterministic event key per ack), inline OPEN SCHEDULING action;
        // failure-isolated per recipient.
        try {
          if (admin.telegram_connected && admin.telegram_notifications_enabled !== false && admin.telegram_chat_id) {
            const telegramText = buildBrandedTelegram({
              brand,
              greeting: 'Hello,',
              heading,
              details: detailRows,
              closing: 'Open Scheduling: ' + linkUrl,
            });
            const ok = await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
              eventKey, admin.telegram_chat_id, telegramText,
              { text: 'OPEN SCHEDULING', url: linkUrl });
            if (ok) telegram++;
          }
        } catch (_) { /* telegram failure never breaks the ack notification */ }
      }

      // NATIVE PUSH — unchanged policy: a DECLINED acknowledgement requires
      // management action even with the app closed; accepted/revision are
      // informational. Now reaches the correctly-resolved recipients.
      if (status === 'declined') {
        for (const admin of admins) {
          await sendNativePush(base44.asServiceRole, {
            user_id: admin.id,
            title: heading,
            body: summary,
            priority: 'high',
            action_label: 'Open Scheduling', action_url: '/Scheduling',
            event_key: eventKey,
            customer_id: tenantCustomerId || null,
            reseller_id: tenantResellerId || null,
          }).catch(() => {});
        }
      }
      return { recipients: admins.length, email, telegram };
    };

    // Handle shift acknowledgement notification to management (guard ACCEPT /
    // DECLINE / REVISION REQUESTED — single shift). The SHIFT record is the
    // AUTHORITATIVE source for tenant scope, facts and the ack timestamp.
    if (type === "ack") {
      let storedShift = null;
      if (shiftId) {
        try {
          const rows = await base44.asServiceRole.entities.Shift.filter({ id: String(shiftId) });
          storedShift = rows && rows[0];
        } catch (_) { /* fall back to the caller-supplied facts */ }
      }
      if (storedShift) {
        if (storedShift.customer_id) tenantCustomerId = storedShift.customer_id;
        if (storedShift.reseller_id) tenantResellerId = storedShift.reseller_id;
        siteName = siteName || storedShift.site_name;
        startTime = startTime || storedShift.start_time;
        endTime = endTime || storedShift.end_time;
        guardName = guardName || storedShift.guard_name;
      }
      const ackAt = (storedShift && storedShift.guard_ack_at) || new Date().toISOString();
      const ackNote = String(notes || (storedShift && storedShift.guard_ack_note) || '').trim();
      const STATUS_WORDS = { accepted: 'ACCEPTED', declined: 'DECLINED', revision_requested: 'REVISION REQUESTED' };
      const statusWord = STATUS_WORDS[status] || String(status || '').toUpperCase();
      const statusLabel = statusWord.toLowerCase();
      const shiftDate = startTime ? formatSastDate(startTime) : '';
      const timeRange = (startTime && endTime) ? `${formatSastTime(startTime)} – ${formatSastTime(endTime)}` : '';
      const ackTimeStr = formatSastDateTime(ackAt);
      const noteLabel = status === 'revision_requested' ? 'Revision request' : 'Note';
      const heading = `SHIFT ${statusWord} — ${guardName || 'Guard'}`;
      const summary = `${guardName || 'The guard'} has ${statusLabel} their shift at ${siteName || '—'}` +
        `${shiftDate ? ' on ' + shiftDate : ''}${timeRange ? ' (' + timeRange + ')' : ''}.` +
        ` Acknowledged ${ackTimeStr}.${ackNote ? ' ' + noteLabel + ': ' + ackNote : ''}`;
      const detailRows = [
        { label: 'Guard', value: guardName || '—' },
        { label: 'Site', value: siteName || '—' },
        { label: 'Shift date', value: shiftDate || '—' },
        { label: 'Shift time', value: timeRange || '—' },
        { label: 'Response', value: statusWord },
        { label: 'Acknowledged', value: ackTimeStr },
        ...(ackNote ? [{ label: noteLabel, value: ackNote }] : []),
      ];
      const result = await notifyShiftAckManagement({ heading, summary, detailRows,
        relatedShiftId: shiftId, status, eventKey: 'shift_ack:' + shiftId + ':' + status + ':' + ackAt });
      return Response.json({ success: true, ...result });
    }

    // BATCH acknowledgement (guard responds to many shifts at once) — one
    // consolidated, branded, tenant-scoped notification set per management
    // recipient. The shifts are resolved SERVER-SIDE from shiftIds; the
    // previous client-side notification had no recipient and reached nobody.
    if (type === "ack_batch") {
      const shiftIds = Array.isArray(body.shiftIds) ? body.shiftIds.map(String) : [];
      if (!shiftIds.length) return Response.json({ error: 'shiftIds required' }, { status: 400 });
      const resolvedShifts = [];
      for (const sid of shiftIds) {
        try {
          const rows = await base44.asServiceRole.entities.Shift.filter({ id: sid });
          if (rows && rows[0]) resolvedShifts.push(rows[0]);
        } catch (_) { /* skip unresolvable id */ }
      }
      if (!resolvedShifts.length) return Response.json({ error: 'No shifts could be resolved' }, { status: 404 });
      const lead = resolvedShifts[0];
      if (lead.customer_id) tenantCustomerId = lead.customer_id;
      if (lead.reseller_id) tenantResellerId = lead.reseller_id;
      guardName = guardName || lead.guard_name;
      const ackAt = lead.guard_ack_at || new Date().toISOString();
      const ackNote = String(notes || '').trim();
      const STATUS_WORDS = { accepted: 'ACCEPTED', declined: 'DECLINED', revision_requested: 'REVISION REQUESTED' };
      const statusWord = STATUS_WORDS[status] || String(status || '').toUpperCase();
      const statusLabel = statusWord.toLowerCase();
      const ackTimeStr = formatSastDateTime(ackAt);
      const noteLabel = status === 'revision_requested' ? 'Revision request' : 'Note';
      const heading = `SHIFTS ${statusWord} (BATCH) — ${guardName || 'Guard'}`;
      const shiftLines = resolvedShifts.map(s =>
        `${s.site_name || '—'} — ${formatSastDate(s.start_time)}${s.start_time ? ' ' + formatSastTime(s.start_time) : ''}${s.end_time ? '–' + formatSastTime(s.end_time) : ''}`);
      const summary = `${guardName || 'The guard'} has ${statusLabel} ${resolvedShifts.length} shift(s). Acknowledged ${ackTimeStr}.` +
        `${ackNote ? ' ' + noteLabel + ': ' + ackNote : ''}\n${shiftLines.join('\n')}`;
      const detailRows = [
        { label: 'Guard', value: guardName || '—' },
        { label: 'Response', value: statusWord },
        { label: 'Shifts', value: String(resolvedShifts.length) },
        { label: 'Acknowledged', value: ackTimeStr },
        ...(ackNote ? [{ label: noteLabel, value: ackNote }] : []),
        ...resolvedShifts.map(s => ({
          label: s.site_name || 'Shift',
          value: `${formatSastDate(s.start_time)}${s.start_time ? ' ' + formatSastTime(s.start_time) : ''}${s.end_time ? ' – ' + formatSastTime(s.end_time) : ''}`,
        })),
      ];
      const result = await notifyShiftAckManagement({ heading, summary, detailRows,
        relatedShiftId: lead.id, status,
        eventKey: 'shift_ack_batch:' + status + ':' + ackAt + ':' + resolvedShifts.length });
      return Response.json({ success: true, ...result });
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
          text: tpl.text,
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