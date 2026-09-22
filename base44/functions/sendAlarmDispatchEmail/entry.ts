/**
 * sendAlarmDispatchEmail — SERVER-SIDE BRANDED DISPATCH for the dispatcher's
 * alarm-dispatch guard email (DispatchAlarm). The client now only supplies the
 * AlarmResponse id it just created; this function resolves the alarm record,
 * the assigned guard and the effective tenant branding AUTHORITATIVELY
 * (resolveCommunicationBrand) and records the delivery attempt in the
 * NotificationDelivery audit trail. The existing in-app alert, push and the
 * manual WhatsApp deep-link flow are untouched.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({})) || {};
    const alarmId = String(body.alarm_response_id || '');
    if (!alarmId) return Response.json({ error: 'alarm_response_id is required' }, { status: 400 });

    const rows = await svc.entities.AlarmResponse.filter({ id: alarmId }).catch(() => []);
    const alarm = (rows && rows[0]) || null;
    if (!alarm) return Response.json({ error: 'Alarm response not found' }, { status: 404 });

    // TENANT CHECK — the alarm record's tenant wins; a cross-tenant id is
    // rejected (platform admins excepted).
    const isPlatformCaller = caller.role_type === 'admin' || caller.role_type === 'platform_admin'
      || caller.admin_level === 'platform';
    if (!isPlatformCaller && alarm.customer_id && caller.customer_id
        && String(alarm.customer_id) !== String(caller.customer_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    if (!alarm.assigned_to) {
      return Response.json({ error: 'No guard assigned to this alarm response' }, { status: 400 });
    }

    const gRows = await svc.entities.User.filter({ id: String(alarm.assigned_to) }).catch(() => []);
    const guard = (gRows && gRows[0]) || null;
    if (!guard || !guard.email) {
      return Response.json({ error: 'Assigned guard has no email address' }, { status: 400 });
    }

    const brand = await resolveCommunicationBrand(svc, {
      customer_id: alarm.customer_id || caller.customer_id || null,
      reseller_id: alarm.reseller_id || caller.reseller_id || null,
    });

    const alarmTypeLabel = String(alarm.alarm_type || 'alarm').replace(/_/g, ' ').toUpperCase();
    const mapsUrl = (alarm.location && Number.isFinite(Number(alarm.location.lat))
      && Number.isFinite(Number(alarm.location.lng)))
      ? `https://www.google.com/maps?q=${alarm.location.lat},${alarm.location.lng}`
      : null;

    const tpl = buildBrandedEmail({
      brand,
      heading: `Alarm Response Assigned — ${alarmTypeLabel}`,
      greeting: `Dear ${guard.display_name || guard.full_name || 'Guard'},`,
      intro: 'You have been dispatched to respond to an alarm. Open the app to acknowledge and get directions.',
      details: [
        { label: 'Alarm Type', value: String(alarm.alarm_type || '—').replace(/_/g, ' ') },
        { label: 'Address', value: alarm.address || '—' },
        { label: 'Client', value: alarm.client_name || '—' },
        { label: 'Priority', value: alarm.priority || 'high' },
        { label: 'Dispatched By', value: alarm.dispatched_by_name || '—' },
        mapsUrl ? { label: 'Location', value: mapsUrl } : null,
      ],
      closing: 'Please acknowledge the dispatch in the app immediately.',
    });
    const res = await sendAuditedEmail(svc, {
      to: guard.email,
      subject: `🚨 ALARM RESPONSE ASSIGNED — ${alarmTypeLabel}`,
      html: tpl.html,
      text: tpl.text,
      brand,
      customer_id: alarm.customer_id || caller.customer_id || null,
      reseller_id: alarm.reseller_id || null,
      recipient_id: guard.id,
      recipient_name: guard.display_name || guard.full_name,
      event_type: 'alarm_dispatch',
      reference_id: alarm.id,
    });
    return Response.json({ sent: res.ok ? 1 : 0, error: res.ok ? null : res.error });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}