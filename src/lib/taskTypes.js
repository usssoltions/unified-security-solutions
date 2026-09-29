/**
 * Task type catalogue — GENERIC BASE + module-conditional additions.
 *
 * Task Management must be commercially usable outside pure security
 * customers: the BASE catalogue is deliberately generic. Security-specific
 * types are added ONLY when the related module is licensed for the tenant
 * (PATROL / OPERATIONS / COMPLETE_SECURITY / ACCESS). Role never grants a
 * type — only ROLE + ENTITLEMENT does.
 *
 * Historical task records keep their stored keys readable: unknown/legacy
 * keys fall back to a prettified key (never broken, never migrated).
 */
import { isModuleEnabled } from "@/hooks/useModuleEntitlements";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

/** Generic base — available to EVERY Task Scheduling customer. */
export const BASE_TASK_TYPES = [
  ["other", "General Task / Other"],
  ["inspection", "Inspection"],
  ["checklist", "Checklist"],
  ["follow_up", "Follow-up"],
  ["contact_call", "Contact / Call"],
  ["contact_customer", "Contact Customer"],
  ["administration", "Administration"],
  ["maintenance", "Maintenance"],
];

/** Module-specific additions — only when the module is licensed. */
export const MODULE_TASK_TYPES = {
  PATROL: [["verify_patrol", "Verify Patrol"]],
  SECURITY_OPS: [
    ["check_guard", "Check Guard"],
    ["follow_up_incident", "Follow Up Incident"],
    ["review_alarm", "Review Alarm"],
    ["confirm_shift", "Confirm Shift"],
  ],
  ACCESS: [["contact_site", "Contact Site"]],
};

/**
 * Effective task-type options for the tenant: generic base + licensed
 * module additions. Order: base first, module additions after.
 */
export function getTaskTypes(entitlements = [], platformAdmin = false) {
  const out = BASE_TASK_TYPES.map(([v, l]) => [v, l]);
  const add = (pairs) => pairs.forEach(([v, l]) => {
    if (!out.some((x) => x[0] === v)) out.push([v, l]);
  });
  if (isModuleEnabled(entitlements, "PATROL", platformAdmin)) add(MODULE_TASK_TYPES.PATROL);
  if (
    isModuleEnabled(entitlements, "OPERATIONS", platformAdmin)
    || isModuleEnabled(entitlements, "COMPLETE_SECURITY", platformAdmin)
  ) add(MODULE_TASK_TYPES.SECURITY_OPS);
  if (isModuleEnabled(entitlements, "ACCESS", platformAdmin)) add(MODULE_TASK_TYPES.ACCESS);
  return out;
}

/** Readable label for a stored task_type key — historical labels stay readable. */
export function taskTypeLabel(key, entitlements = [], platformAdmin = false) {
  if (!key) return "—";
  const found = getTaskTypes(entitlements, platformAdmin).find(([v]) => v === key);
  return found ? found[1] : String(key).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Convenience hook data bundle for task forms. */
export function taskTypeContext(user, entitlements = []) {
  return getTaskTypes(entitlements, isPlatformAdminUser(user));
}