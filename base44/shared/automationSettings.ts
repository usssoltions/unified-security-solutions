/**
 * automationSettings — SHARED per-tenant automation/report switch resolution.
 *
 * Every scheduled or event-triggered monitor and report sender resolves its
 * toggle from the OWNING tenant's AutomationSetting record (one row per
 * customer; customer_id null = the platform-managed legacy pool). A tenant
 * with no record inherits ONLY the schema defaults — never another
 * customer's switches.
 *
 * Default semantics:
 *  - Monitors (monitor_*, generate_scheduled_patrols, send_shift_reminders):
 *    DEFAULT OFF — an automation only runs for a tenant that explicitly
 *    enabled it.
 *  - Reports (report_daily_activity / shift_reports / weekly_analysis /
 *    monthly_comparison / incident_alerts / maintenance_alerts): default ON,
 *    preserving the historical behaviour of those senders.
 *  - report_guard_performance: default OFF — the board report only sends
 *    when explicitly enabled.
 */

export const AUTOMATION_DEFAULTS: Record<string, boolean> = {
  monitor_overdue_patrols: false,
  monitor_missed_clockins: false,
  monitor_low_battery: false,
  generate_scheduled_patrols: false,
  send_shift_reminders: false,
  report_daily_activity: true,
  report_shift_reports: true,
  report_weekly_analysis: true,
  report_monthly_comparison: true,
  report_incident_alerts: true,
  report_maintenance_alerts: true,
  report_guard_performance: false,
};

/** Keys a tenant administrator may toggle through the automationAccess gateway. */
export const AUTOMATION_TOGGLE_KEYS = Object.keys(AUTOMATION_DEFAULTS);

/**
 * Load ALL settings rows once and bucket them per tenant. Use in scheduled
 * sweeps that process many tenants in one run (runAllMonitors).
 */
export async function loadAutomationSettingsMap(svc: any): Promise<{
  byCustomer: Map<string, any>;
  platformRec: any | null;
  recs: any[];
}> {
  const recs = (await svc.entities.AutomationSetting.list().catch(() => [])) || [];
  const byCustomer = new Map<string, any>();
  let platformRec: any = null;
  for (const r of recs) {
    if (r.customer_id) {
      const key = String(r.customer_id);
      if (!byCustomer.has(key)) byCustomer.set(key, r);
    } else if (!platformRec) {
      platformRec = r;
    }
  }
  return { byCustomer, platformRec, recs };
}

/**
 * Effective settings for one tenant (defaults applied). customerId null =
 * the platform-managed legacy pool.
 */
export function settingsForTenant(map: { byCustomer: Map<string, any>; platformRec: any | null }, customerId: string | null): Record<string, any> {
  const rec = customerId ? map.byCustomer.get(String(customerId)) : map.platformRec;
  return { ...AUTOMATION_DEFAULTS, ...(rec || {}), customer_id: customerId ?? null };
}

/**
 * Single-tenant lookup for on-demand senders/monitors (one small list call).
 * Returns the stored record (or null) plus the effective settings.
 */
export async function tenantAutomationSettings(
  svc: any,
  customerId: string | null | undefined,
): Promise<{ rec: any | null; settings: Record<string, any> }> {
  const q: any = customerId ? { customer_id: String(customerId) } : { customer_id: null };
  const recs = (await svc.entities.AutomationSetting.filter(q).catch(() => [])) || [];
  const rec = recs[0] || null;
  return { rec, settings: { ...AUTOMATION_DEFAULTS, ...(rec || {}) } };
}