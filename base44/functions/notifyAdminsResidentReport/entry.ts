import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

/**
 * notifyAdminsResidentReport
 *
 * Sends a fully tenant-branded real-time alert (email + in-app notification)
 * to all admin / estate_manager / dispatcher users whenever a resident submits
 * an incident report OR a maintenance request. This is the single backend
 * endpoint used by both resident report flows so branding and delivery stay
 * consistent with every other report in the system.
 *
 * Body:
 *  reportType  – "incident" | "maintenance"
 *  reportId    – created entity record id
 *  residentName, unitNumber, estateName, contactPhone, address
 *  category, priority (incident), urgency (maintenance)
 *  title, description, reason, reportedAt
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may submit a report.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      reportType, reportId, residentName, unitNumber, estateName,
      contactPhone, address, category, priority, urgency,
      title, description, reason, reportedAt,
    } = await req.json();

    // Tenant-scoped recipients — a resident report never alerts the wrong estate.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    // MODERN recipient resolution — customer_admin joins the estate roles so
    // an estate managed by a post-split Customer Administrator still receives
    // resident reports (same confirmed defect class as Start of Shift).
    const recipients = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'estate_manager' || u.role_type === 'dispatcher' || u.role_type === 'customer_admin'
    );
    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin/estate manager found' });
    }

    const isMaintenance = reportType === 'maintenance';
    const severity = isMaintenance ? (urgency || 'medium') : (priority || 'medium');
    const when = reportedAt ? new Date(reportedAt).toLocaleString('en-ZA') : new Date().toLocaleString('en-ZA');
    const subject = isMaintenance
      ? `🔧 Maintenance Request — ${residentName} (Unit ${unitNumber || '—'})`
      : `🔴 Resident Incident — ${residentName} (Unit ${unitNumber || '—'})`;

    // TENANT BRANDING — resolved from the reporting user's authoritative
    // tenant record (customer → reseller → USS platform default). The ENTIRE
    // visible email renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Resident', value: residentName || 'N/A' },
      unitNumber ? { label: 'Unit', value: unitNumber } : null,
      estateName ? { label: 'Estate', value: estateName } : null,
      address ? { label: 'Address', value: address } : null,
      contactPhone ? { label: 'Contact', value: contactPhone } : null,
      { label: 'Reported', value: when },
      { label: 'Category', value: category || 'N/A' },
      isMaintenance ? { label: 'Urgency', value: severity } : { label: 'Priority', value: severity },
      title ? { label: isMaintenance ? 'Issue' : 'Title', value: title } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: isMaintenance ? 'New Maintenance Request' : 'New Resident Incident',
      greeting: 'Hello,',
      intro: `Action required — a resident submitted a ${isMaintenance ? 'maintenance request' : 'incident report'}.`,
      details: brandDetails,
      closing: `${isMaintenance ? 'Reason / Description' : 'Description'}: ${(isMaintenance ? (reason || description) : description) || 'None provided.'}`,
    });
    const emailBody = brandTpl.html;

    const notifTitle = isMaintenance
      ? `🔧 Maintenance Request — ${residentName} (Unit ${unitNumber || '—'})`
      : `🔴 Resident Incident — ${residentName} (Unit ${unitNumber || '—'})`;
    const notifMsg = isMaintenance
      ? `${residentName} (Unit ${unitNumber || '—'}) reported a ${category} maintenance request (${severity}). ${title ? title + '.' : ''}`
      : `${residentName} (Unit ${unitNumber || '—'}) reported a ${category} incident (${severity}). ${title ? title + '.' : ''}`;

    const notificationPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: isMaintenance ? 'maintenance_assigned' : 'incident_critical',
        priority: severity === 'critical' ? 'critical' : 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: isMaintenance ? 'maintenance' : 'incident',
        related_id: reportId,
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((a) => a.email)
      .map((admin) =>
        sendAuditedEmail(base44.asServiceRole, {
          to: admin.email,
          subject,
          html: emailBody.html || emailBody, text: emailBody.text,
          brand,
          recipient_id: admin.id || undefined,
          recipient_name: admin.display_name || admin.full_name || undefined,
          event_type: 'resident_report',
          template_name: isMaintenance ? 'maintenance_request' : 'incident_alert',
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service. Only urgent resident reports
    // (critical/high incident or high/critical-urgency maintenance) push —
    // ordinary informational resident activity never does.
    if (!isMaintenance ? (severity === 'critical' || severity === 'high') : (severity === 'high' || severity === 'critical')) {
      for (const admin of recipients) {
        await sendNativePush(base44.asServiceRole, {
          user_id: admin.id,
          title: notifTitle,
          body: notifMsg,
          priority: severity === 'critical' ? 'critical' : 'high',
          action_label: 'Open Estate Dashboard', action_url: '/EstateManagerDashboard',
          event_key: 'resident_report:' + reportId,
          customer_id: user.customer_id || null,
          reseller_id: user.reseller_id || null,
        }).catch(() => {});
      }
    }

    // TELEGRAM — automatic operational channel for URGENT resident reports
    // (same proven pattern as incidents): failure-isolated per recipient,
    // deterministic event key, ONE shared branded Telegram renderer.
    if (!isMaintenance ? (severity === 'critical' || severity === 'high') : (severity === 'high' || severity === 'critical')) {
      for (const admin of recipients) {
        if (!admin.telegram_connected || admin.telegram_notifications_enabled === false || !admin.telegram_chat_id) continue;
        await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
          'resident_report:' + reportId + ':' + admin.id,
          admin.telegram_chat_id,
          buildBrandedTelegram({
            brand,
            heading: isMaintenance ? 'New Maintenance Request' : 'New Resident Incident',
            details: brandDetails,
            closing: 'Action required — review in the Estate Dashboard.',
          }))
          .catch(() => {});
      }
    }

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('Error in notifyAdminsResidentReport:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});