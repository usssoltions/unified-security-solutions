import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { fail, validCoords, distanceMeters, geofenceEnforced } from '../../shared/guardGeo.ts';

/**
 * checkpointSubmission — server-authoritative patrol checkpoint submission.
 *
 * Replaces the client-side double-create (PatrolLog + ChecklistCompletion)
 * that fell back to a STRIPPED offline record on any failure — losing the
 * checklist answers, signature, photos/videos, QR and tenant stamps, and
 * swallowing the real error behind "Server unavailable".
 *
 * Security posture (same pattern as shiftAccess):
 *  - Caller, tenant and the ACTIVE shift are resolved SERVER-SIDE from the
 *    authenticated session — never from client-supplied ids.
 *  - The checkpoint must belong to the shift's own site; the record is
 *    stamped from the SERVER-validated checkpoint, not from client data.
 *  - Tenant ownership (customer_id / reseller_id) is stamped server-side.
 *  - IDEMPOTENT via a client-generated submission_key: a retry (manual
 *    resend or offline sync) can never create duplicate PatrolLog or
 *    ChecklistCompletion records, including after a partial success.
 *
 * Payload: { submission_key, patrol: {...}, completion: {...}|null }
 */

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await base44.auth.me();
    if (!caller) return fail('Unauthorized', 'unauthorized', 401);
    if (caller.role_type !== 'guard') return fail('Only guards can submit checkpoint scans', 'forbidden', 403);
    if (!caller.customer_id) return fail('No tenant scope resolved for this account — access denied', 'no_tenant', 403);

    const body = await req.json().catch(() => ({}));
    const submission = body.submission || body;
    const submissionKey = String(submission.submission_key || '').trim();
    if (!submissionKey || submissionKey.length < 8) {
      return fail('Missing submission reference — please rescan the checkpoint', 'bad_submission', 400);
    }

    // ── Resolve the guard's ACTIVE shift server-side ──────────────────────
    const shifts = await svc.entities.Shift.filter({
      guard_id: caller.id, customer_id: caller.customer_id, status: 'active',
    }).catch(() => []);
    const shift = (shifts || [])[0];
    if (!shift) return fail('No active shift found — start a shift before scanning checkpoints', 'no_active_shift', 400);

    const site = await svc.entities.Site.get(shift.site_id).catch(() => null);
    if (!site) return fail('Shift site not found', 'site_not_found', 400);

    const checkpointId = String((submission.patrol && submission.patrol.checkpoint_id) || '').trim();
    const cp = (site.checkpoints || []).find((c) => c.id === checkpointId);
    if (!cp) return fail('This checkpoint is not part of your current site — please rescan', 'checkpoint_invalid', 400);

    // ── IDEMPOTENCY: same submission_key already saved → return existing ──
    const existingPatrols = await svc.entities.PatrolLog.filter({ submission_key: submissionKey }).catch(() => []);
    const patrolExists = !!(existingPatrols && existingPatrols.length);
    let completionId = null;
    if (submission.completion) {
      const existingComps = await svc.entities.ChecklistCompletion.filter({ submission_key: submissionKey }).catch(() => []);
      completionId = existingComps && existingComps.length ? existingComps[0].id : null;
    }
    if (patrolExists && (completionId || !submission.completion)) {
      return Response.json({ ok: true, duplicate: true, patrol_id: existingPatrols[0].id, completion_id: completionId });
    }

    // ── Server-stamped PatrolLog ──────────────────────────────────────────
    let patrolId = existingPatrols[0] ? existingPatrols[0].id : null;
    if (!patrolId) {
      const inLoc = (submission.patrol && submission.patrol.location) || null;
      const enforced = await geofenceEnforced(svc, shift.customer_id || caller.customer_id);
      const radius = (typeof site.geofence_radius === 'number' && site.geofence_radius > 0) ? site.geofence_radius : 100;
      const dist = (validCoords(inLoc) && cp.location && validCoords(cp.location))
        ? distanceMeters(inLoc.lat, inLoc.lng, cp.location.lat, cp.location.lng)
        : null;
      let notes = String((submission.patrol && submission.patrol.notes) || '');
      if (!enforced) notes = [notes, 'Geofence enforcement disabled'].filter(Boolean).join('\n');
      const created = await svc.entities.PatrolLog.create({
        submission_key: submissionKey,
        guard_id: caller.id,
        guard_name: caller.display_name || caller.full_name || caller.email || 'Guard',
        shift_id: shift.id,
        site_id: shift.site_id,
        checkpoint_id: cp.id,
        checkpoint_name: cp.name,
        qr_code: cp.qr_code || String(submission.patrol?.qr_code || ''),
        checklist_name: (submission.patrol && submission.patrol.checklist_name) || null,
        location: validCoords(inLoc) ? { lat: inLoc.lat, lng: inLoc.lng } : null,
        checkpoint_location: (cp.location && validCoords(cp.location)) ? { lat: cp.location.lat, lng: cp.location.lng } : null,
        distance_metres: dist === null ? null : Math.round(dist),
        gps_status: dist !== null ? (dist <= radius ? 'verified' : 'not_verified') : (validCoords(inLoc) ? 'not_verified' : 'unavailable'),
        timestamp: (submission.patrol && submission.patrol.timestamp) || new Date().toISOString(),
        verified: dist !== null ? dist <= radius : true,
        notes,
        customer_id: shift.customer_id || caller.customer_id,
        reseller_id: shift.reseller_id || caller.reseller_id || null,
      });
      patrolId = created.id;
    }

    // ── Server-stamped ChecklistCompletion (only when not already saved) ──
    if (submission.completion && !completionId) {
      const templateId = String(submission.completion.template_id || '');
      if (templateId && templateId !== 'manual') {
        const tpl = await svc.entities.ChecklistTemplate.get(templateId).catch(() => null);
        if (!tpl || tpl.site_id !== shift.site_id) {
          return fail('The checklist template for this checkpoint could not be verified — please rescan', 'template_invalid', 400);
        }
      }
      const created = await svc.entities.ChecklistCompletion.create({
        submission_key: submissionKey,
        template_id: templateId || 'manual',
        template_name: submission.completion.template_name || 'Manual Checklist',
        guard_id: caller.id,
        guard_name: caller.display_name || caller.full_name || caller.email || 'Guard',
        customer_id: shift.customer_id || caller.customer_id,
        reseller_id: shift.reseller_id || caller.reseller_id || null,
        shift_id: shift.id,
        site_id: shift.site_id,
        checkpoint_id: cp.id,
        qr_code_scanned: cp.qr_code || String(submission.completion.qr_code_scanned || ''),
        completed_items: Array.isArray(submission.completion.completed_items) ? submission.completion.completed_items : [],
        signature: submission.completion.signature || null,
        location: (submission.completion.location && validCoords(submission.completion.location)) ? { lat: submission.completion.location.lat, lng: submission.completion.location.lng } : null,
        completed_at: submission.completion.completed_at || new Date().toISOString(),
        status: submission.completion.status || 'completed',
        notes: String(submission.completion.notes || ''),
        media: Array.isArray(submission.completion.media) ? submission.completion.media : [],
      });
      completionId = created.id;
    }

    return Response.json({ ok: true, duplicate: false, patrol_id: patrolId, completion_id: completionId || null });
  } catch (error) {
    return Response.json({ error: error.message || 'Submission failed' }, { status: 500 });
  }
}