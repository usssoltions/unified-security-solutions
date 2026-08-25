/**
 * escalateUnacknowledgedPanics
 *
 * THE SINGLE CENTRAL ESCALATION MECHANISM (backend-authoritative — works with
 * no browser open). Uses asServiceRole for cross-user notification dispatch.
 *
 * Called two ways:
 *  1. Scheduled automation (no body) → bulk-checks all ACTIVE panics.
 *     Bulk sweeps require a Platform Admin caller.
 *  2. Activator's client-side 2-minute timer ({ panicId }) → escalates one
 *     specific panic (PRIMARY event-driven path while the app is open).
 *
 * Escalation levels:
 *   Level 1 at 2 minutes (120s) unacknowledged
 *   Level 2 at 5 minutes (300s) unacknowledged  (MAX)
 *
 * HARDENING (emergency-safety):
 *   - Before EVERY escalation action the CURRENT panic is re-fetched and
 *     verified eligible: status MUST be exactly 'active'. Acknowledged,
 *     assigned, accepted, resolved or cancelled panics are NEVER escalated.
 *   - Idempotency: escalation_count is the idempotency key. A level already
 *     sent is never re-sent; once MAX_ESCALATION_LEVEL is reached no further
 *     escalation occurs.
 *   - Escalation notifications are TENANT-SCOPED: a customer/reseller panic
 *     only alerts operational roles inside that tenant. A platform-level
 *     panic (no tenant) alerts all operational roles.
 *   - Every escalation is recorded in PlatformAuditLog.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildPanicEmail } from '../../shared/panicEmailTemplate.ts';

const LEVEL_1_THRESHOLD = 120; // 2 minutes
const LEVEL_2_THRESHOLD = 300; // 5 minutes
const MAX_ESCALATION_LEVEL = 2;

const OPERATIONAL_ROLES = ['admin', 'platform_admin', 'dispatcher', 'supervisor', 'estate_manager', 'management', 'practice_admin'];

function isPlatformAdminCaller(user) {
  return !!user && (
    user.role_type === 'admin' ||
    user.role_type === 'platform_admin' ||
    user.admin_level === 'platform'
  );
}

/** Tenant filter for escalation recipients — never leak across tenants. */
function panicRecipientFilter(panic) {
  if (panic.customer_id) return { customer_id: panic.customer_id };
  if (panic.reseller_id) return { reseller_id: panic.reseller_id };
  return {}; // platform-level panic → all operational roles
}

async function auditEscalation(base44, caller, panic, level, secondsSinceActivation) {
  try {
    await base44.asServiceRole.entities.PlatformAuditLog.create({
      event_type: 'panic.escalated',
      user_id: caller?.id || 'system',
      user_name: caller?.display_name || caller?.full_name || 'System (Auto-Escalation)',
      customer_id: panic.customer_id || null,
      reseller_id: panic.reseller_id || null,
      module_key: 'OPERATIONS',
      entity_name: 'PanicAlert',
      entity_id: panic.id,
      action: 'escalated',
      new_values: `level=${level}`,
      notes: `Escalation #${level} — unacknowledged after ${Math.round(secondsSinceActivation)}s`,
    });
  } catch (e) {
    console.error('Escalation audit log failed:', e);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — blocks unauthenticated external invocations.
    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch (_) {}
    if (!callerUser) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { panicId } = body;

    const platformCaller = isPlatformAdminCaller(callerUser);

    // Bulk check (no panicId) is Platform-Admin-only.
    if (!panicId && !platformCaller) {
      return Response.json({ error: 'Forbidden — bulk escalation requires Platform Admin role' }, { status: 403 });
    }

    // Specific panic: a non-platform caller may only escalate their OWN panic.
    if (panicId && !platformCaller) {
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
      const panic = await base44.asServiceRole.entities.PanicAlert.get(panicId);
      panicsToCheck = panic ? [panic] : [];
    } else {
      // Bulk: only ACTIVE panics (acknowledged/resolved/cancelled excluded).
      panicsToCheck = await base44.asServiceRole.entities.PanicAlert.filter({ status: 'active' });
    }

    checkedCount = panicsToCheck.length;

    for (const panic of panicsToCheck) {
      // HARD GUARD: only 'active' (unacknowledged) panics escalate.
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

      // Idempotency + staleness guard: re-fetch the CURRENT record and
      // re-verify it is still active at the expected escalation level.
      const freshPanic = await base44.asServiceRole.entities.PanicAlert.get(panic.id);
      if (!freshPanic) continue;
      if (freshPanic.status !== 'active') continue;            // acknowledged/resolved/cancelled → STOP
      if ((freshPanic.escalation_count || 0) !== currentLevel) continue; // level changed → skip

      const nowIso = new Date().toISOString();
      const callerName = callerUser?.display_name || callerUser?.full_name || 'System (Auto-Escalation)';
      const callerId = callerUser?.id || 'system';

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

      await auditEscalation(base44, callerUser, freshPanic, newLevel, secondsSinceActivation);

      // TENANT-SCOPED escalation notifications (no cross-tenant leak).
      const recipients = await base44.asServiceRole.entities.User.filter(panicRecipientFilter(freshPanic));
      const operationalRecipients = recipients.filter(u => OPERATIONAL_ROLES.includes(u.role_type));

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

      await Promise.allSettled(operationalRecipients.map(async (recipient) => {
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

      // Send push notification via OneSignal directly (tenant-scoped players).
      try {
        const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
        const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');
        if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY) {
          const playerIds = operationalRecipients.map(u => u.onesignal_player_id).filter(Boolean);
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