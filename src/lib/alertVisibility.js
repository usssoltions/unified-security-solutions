/**
 * Alert visibility rule shared by every in-app alert surface.
 *
 * Alerts marked metadata.management_only = true are MANAGEMENT correspondence
 * (e.g. incident escalation alerts) — operational guard-tier users never see
 * them in-app; they still reach every management role, whose emergency
 * notifications are never suppressed.
 */
const MANAGEMENT_ALERT_ROLES = [
  "admin", "dispatcher", "management", "customer_admin",
  "control_room_operator", "platform_admin", "estate_manager",
];

export function isAlertVisibleToUser(alert, user) {
  if (!alert) return false;
  if (alert?.metadata?.management_only === true) {
    return MANAGEMENT_ALERT_ROLES.includes(String(user?.role_type || ""));
  }
  return true;
}