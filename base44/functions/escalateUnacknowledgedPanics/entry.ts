/**
 * escalateUnacknowledgedPanics
 *
 * THE SINGLE CENTRAL ESCALATION MECHANISM — replaces the previous client-side
 * 60-second polling monitor (PanicEscalationMonitor) which only worked when a
 * supervisor's browser was open. Uses asServiceRole for cross-user notification
 * dispatch. Requires an authenticated caller: admins can trigger bulk
 * escalation sweeps; any authenticated user can escalate their own panic.
 *
 * Can be called two ways:
 * 1. By scheduled automation (no body) → bulk-checks all active panics.
 * 2. By the activator's client-side 2-minute timer (body: { panicId }) →
 *    escalates one specific panic. This is the PRIMARY (event-driven) path
 *    when the app is open; the scheduled run is the FALLBACK.
 *
 * Escalation levels:
 *   Level 1 at 2 minutes (120s) unacknowledged
 *   Level 2 at 5 minutes (300s) unacknowledged
 *
 * Idempotency: the escalation_count field is the idempotency key. Before
 * escalating, we re-fetch the panic to verify escalation_count hasn't changed
 * since the list was fetched — this prevents concurrent executions (scheduled
 * + client timer firing at the same time) from double-escalating. A panic
 * that is acknowledged/resolved/cancelled is never escalated.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildPanicEmail } from '../../shared/panicEmailTemplate.ts';

const LEVEL_1_THRESHOLD = 120; // 2 minutes
const LEVEL_2_THRESHOLD = 300; // 5 minutes
const MAX_ESCALATION_LEVEL = 2;

const OPERATIONAL_ROLES = ['admin', 'dispatcher', 'supervisor', 'estate_manager', 'management'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — blocks unauthenticated external invocations.
    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch (_) {}
    if (!callerUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { panicId } = body;

    // Bulk check (no panicId) is admin-only — only admins can trigger a
    // system-wide escalation sweep.
    if (!panicId && callerUser.role_type !== 'admin') {
      return Response.json({ error: 'Forbidden — bulk escalation requires admin role' }, { status: 403 });
    }

    // Specific panic: a non-admin may only escalate their OWN panic.
    if (panicId && callerUser.role_type !== 'admin') {
      const ownedPanic = await base44.asServiceRole.entities.PanicAlert.get(panicId);
      if (!ownedPanic || ownedPanic.user_id !== callerUser.id) {
        return Response.json({ error: 'Forbidden — you can only escalate your own panic' }, { status: 403 });
      }
    }

    const now = Date.now();
    let escalatedCount = 0;
    let checkedCount = 0;

    let panicsToCheck;
    if (panicId) {
      // Specific panic (from client-side timer)
      const panic = await base44.asServiceRole.entities.PanicAlert.get(panicId);
      panicsToCheck = panic ? [panic] : [];
    } else {
      // Bulk check (from scheduled automation)
      panicsToCheck = await base44.asServiceRole.entities.PanicAlert.filter({ status: 'active' });
    }

    checkedCount = panicsToCheck.length;

    for (const panic of panicsToCheck) {
      if (panic.status !== 'active') continue;

      const currentLevel = panic.escalation_count || 0;
      if (currentLevel >= MAX_ESCALATION_LEVEL) continue;

      const activatedAtMs = new Date(panic.activated_at).getTime();
      if (isNaN(activatedAtMs)) continue;
      const secondsSinceActivation = (now - activatedAtMs) / 1000;

      let shouldEscalate = false;
      let newLevel = currentLevel;

      if (currentLevel === 0 && secondsSinceActivation >= LEVEL_1_THRESHOLD) {
        shouldEscalate = true;
        newLevel = 1;
      } else if (currentLevel === 1 && secondsSinceActivation >= LEVEL_2_THRESHOLD) {
        shouldEscalate = true;
        newLevel = 2;
      }

      if (!shouldEscalate) continue;

      // Idempotency guard: re-fetch to verify escalation_count hasn't changed
      // since the list was fetched (prevents concurrent double-escalation).
      const freshPanic = await base44.asServiceRole.entities.PanicAlert.get(panic.id);
      if (!freshPanic || freshPanic.status !== 'active') continue;
      if ((freshPanic.escalation_count || 0) !== currentLevel) continue;

      const nowIso = new Date().toISOString();
      const callerName = callerUser?.display_name || callerUser?.full_name || 'System (Auto-Escalation)';
      const callerId = callerUser?.id || 'system';

      // Update the panic with the new escalation level
      await base44.asServiceRole.entities.PanicAlert.update(panic.id, {
        escalated: true,
        escalated_at: nowIso,
        escalation_count: newLevel,
        activity_log: [...(freshPanic.activity_log || []), {
          timestamp: nowIso,
          action: 'escalated',
          by_user_id: callerId,
          by_user_name: callerName,
          from_status: 'active',
          to_status: 'active',
          notes: `Escalation #${newLevel} — panic remains unacknowledged after ${Math.round(secondsSinceActivation)}s`
        }]
      });

      // Send escalation notifications to all operational roles
      const allUsers = await base44.asServiceRole.entities.User.filter({});
      const recipients = allUsers.filter(u => OPERATIONAL_ROLES.includes(u.role_type));

      const googleMapsUrl = freshPanic.location?.lat && freshPanic.location?.lng
        ? `https://www.google.com/maps?q=${freshPanic.location.lat},${freshPanic.location.lng}`
        : null;

      const emailBody = buildPanicEmail({
        userName: freshPanic.user_name, userRole: freshPanic.user_role, badgeNumber: freshPanic.badge_number,
        siteName: freshPanic.site_name, panicNumber: freshPanic.panic_number, activatedAt: freshPanic.activated_at,
        location: freshPanic.location, gpsAccuracy: freshPanic.gps_accuracy,
        notes: freshPanic.notes, status: 'ACTIVE — UNACKNOWLEDGED',
        isEscalation: true
      });

      const escalationTitle = `🚨 PANIC UNACKNOWLEDGED — ESCALATION #${newLevel}`;
      const escalationMsg = `PANIC alert from ${freshPanic.user_name} at ${freshPanic.site_name || 'unknown site'} remains UNACKNOWLEDGED. This is escalation #${newLevel}. RESPOND IMMEDIATELY.${googleMapsUrl ? ` Location: ${googleMapsUrl}` : ''}`;

      await Promise.allSettled(recipients.map(async (recipient) => {
        try {
          await base44.asServiceRole.entities.Notification.create({
            recipient_id: recipient.id,
            recipient_name: recipient.full_name,
            type: 'system',
            priority: 'critical',
            title: escalationTitle,
            message: escalationMsg,
            read: false,
            related_entity: 'panic',
            related_id: panic.id,
            action_url: '/PanicManagement',
            sent_via: ['in_app']
          });

          if (recipient.email) {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: recipient.email,
              from_name: 'USS EMERGENCY',
              subject: escalationTitle,
              body: emailBody
            }).catch(e => console.error(`Escalation email failed for ${recipient.email}:`, e));
          }
        } catch (e) {
          console.error(`Escalation notification failed for ${recipient.id}:`, e);
        }
      }));

      // Send push notification via OneSignal directly
      try {
        const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
        const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');
        if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY) {
          const playerIds = recipients.map(u => u.onesignal_player_id).filter(Boolean);
          if (playerIds.length > 0) {
            await fetch('https://onesignal.com/api/v1/notifications', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`
              },
              body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                include_player_ids: playerIds,
                headings: { en: escalationTitle },
                contents: { en: escalationMsg },
                priority: 10,
                ttl: 0,
                android_channel_id: 'emergency',
                android_visibility: 1,
                android_led_color: 'FFFF0000',
                android_accent_color: 'FFC41E3A',
                data: { type: 'panic_escalation', panicId: panic.id, level: newLevel, actionUrl: '/PanicManagement' }
              })
            }).catch(e => console.error('OneSignal escalation push failed:', e));
          }
        }
      } catch (e) {
        console.error('Escalation push dispatch failed:', e);
      }

      escalatedCount++;
    }

    return Response.json({ success: true, escalatedCount, checked: checkedCount });
  } catch (error) {
    console.error('Panic escalation check error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});