import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { sendNativePush } from '../../shared/nativePush.ts';

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

    // Handle shift acknowledgement notification to admins
    if (type === "ack") {
      const statusLabel = (status || "").replace(/_/g, " ");
      const allUsers = await base44.asServiceRole.entities.User.list();
      const admins = allUsers.filter(u =>
        ["admin", "dispatcher", "supervisor", "management"].includes(u.role_type)
      );
      for (const admin of admins) {
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.full_name,
          type: "shift_reminder",
          priority: status === "declined" ? "high" : "medium",
          title: `Shift ${statusLabel} — ${guardName}`,
          message: `${guardName} has ${statusLabel} their shift at ${siteName} on ${new Date(startTime).toLocaleDateString("en-ZA")}.${notes ? ` Note: ${notes}` : ""}`,
          read: false,
          related_entity: "shift",
          related_id: shiftId,
        });
      }
      try {
        const adminEmails = admins.map(a => a.email).filter(Boolean).join(",");
        if (adminEmails) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            from_name: "SecureGuard Scheduling",
            to: adminEmails,
            subject: `Shift ${statusLabel} — ${guardName} @ ${siteName}`,
            body: `${guardName} has ${statusLabel} their shift.\n\nSite: ${siteName}\nDate: ${new Date(startTime).toLocaleString("en-ZA")}\n${notes ? `Note: ${notes}` : ""}`,
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
            customer_id: user.customer_id || null,
            reseller_id: user.reseller_id || null,
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
          }
        } catch (_) {}
      }
      let guardUser = null;
      try {
        const rows = await base44.asServiceRole.entities.User.filter({ id: String(guardId) });
        guardUser = rows && rows[0];
      } catch (_) {}
      if (!guardUser) {
        return Response.json({ error: 'The affected guard could not be resolved' }, { status: 404 });
      }
      const callerPlatform = user.role === 'admin' || user.role_type === 'platform_admin' || user.admin_level === 'platform';
      if (!callerPlatform && user.customer_id && guardUser.customer_id && guardUser.customer_id !== user.customer_id) {
        return Response.json({ error: 'That guard does not belong to your customer', code: 'forbidden_guard' }, { status: 403 });
      }
      if (!guardEmail) guardEmail = guardUser.email || null;
      if (!guardName) guardName = guardUser.display_name || guardUser.full_name || null;
    }

    let emailSubject, emailBody;

    if (notificationType === 'assigned') {
      emailSubject = '📅 New Shift Assigned';
      emailBody = `
<h2>New Shift Assignment</h2>

<p>Hello ${guardName},</p>

<p>You have been assigned a new shift:</p>

<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <td><strong>Site:</strong></td>
    <td>${siteName}</td>
  </tr>
  <tr>
    <td><strong>Start:</strong></td>
    <td>${new Date(startTime).toLocaleString()}</td>
  </tr>
  <tr>
    <td><strong>End:</strong></td>
    <td>${new Date(endTime).toLocaleString()}</td>
  </tr>
</table>

<p>Please ensure you arrive on time and clock in through the SecureGuard app.</p>

<p><em>SecureGuard System</em></p>
      `;
    } else if (notificationType === 'reminder') {
      emailSubject = '⏰ Shift Reminder - Starting Soon';
      emailBody = `
<h2>Shift Reminder</h2>

<p>Hello ${guardName},</p>

<p>This is a reminder that your shift is starting soon:</p>

<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <td><strong>Site:</strong></td>
    <td>${siteName}</td>
  </tr>
  <tr>
    <td><strong>Start:</strong></td>
    <td>${new Date(startTime).toLocaleString()}</td>
  </tr>
  <tr>
    <td><strong>End:</strong></td>
    <td>${new Date(endTime).toLocaleString()}</td>
  </tr>
</table>

<p>Don't forget to clock in on arrival!</p>

<p><em>SecureGuard System</em></p>
      `;
    } else if (notificationType === 'updated') {
      emailSubject = '✏️ Shift Updated';
      emailBody = `
<h2>Shift Update</h2>

<p>Hello ${guardName},</p>

<p>Your shift has been updated:</p>

<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <td><strong>Site:</strong></td>
    <td>${siteName}</td>
  </tr>
  <tr>
    <td><strong>Start:</strong></td>
    <td>${new Date(startTime).toLocaleString()}</td>
  </tr>
  <tr>
    <td><strong>End:</strong></td>
    <td>${new Date(endTime).toLocaleString()}</td>
  </tr>
</table>

<p>Please note the changes and adjust your schedule accordingly.</p>

<p><em>SecureGuard System</em></p>
      `;
    } else if (notificationType === 'cancelled') {
      emailSubject = '❌ Shift Cancelled';
      emailBody = `
<h2>Shift Cancelled</h2>

<p>Hello ${guardName},</p>

<p>Your shift has been cancelled:</p>

<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <td><strong>Site:</strong></td>
    <td>${siteName}</td>
  </tr>
  <tr>
    <td><strong>Start:</strong></td>
    <td>${new Date(startTime).toLocaleString()}</td>
  </tr>
  <tr>
    <td><strong>End:</strong></td>
    <td>${new Date(endTime).toLocaleString()}</td>
  </tr>
</table>

<p>No action is required — this shift is no longer part of your schedule.</p>

<p><em>SecureGuard System</em></p>
      `;
    }

    // Send email (only if guard has an email and exists in the system)
    let emailSent = false;
    if (guardEmail) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Scheduling',
          to: guardEmail,
          subject: emailSubject,
          body: emailBody
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
      title: emailSubject,
      message: `Shift at ${siteName} on ${new Date(startTime).toLocaleDateString()}`,
      related_entity: 'shift',
      related_id: shiftId,
      sent_via: emailSent ? ['email', 'in_app'] : ['in_app']
    });

    // NATIVE PUSH — shared platform service (delivered with the app closed).
    // assigned/cancelled → HIGH (immediate obligation change, foreground banner
    // + chime); updated/reminder → NORMAL.
    if (['assigned', 'updated', 'reminder', 'cancelled'].includes(notificationType)) {
      await sendNativePush(base44.asServiceRole, {
        user_id: guardId,
        title: emailSubject,
        body: `Shift at ${siteName} — ${new Date(startTime).toLocaleString('en-ZA')}`,
        priority: (notificationType === 'assigned' || notificationType === 'cancelled') ? 'high' : 'normal',
        action_label: 'Open My Shift', action_url: '/GuardShift',
        event_key: 'shift_' + notificationType + ':' + shiftId + ':' + startTime,
        customer_id: user.customer_id || null,
        reseller_id: user.reseller_id || null,
      }).catch(() => {});
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