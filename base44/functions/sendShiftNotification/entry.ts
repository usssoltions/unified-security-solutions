import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { shiftId, guardId, guardEmail, guardName, siteName, startTime, endTime, notificationType } = await req.json();

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
      priority: 'medium',
      title: emailSubject,
      message: `Shift at ${siteName} on ${new Date(startTime).toLocaleDateString()}`,
      related_entity: 'shift',
      related_id: shiftId,
      sent_via: emailSent ? ['email', 'in_app'] : ['in_app']
    });

    return Response.json({ success: true, emailSent });
  } catch (error) {
    console.error('Error sending shift notification:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});