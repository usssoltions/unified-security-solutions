/**
 * Shared recipient-side notification PREFERENCE filter.
 *
 * POLICY (2026-09-22 final cleanup): permission to VIEW a record is NOT the
 * same as being an automatic notification recipient. A customer_admin (or any
 * role) who explicitly disabled an event type in their Notification
 * Preferences is dropped from the AUTOMATIC recipient list for that ROUTINE
 * event type. CRITICAL/security events are never suppressed here (panic,
 * blacklist and critical-incident channels have their own rules).
 *
 * Preference shape (NotificationPreference entity, per user):
 *   incident_assigned / maintenance_assigned / incident_critical /
 *   status_change / alarm_dispatch / shift_reminder / training_assigned
 *   each as { enabled: boolean, email?: boolean, push?: boolean }.
 *
 * Recipients with NO preference record are always kept (fail-open is correct
 * here: preferences are an opt-OUT system, not an entitlement system).
 */
export async function applyNotificationPreferences(
  svc: any,
  recipients: any[],
  opts: { pref_field?: string | null; critical?: boolean } = {},
): Promise<any[]> {
  const list: any[] = Array.isArray(recipients) ? recipients.filter(Boolean) : [];
  const field = opts.pref_field || null;
  if (!field || !list.length || opts.critical) return list;

  let prefs: any[] = [];
  try {
    prefs = (await svc.entities.NotificationPreference.filter({}).catch(() => [])) || [];
  } catch (_) { return list; }
  const byUser = new Map<string, any>();
  for (const pref of prefs) {
    if (pref && pref.user_id) byUser.set(String(pref.user_id), pref);
  }
  return list.filter((u: any) => {
    const pref = byUser.get(String(u.id));
    if (!pref) return true;
    const setting = pref[field];
    if (setting && setting.enabled === false) return false;
    return true;
  });
}