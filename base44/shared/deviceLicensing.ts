/**
 * Shared customer device-licensing helpers — the ONE implementation used by
 * the deviceAccess and customerAccess gateways (device limit parsing/
 * validation, admin level classification, active-device counting, customer
 * loading and the canonical user-facing licensing messages).
 */

/** Platform-level authority (built-in admin role OR explicit platform level). */
export const isPlatformAdmin = (u: any): boolean =>
  u?.role_type === 'platform_admin' || u?.admin_level === 'platform' || u?.role === 'admin';

/** Reseller administrator (own reseller scope only). */
export const isResellerAdmin = (u: any): boolean =>
  u?.role_type === 'reseller_admin' || u?.admin_level === 'reseller';

/** Canonical DEVICE LIMIT REACHED screen text (task §9). */
export const DEVICE_LIMIT_REACHED_MESSAGE =
  'This customer has reached the maximum number of registered devices allowed for the account. Please contact your administrator to remove an old device or increase the licensed device limit.';

/** Canonical deactivated-device screen text. */
export const DEVICE_INACTIVE_MESSAGE =
  'This device has been deactivated for this customer. Please contact your administrator.';

/** Valid device limit: a true integer >= 1 (no decimals, no strings, no blanks). */
export function parseDeviceLimit(raw: any): { ok: true; value: number } | { ok: false; code: string; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false, code: 'missing_device_limit',
      error: 'Allowed Devices is required. Enter the number of licensed device installations for this customer (minimum 1).',
    };
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, code: 'invalid_device_limit', error: 'Allowed Devices must be a whole number (no decimals or text).' };
  }
  if (num < 1) {
    return { ok: false, code: 'invalid_device_limit', error: 'Allowed Devices must be at least 1.' };
  }
  return { ok: true, value: num };
}

/** Count the customer's ACTIVE registered devices (licence slot usage). */
export async function countActiveDevices(svc: any, customerId: string): Promise<number> {
  const rows = await svc.entities.DeviceRegistration
    .filter({ customer_id: String(customerId), status: 'active' }).catch(() => []);
  return (rows || []).length;
}

/** Load a Customer record by id through the service role (null when absent). */
export async function loadCustomerById(svc: any, id: string): Promise<any> {
  const rows = await svc.entities.Customer.filter({ id: String(id) }).catch(() => []);
  return rows?.[0] || null;
}