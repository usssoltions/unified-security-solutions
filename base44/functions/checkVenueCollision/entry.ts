import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * checkVenueCollision — Server-side collision protection for venue bookings.
 *
 * Checks: requested_start < existing_end AND requested_end > existing_start
 * against all existing bookings for the same venue that are not cancelled/rejected.
 *
 * Also checks blocked_periods on the Venue entity.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { venue_id, start_datetime, end_datetime, exclude_booking_id } = await req.json();
    if (!venue_id || !start_datetime || !end_datetime) {
      return Response.json({ error: 'venue_id, start_datetime, end_datetime required' }, { status: 400 });
    }

    const reqStart = new Date(start_datetime);
    const reqEnd = new Date(end_datetime);
    if (reqEnd <= reqStart) {
      return Response.json({ collision: true, reason: 'End time must be after start time' });
    }

    // Fetch all bookings for this venue (active states only)
    const allBookings = await base44.asServiceRole.entities.VenueBooking.filter({ venue_id });
    const activeStatuses = ['pending', 'approved', 'completed'];
    const conflicting = allBookings.filter(b => {
      if (exclude_booking_id && b.id === exclude_booking_id) return false;
      if (!activeStatuses.includes(b.status)) return false;
      if (!b.start_datetime || !b.end_datetime) return false;
      const existStart = new Date(b.start_datetime);
      const existEnd = new Date(b.end_datetime);
      // Collision: requested_start < existing_end AND requested_end > existing_start
      return reqStart < existEnd && reqEnd > existStart;
    });

    if (conflicting.length > 0) {
      return Response.json({
        collision: true,
        reason: 'Time slot overlaps with existing booking',
        conflicting_bookings: conflicting.map(b => ({
          id: b.id,
          start_datetime: b.start_datetime,
          end_datetime: b.end_datetime,
          status: b.status,
          resident_name: b.resident_name
        }))
      });
    }

    // Check blocked periods on venue
    const venues = await base44.asServiceRole.entities.Venue.filter({ id: venue_id });
    const venue = venues[0];
    if (venue?.blocked_periods) {
      for (const bp of venue.blocked_periods) {
        if (!bp.start_datetime || !bp.end_datetime) continue;
        const bpStart = new Date(bp.start_datetime);
        const bpEnd = new Date(bp.end_datetime);
        if (reqStart < bpEnd && reqEnd > bpStart) {
          return Response.json({ collision: true, reason: `Venue is blocked: ${bp.reason || 'maintenance'}` });
        }
      }
    }

    return Response.json({ collision: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}