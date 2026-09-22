import { narrowControlRoomOperators } from './controlRoomRecipients.ts';

/**
 * Shared recipient resolution for SHIFT PROOF-OF-DUTY reports (Start of
 * Shift and End of Shift / Shift Handover). Both reports use the SAME
 * modern role resolution (customer_admin / control_room_operator join the
 * legacy management roles), the SAME tenant scoping (the report's own
 * customer; platform oversight always permitted), suspended/inactive
 * exclusion, and the SAME CONTROL ROOM narrowing (an operator receives a
 * report only when assigned to an ACTIVE Control Room covering the
 * shift's site — role membership alone is never sufficient).
 */
export const SHIFT_REPORT_ROLES = [
  'admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator',
];

export const isPlatformUser = (u: any) =>
  u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';

export async function resolveShiftReportRecipients(
  svc: any,
  allUsers: any[],
  opts: { customer_id?: string | null; site_id?: string | null; exclude_id?: string | null } = {},
): Promise<any[]> {
  const list: any[] = Array.isArray(allUsers) ? allUsers : [];
  const customerId = opts.customer_id || null;
  const role = list.filter((u) =>
    SHIFT_REPORT_ROLES.includes(u.role_type) &&
    (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
    (!opts.exclude_id || u.id !== opts.exclude_id) &&
    (isPlatformUser(u) || (!!customerId && u.customer_id === customerId)));
  return await narrowControlRoomOperators(svc, role, {
    customer_id: customerId, site_id: opts.site_id || null });
}