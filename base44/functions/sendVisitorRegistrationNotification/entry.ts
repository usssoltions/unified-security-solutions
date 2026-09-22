import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may register visitors.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      visitorId, visitorName, visitorIdNumber, visitorPhone, vehicleReg,
      hostName, unitNumber, validFrom, validUntil, qrCode, otp,
    } = body;

    // TENANT BRANDING — resolved from the registering user's authoritative
    // customer/reseller record.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user.customer_id || null, reseller_id: user.reseller_id || null });

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
    // TENANT-SCOPED recipients — the registering user's OWN customer's staff
    // (platform oversight always permitted). The previous platform-wide role
    // filter leaked visitor registrations across tenants.
    const allUsers = await base44.asServiceRole.entities.User.list();
    const isPlatformUser = (u) => u.role_type === 'platform_admin' || u.admin_level === 'platform';
    // MODERN recipient resolution — customer_admin / control_room_operator /
    // estate_manager join the legacy staff roles, so a customer whose staff
    // hold the post-split roles still receives visitor pre-registrations.
    const recipients = allUsers.filter((u) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'guard', 'customer_admin', 'control_room_operator', 'estate_manager'].includes(u.role_type) &&
      (isPlatformUser(u) || !user.customer_id || u.customer_id === user.customer_id));

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
    // Body renders through the ONE shared branded renderer.
    const brandTpl = buildBrandedEmail({
      brand,
      heading: 'Visitor Pre-Registered',
      greeting: 'Hello,',
      intro: `${visitorName || 'A visitor'} has been pre-registered${unitNumber ? ` for Unit ${unitNumber}` : ''}.`,
      details: [
        { label: 'Visitor', value: visitorName || 'N/A' },
        visitorIdNumber ? { label: 'ID / Licence', value: visitorIdNumber } : null,
        vehicleReg ? { label: 'Vehicle', value: vehicleReg } : null,
        visitorPhone ? { label: 'Phone', value: visitorPhone } : null,
        { label: 'Host', value: hostName || 'N/A' },
        { label: 'Valid', value: dateRange },
        qrCode ? { label: 'QR pass', value: qrCode } : null,
        otp ? { label: 'OTP', value: otp } : null,
      ],
      closing: 'The visitor will present their QR code at the gate for scanning.',
    });
    try {
      const emails = recipients.map((u) => u.email).filter(Boolean).join(',');
      if (emails) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name,
          to: emails,
          subject: title,
          body: brandTpl.html,
        });
      }
    } catch (_) {}

    // TELEGRAM — automatic operational channel for visitor pre-registration
    // (same shared infrastructure + branded renderer as every other
    // operational notification), failure-isolated with a deterministic
    // per-recipient event key.
    const preregEventKey = 'visitor_prereg:' + (visitorId || Date.now());
    for (const u of recipients) {
      if (!u.telegram_connected || u.telegram_notifications_enabled === false || !u.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
        preregEventKey + ':' + u.id,
        u.telegram_chat_id,
        buildBrandedTelegram({
          brand,
          heading: 'Visitor Pre-Registered',
          details: [
            { label: 'Visitor', value: visitorName || 'N/A' },
            visitorIdNumber ? { label: 'ID / Licence', value: visitorIdNumber } : null,
            vehicleReg ? { label: 'Vehicle', value: vehicleReg } : null,
            { label: 'Host', value: hostName || 'N/A' },
            { label: 'Valid', value: dateRange },
            qrCode ? { label: 'QR pass', value: qrCode } : null,
          ],
          closing: 'The visitor will present their QR code at the gate for scanning.',
        }))
        .catch(() => {});
    }

    return Response.json({ success: true, notified: recipients.length });
  } catch (error) {
    console.error('Error sending visitor registration notification:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});