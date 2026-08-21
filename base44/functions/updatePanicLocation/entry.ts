/**
 * updatePanicLocation
 *
 * Updates a PanicAlert with a fresh high-accuracy GPS fix. Called by the
 * frontend after activation once a fresh GPS position becomes available.
 * The panic is transmitted IMMEDIATELY without waiting for this update.
 * Verifies that the caller is the original activator (or an admin).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { panicId, location, gps_accuracy } = await req.json();

    if (!panicId || !location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return Response.json({ error: 'panicId and valid location required' }, { status: 400 });
    }

    const panic = await base44.asServiceRole.entities.PanicAlert.get(panicId);
    if (!panic) {
      return Response.json({ error: 'Panic not found' }, { status: 404 });
    }

    // Only the activator or an admin may update the location
    if (panic.user_id !== user.id && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const userName = user.display_name || user.full_name;

    await base44.asServiceRole.entities.PanicAlert.update(panicId, {
      location: location,
      gps_accuracy: gps_accuracy || null,
      location_captured_at: nowIso,
      location_source: 'fresh',
      location_updated: true,
      activity_log: [...(panic.activity_log || []), {
        timestamp: nowIso,
        action: 'location_updated',
        by_user_id: user.id,
        by_user_name: userName,
        from_status: panic.status,
        to_status: panic.status,
        notes: `GPS updated: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}${gps_accuracy ? ` (±${Math.round(gps_accuracy)}m)` : ''}`
      }]
    });

    return Response.json({ success: true });

  } catch (error) {
    console.error('Update panic location error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});