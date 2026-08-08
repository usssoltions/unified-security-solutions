import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const {
      visitorId, visitorName, visitorIdNumber, visitorPhone, vehicleReg,
      hostName, unitNumber, validFrom, validUntil, qrCode, otp,
    } = body;

    const dateRange = validFrom && validUntil
      ? `${new Date(validFrom).toLocaleDateString('en-ZA')} – ${new Date(validUntil).toLocaleDateString('en-ZA')}`
      : 'Open';

    const title = `Visitor Pre-Registered — ${visitorName || 'Unknown'}`;
    const message = [
      `${visitorName || 'A visitor'} has been pre-registered by ${hostName || 'a resident'}${unitNumber ? ` (Unit ${unitNumber})` : ''}.`,
      visitorIdNumber ? `ID / Licence: ${visitorIdNumber}.` : '',
      vehicleReg ? `Vehicle: ${vehicleReg}.` : '',
      `Valid: ${dateRange}.`,
      qrCode ? `QR pass: ${qrCode}.` : '',
      otp ? `OTP: ${otp}.` : '',
      'The visitor will present their QR code at the gate for scanning.',
    ].filter(Boolean).join(' ');

    // Notify all relevant staff: admins, dispatchers, supervisors, management, guards
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter((u) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'guard'].includes(u.role_type)
    );

    for (const u of recipients) {
      await base44.asServiceRole.entities.Notification.create({
        recipient_id: u.id,
        recipient_name: u.full_name,
        type: 'assignment',
        priority: 'medium',
        title,
        message,
        read: false,
        related_entity: 'visitor',
        related_id: visitorId || null,
      }).catch(() => {});
    }

    // Email the registered staff (SendEmail only reaches registered app users)
    try {
      const emails = recipients.map((u) => u.email).filter(Boolean).join(',');
      if (emails) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Visitors',
          to: emails,
          subject: title,
          body: message,
        });
      }
    } catch (_) {}

    return Response.json({ success: true, notified: recipients.length });
  } catch (error) {
    console.error('Error sending visitor registration notification:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});