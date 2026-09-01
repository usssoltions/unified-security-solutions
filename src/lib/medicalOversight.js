/**
 * Medical oversight accessor.
 *
 * The built-in Base44 `role === "admin"` user (the app owner) plus explicit
 * platform admins (role_type "platform_admin" / admin_level "platform") have
 * cross-tenant oversight over Medical records. Tenant users (practice admin,
 * therapist, reception) are scoped to their own customer_id.
 *
 * Use `hasMedicalOversight(user)` to decide whether a medical page should
 * fetch ALL records (oversight) or only the user's customer_id-scoped records.
 * The matching RLS rule on every medical entity grants read/create/update to
 * `{ "user_condition": { "role": "admin" } }` OR `{ "admin_level": "platform" }`.
 */
import { isPlatformAdminUser } from "@/lib/platformAdmin";

export function hasMedicalOversight(user) {
  if (!user) return false;
  if (user.role === "admin") return true; // built-in Base44 app owner
  return isPlatformAdminUser(user);
}

/**
 * Build the customer_id query for a medical list query.
 * Oversight users get {} (all records); tenant users get { customer_id }.
 */
export function medicalScopeFilter(user) {
  if (!user) return {};
  if (hasMedicalOversight(user)) return {};
  return { customer_id: user.customer_id };
}