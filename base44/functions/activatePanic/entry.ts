/**
 * activatePanic
 *
 * Creates a PanicAlert record IMMEDIATELY and dispatches notifications to all
 * authorised recipients (admins, dispatchers, supervisors, estate managers).
 * Uses asServiceRole throughout — never depends on the caller's RLS to list
 * users or create cross-user notifications (the bug that broke initial Incident
 * notifications). Does NOT require location — the panic is sent even if GPS
 * is unavailable. A fresh GPS fix can update the record later via
 * updatePanicLocation.
 *
 * Any authenticated user may activate a panic. Management (acknowledge/assign/
 * resolve) is handled by managePanic and restricted to operational roles.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildPanicEmail, esc } from '../../shared/panicEmailTemplate.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { location, gps_accuracy, location_captured_at, location_source, notes, shiftId, siteId, siteName } = body;

    const nowIso = new Date().toISOString();
    const panicNumber = `PNC-${Date.now()}`;
    const userName = user.display_name || user.full_name || 'Unknown User';

    // 1. Create the PanicAlert record IMMEDIATELY (before any notifications)
    const panic = await base44.asServiceRole.entities.PanicAlert.create({
      panic_number: panicNumber,
      user_id: user.id,
      user_name: userName,
      user_role: user.role_type || '',
      badge_number: user.badge_number || '',
      site_id: siteId || '',
      site_name: siteName || user.site_name || '',
      shift_id: shiftId || '',
      status: 'active',
      priority: 'critical',
      notes: notes || '',
      location: location || null,
      gps_accuracy: gps_accuracy || null,
      location_captured_at: location_captured_at || nowIso,
      location_source: location_source || (location ? 'cached' : 'unavailable'),
      location_updated: false,
      activated_at: nowIso,
      notification_sent: false,
      escalated: false,
      escalation_count: 0,
      customer_id: user.customer_id || undefined,
      reseller_id: user.reseller_id || undefined,
      activity_log: [{
        timestamp: nowIso,
        action: 'activated',
        by_user_id: user.id,
        by_user_name: userName,
        from_status: null,
        to_status: 'active',
        notes: notes || 'Panic activated'
      }]
    });

    // 2. Find recipients — scoped by role AND tenant. Platform admins (explicit)
    //    notify across all tenants; everyone else only reaches management in
    //    their own customer/reseller scope so a panic never alerts the wrong tenant.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    const recipients = allUsers.filter(u =>
      ['admin', 'dispatcher', 'supervisor', 'estate_manager', 'management'].includes(u.role_type)
    );

    const googleMapsUrl = location?.lat && location?.lng
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    const emailBody = buildPanicEmail({
      userName, userRole: user.role_type, badgeNumber: user.badge_number,
      siteName: siteName || user.site_name, panicNumber, activatedAt: nowIso,
      location, gpsAccuracy: gps_accuracy, notes, status: 'ACTIVE'
    });

    // 3. Dispatch in-app notifications + branded emails in parallel.
    //    Use Promise.allSettled so one channel failure never blocks others.
    const notifResults = await Promise.allSettled(recipients.map(async (recipient) => {
      try {
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: recipient.id,
          recipient_name: recipient.full_name,
          type: 'system',
          priority: 'critical',
          title: `🚨 PANIC ALERT — ${userName}`,
          message: `EMERGENCY: ${userName} (${user.role_type || 'user'}) has triggered a PANIC alert at ${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Immediate response required!`,
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
            subject: `🚨 PANIC ALERT — ${userName} — IMMEDIATE RESPONSE REQUIRED`,
            body: emailBody
          }).catch(e => console.error(`Panic email failed for ${recipient.email}:`, e));
        }
        return { ok: true };
      } catch (e) {
        console.error(`Panic notification failed for ${recipient.id}:`, e);
        return { ok: false, error: e.message };
      }
    }));

    const successCount = notifResults.filter(r => r.status === 'fulfilled').length;

    // 4. Send push notification via OneSignal directly (sendPushNotification
    //    requires user auth which asServiceRole doesn't have, so we call
    //    OneSignal directly here).
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
              headings: { en: `🚨 PANIC ALERT — ${userName}` },
              contents: { en: `EMERGENCY: ${userName} has triggered a PANIC alert. ${googleMapsUrl ? `Location: ${googleMapsUrl}` : 'Immediate response required!'}` },
              priority: 10,
              ttl: 0,
              android_channel_id: 'emergency',
              android_visibility: 1,
              android_led_color: 'FFFF0000',
              android_accent_color: 'FFC41E3A',
              data: {
                type: 'panic',
                panicId: panic.id,
                userName: userName,
                location: location,
                timestamp: nowIso
              }
            })
          }).catch(e => console.error('OneSignal push failed:', e));
        }
      }
    } catch (e) {
      console.error('Push notification dispatch failed:', e);
    }

    // 5. Mark notification_sent and append activity log entry
    await base44.asServiceRole.entities.PanicAlert.update(panic.id, {
      notification_sent: successCount > 0,
      activity_log: [...(panic.activity_log || []), {
        timestamp: new Date().toISOString(),
        action: 'notifications_sent',
        by_user_id: 'system',
        by_user_name: 'System',
        from_status: 'active',
        to_status: 'active',
        notes: `Initial notifications sent to ${successCount}/${recipients.length} recipients`
      }]
    });

    return Response.json({
      success: true,
      panicId: panic.id,
      panicNumber: panicNumber,
      recipientCount: recipients.length,
      notificationsSent: successCount
    });

  } catch (error) {
    console.error('Panic activation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});