import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Roles permitted to override a blacklist block. The caller's session is the
// single source of truth — there are no client-supplied PINs or supervisor ids.
const SUPERVISOR_ROLES = new Set(['admin', 'dispatcher', 'estate_manager']);

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // 1) Authenticate from the live session. No token = no override.
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // 2) Authorize: only supervisor roles may override.
    if (!SUPERVISOR_ROLES.has(user.role_type)) {
      return Response.json({ error: 'Forbidden — supervisor role required to override a blacklist block' }, { status: 403 });
    }

    // 3) Validate payload.
    const body = await req.json().catch(() => ({}));
    const accessLogId = (body && body.accessLogId) ? String(body.accessLogId) : '';
    const reason = (body && body.reason ? String(body.reason) : '').trim();
    if (!accessLogId) return Response.json({ error: 'accessLogId is required' }, { status: 400 });
    if (!reason) return Response.json({ error: 'An override reason is required' }, { status: 400 });

    // 4) Load the blocked access log (service role — the record may belong to a guard).
    let log = null;
    try {
      log = await base44.asServiceRole.entities.AccessLog.get(accessLogId);
    } catch (_) { log = null; }
    if (!log) return Response.json({ error: 'Access log not found' }, { status: 404 });

    if (log.status !== 'blacklisted') {
      return Response.json({ error: 'Record is not in a blacklisted state — override not applicable' }, { status: 409 });
    }

    // 5) Convert the blocked record into an approved entry (lifecycle continues to exit).
    const now = new Date().toISOString();
    await base44.asServiceRole.entities.AccessLog.update(accessLogId, {
      status: 'inside',
      event_type: 'entry',
      override_approved_by: user.id,
      override_approved_by_name: user.full_name || user.email || '',
      override_approved_at: now,
      override_reason: reason,
      flagged: false,
      flag_reason: '',
    });

    // 6) Permanent audit trail (user-scoped create under the supervisor's session).
    await base44.entities.BlacklistOverride.create({
      access_log_id: accessLogId,
      blacklist_entry_id: log.blacklist_match_id || '',
      identifier_value: log.sa_id_number || log.driver_licence_number || log.vehicle_registration || '',
      person_name: log.person_name || '',
      supervisor_id: user.id,
      supervisor_name: user.full_name || user.email || '',
      supervisor_role: user.role_type || '',
      reason,
      action: 'approved',
    });

    return Response.json({ ok: true, accessLogId });
  } catch (error) {
    return Response.json({ error: error?.message || 'Override failed' }, { status: 500 });
  }
}