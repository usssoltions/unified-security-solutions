import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * startMedicalSession — Atomic, idempotent Clinical Session creation.
 *
 * A therapist (or practice admin / platform admin) starts a session from an
 * Arrived appointment. This function is the SINGLE authority for session
 * creation so that duplicate taps, retries, or concurrent calls never create
 * more than ONE session per appointment.
 *
 * Idempotency:
 *   1. If the appointment already has session_id → return that session (resume).
 *   2. Else if a Session already exists for this appointment_id → return it and
 *      re-link the appointment (resume).
 *   3. Else create exactly one Session, set appointment.status='in_session' +
 *      appointment.session_id, and return the new session.
 *
 * Authorization (server-side):
 *   - Caller must be therapist / practice_admin / platform admin.
 *   - Caller must belong to the SAME customer as the appointment (tenant
 *     isolation), unless the caller is a platform admin.
 *
 * Returns { session, created }.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const role = user.role_type || '';
    const isPlatformAdmin = role === 'admin' || role === 'platform_admin' || user.admin_level === 'platform';
    const canStart = isPlatformAdmin || role === 'therapist' || role === 'practice_admin';
    if (!canStart) {
      return Response.json({ error: 'Only a therapist or practice admin may start a session' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { appointment_id } = body;
    if (!appointment_id) return Response.json({ error: 'appointment_id required' }, { status: 400 });

    // Fetch the appointment (service role — atomic + cross-user safe).
    const apts = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
    const apt = apts[0];
    if (!apt) return Response.json({ error: 'Appointment not found' }, { status: 404 });

    // Tenant isolation: non-platform callers may only start sessions in their
    // own customer scope.
    if (!isPlatformAdmin && apt.customer_id !== user.customer_id) {
      return Response.json({ error: 'Appointment is outside your practice scope' }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const therapistName = user.full_name || user.display_name || user.email || 'Therapist';

    // 1. Already linked → resume.
    if (apt.session_id) {
      const existing = await base44.asServiceRole.entities.Session.get(apt.session_id).catch(() => null);
      if (existing) {
        // Ensure appointment reflects in-session state (idempotent).
        if (apt.status !== 'in_session') {
          await base44.asServiceRole.entities.Appointment.update(apt.id, { status: 'in_session' });
        }
        return Response.json({ success: true, session: existing, created: false });
      }
    }

    // 2. Orphan session for this appointment → resume + re-link.
    const orphanSessions = await base44.asServiceRole.entities.Session.filter({ appointment_id: apt.id });
    if (orphanSessions && orphanSessions.length > 0) {
      const session = orphanSessions[0];
      await base44.asServiceRole.entities.Appointment.update(apt.id, {
        status: 'in_session', session_id: session.id,
      });
      return Response.json({ success: true, session, created: false });
    }

    // 3. Create exactly one Session, linked to the appointment.
    const session = await base44.asServiceRole.entities.Session.create({
      customer_id: apt.customer_id,
      reseller_id: apt.reseller_id || undefined,
      appointment_id: apt.id,
      patient_id: apt.patient_id,
      patient_name: apt.patient_name,
      employer_id: apt.employer_id || undefined,
      employer_name: apt.employer_name || undefined,
      service_id: apt.service_id || undefined,
      service_name: apt.service_name || undefined,
      therapist_id: user.id,
      therapist_name: therapistName,
      actual_start_time: nowIso,
      status: 'in_progress',
    });

    await base44.asServiceRole.entities.Appointment.update(apt.id, {
      status: 'in_session',
      session_id: session.id,
    });

    return Response.json({ success: true, session, created: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}