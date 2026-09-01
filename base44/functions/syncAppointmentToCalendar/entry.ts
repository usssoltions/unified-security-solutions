import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * syncAppointmentToCalendar — syncs a medical Appointment to the connected
 * Google Calendar (SHARED connector — the builder's/practice's calendar).
 *
 * - Creates a calendar event for a new appointment and stores the event id
 *   back on the Appointment (calendar_event_id) so subsequent syncs UPDATE the
 *   same event instead of creating duplicates.
 * - action "sync" (default): create-or-update.
 * - action "delete": removes the calendar event (used when an appointment is
 *   cancelled).
 *
 * Non-fatal: calendar sync never blocks appointment operations — the function
 * reports its own errors so the caller can ignore them.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { appointment_id, action = 'sync' } = await req.json();
    if (!appointment_id) return Response.json({ error: 'appointment_id is required' }, { status: 400 });

    const appts = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
    const appt = appts && appts[0];
    if (!appt) return Response.json({ error: 'Appointment not found' }, { status: 404 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    // --- Delete the calendar event when an appointment is cancelled ---
    if (action === 'delete' && appt.calendar_event_id) {
      try {
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${appt.calendar_event_id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
        );
      } catch (_) { /* event may already be gone */ }
      await base44.asServiceRole.entities.Appointment.update(appointment_id, { calendar_event_id: null });
      return Response.json({ success: true, deleted: true });
    }

    const eventBody: any = {
      summary: `${appt.service_name || 'Appointment'} — ${appt.patient_name || 'Patient'}`,
      description: [
        `Patient: ${appt.patient_name || ''}`,
        `Service: ${appt.service_name || ''}`,
        appt.therapist_name ? `Therapist: ${appt.therapist_name}` : '',
        appt.notes ? `Notes: ${appt.notes}` : '',
        appt.status ? `Status: ${appt.status.replace(/_/g, ' ')}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: appt.start_time, timeZone: 'Africa/Johannesburg' },
      end: { dateTime: appt.end_time, timeZone: 'Africa/Johannesburg' },
    };
    if (appt.status === 'cancelled') eventBody.status = 'cancelled';

    let eventId = appt.calendar_event_id;
    if (eventId) {
      const resp = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        }
      );
      if (!resp.ok) {
        const err = await resp.text();
        // If the event no longer exists (410/404), create a fresh one.
        if (resp.status === 404 || resp.status === 410) {
          eventId = null;
        } else {
          return Response.json({ error: 'Failed to update calendar event', details: err }, { status: 502 });
        }
      }
    }

    if (!eventId) {
      const resp = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(eventBody),
        }
      );
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