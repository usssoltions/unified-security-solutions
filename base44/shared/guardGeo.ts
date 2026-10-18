/**
 * guardGeo — shared helpers for guard-operation gateways (shiftAccess,
 * checkpointSubmission): error shorthand, GPS validation, geodesic distance
 * and the per-customer geofence-enforcement read.
 */

/** JSON error response shorthand. */
export function fail(error: string, code: string, status: number = 400): Response {
  return Response.json({ error, code }, { status });
}

/** Valid, non-zero GPS coordinate object. */
export function validCoords(loc: any): boolean {
  return !!loc
    && typeof loc.lat === 'number' && isFinite(loc.lat)
    && typeof loc.lng === 'number' && isFinite(loc.lng)
    && !(loc.lat === 0 && loc.lng === 0);
}

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Geofence enforcement for the CALLER'S OWN customer (per-customer setting,
 *  default ON — existing customers without a saved value, and any read
 *  failure, keep enforcement). Never a global value. */
export async function geofenceEnforced(svc: any, customerId: string | null | undefined): Promise<boolean> {
  if (!customerId) return true;
  try {
    const c = await svc.entities.Customer.get(customerId);
    return c ? c.geofence_enforcement_enabled !== false : true;
  } catch (_) {
    return true;
  }
}