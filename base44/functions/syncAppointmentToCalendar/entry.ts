import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * syncAppointmentToCalendar — per-customer Google Calendar sync (APP_USER
 * connector). Each medical practice connects THEIR OWN Google Calendar via
 * OAuth; appointments belonging to that practice sync to that calendar only.
 *
 * Connection: the calling practice admin's own OAuth connection is resolved via
 * getCurrentAppUserConnection(connectorId). If the practice has not connected a
 * calendar, the call returns { not_connected: true } (non-fatal — appointment
 * operations never break because of calendar sync).
 *
 * Customer isolation:
 *   - The appointment is fetched via asServiceRole, but a practice admin may
 *     only sync appointments whose customer_id matches their own. Platform
 *     oversight (role 'admin' / admin_level 'platform') may sync any.
 *   - calendar_event_id is stored ON the appointment (scoped to it), so
 *     update/reschedule updates the SAME event and cancellation removes the
 *     correct event. No cross-customer calendar access is possible — each
 *     practice's events live in that practice's own connected calendar.
 *
 * Privacy: clinical notes / diagnosis are NEVER placed into Google Calendar —
 * only scheduling metadata (patient name, service, times, status).
 *
 * Actions:
 *   - "probe": connection check only (no appointment needed) → { connected }.
 *   - "sync" (default): create-or-update the event for the appointment.
 *   - "delete": remove the event (used when an appointment is cancelled).
 */
const CONNECTOR_ID = '6a97c1dcdc06dfae9a38934b';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { appointment_id, action = 'sync' } = await req.json();

    // ── Probe: connection status only ──
    if (action === 'probe') {
      try {
        const conn = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
        return Response.json({ connected: !!conn?.accessToken });
      } catch (_) {
        return Response.json({ connected: false });
      }
    }

    if (!appointment_id) return Response.json({ error: 'appointment_id is required' }, { status: 400 });

    const appts = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
    const appt = appts && appts[0];
    if (!appt) return Response.json({ error: 'Appointment not found' }, { status: 404 });

    // Customer isolation — a practice admin may only sync their own practice's
    // appointments to their own calendar.
    const isOversight = user.role === 'admin' || user.admin_level === 'platform';
    if (!isOversight && appt.customer_id !== user.customer_id) {
      return Response.json({ error: 'Forbidden — appointment belongs to another practice' }, { status: 403 });
    }

    // Per-customer OAuth: the calling practice admin's own calendar connection.
    let accessToken;
    try {
      const conn = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
      accessToken = conn?.accessToken;
    } catch (_) {
      return Response.json({ success: false, not_connected: true, message: 'Practice has not connected a Google Calendar' });
    }
    if (!accessToken) return Response.json({ success: false, not_connected: true, message: 'Practice has not connected a Google Calendar' });

    const calendarApi = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

    // ── Delete the calendar event when an appointment is cancelled ──
    if (action === 'delete' && appt.calendar_event_id) {
      try {
        await fetch(`${calendarApi}/${appt.calendar_event_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch (_) { /* event may already be gone */ }
      await base44.asServiceRole.entities.Appointment.update(appointment_id, { calendar_event_id: null });
      return Response.json({ success: true, deleted: true });
    }

    // Scheduling metadata only — NO clinical notes/diagnosis in Google Calendar.
    const eventBody: any = {
      summary: `${appt.service_name || 'Appointment'} — ${appt.patient_name || 'Patient'}`,
      description: [
        `Patient: ${appt.patient_name || ''}`,
        `Service: ${appt.service_name || ''}`,
        appt.therapist_name ? `Therapist: ${appt.therapist_name}` : '',
        appt.status ? `Status: ${appt.status.replace(/_/g, ' ')}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: appt.start_time, timeZone: 'Africa/Johannesburg' },
      end: { dateTime: appt.end_time, timeZone: 'Africa/Johannesburg' },
    };
    if (appt.status === 'cancelled') eventBody.status = 'cancelled';

    let eventId = appt.calendar_event_id;
    if (eventId) {
      const resp = await fetch(`${calendarApi}/${eventId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      });
      if (!resp.ok) {
        // Event gone (410/404) → create a fresh one below.
        if (resp.status !== 404 && resp.status !== 410) {
          const err = await resp.text();
          return Response.json({ error: 'Failed to update calendar event', details: err }, { status: 502 });
        }
        eventId = null;
      }
    }

    if (!eventId) {
      const resp = await fetch(calendarApi, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(eventBody),
      });
      const data = await resp.json();
      if (!resp.ok) return Response.json({ error: 'Failed to create calendar event', details: data }, { status: 502 });
      eventId = data.id;
      await base44.asServiceRole.entities.Appointment.update(appointment_id, { calendar_event_id: eventId });
    }

    return Response.json({ success: true, calendar_event_id: eventId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}