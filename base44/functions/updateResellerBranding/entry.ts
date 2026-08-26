import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * updateResellerBranding — server-side, allowlisted white-label branding
 * update for a reseller.
 *
 * Why this exists:
 *  The Reseller entity UPDATE RLS is restricted to the built-in role "admin"
 *  (USS Platform Admin) so that reseller admins cannot mutate security-
 *  sensitive fields (members, status, ownership, licensing). Base44 RLS has no
 *  field-level restrictions, so broadening UPDATE to reseller membership would
 *  expose every field. Instead, branding edits flow through this function,
 *  which:
 *   1. Authenticates the caller.
 *   2. Resolves the target Reseller with the service role (to inspect its
 *      `members` array) — the client-supplied reseller_id identifies the
 *      target but is NEVER trusted as proof of authorisation.
 *   3. Authorises ONLY if the caller is a Platform Admin (role "admin" /
 *      admin_level "platform" / role_type "platform_admin") OR the caller's
 *      verified user id is present in the target Reseller's `members` array
 *      (the SAME verified membership mechanism used by the working Reseller
 *      READ RLS).
 *   4. Accepts an explicit allowlist of branding/support fields only. Every
 *      other submitted field (members, status, name, reseller_id, licensing,
 *      role/permission fields, tenant identifiers, …) is silently rejected.
 *   5. Updates only that one reseller, via the service role.
 *   6. Records the change in PlatformAuditLog.
 *
 * This does NOT change Reseller RLS. Reseller admins still have no direct
 * client-side Reseller.update permission. Cross-reseller updates are denied
 * by the membership check.
 */

const ALLOWED_FIELDS = [
  'app_name',
  'logo_url',
  'primary_color',
  'accent_color',
  'support_name',
  'support_email',
  'support_phone',
  'website',
] as const;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function isPlatformAdmin(caller: any): boolean {
  return (
    caller?.role === 'admin' ||
    caller?.admin_level === 'platform' ||
    caller?.role_type === 'platform_admin'
  );
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller: any = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json().catch(() => ({} as any));
    const resellerId: string | undefined = body?.reseller_id;
    if (!resellerId || typeof resellerId !== 'string') {
      return Response.json({ error: 'reseller_id is required' }, { status: 400 });
    }

    // Resolve the target reseller with the service role to inspect membership.
    // The client-supplied id only names the target; it is not trusted for auth.
    const reseller: any = await base44.asServiceRole.entities.Reseller
      .get(resellerId)
      .catch(() => null);
    if (!reseller) return Response.json({ error: 'Reseller not found' }, { status: 404 });

    // Authorisation: Platform Admin OR verified member of this reseller.
    const admin = isPlatformAdmin(caller);
    const member = Array.isArray(reseller.members) && reseller.members.includes(caller.id);
    if (!admin && !member) {
      return Response.json({ error: 'Not authorized to update this reseller' }, { status: 403 });
    }

    // Build an allowlisted update payload. Only the explicit branding fields
    // are considered; everything else is rejected/ignored.
    const submitted: any = body?.fields || {};
    const update: any = {};
    for (const k of ALLOWED_FIELDS) {
      if (k in submitted) {
        const v = submitted[k];
        if (v === null || v === undefined) {
          update[k] = '';
        } else if (typeof v === 'string') {
          update[k] = v;
        }
        // Non-string, non-null values are ignored (rejected).
      }
    }

    // Validate hex colours when present.
    if ('primary_color' in update && update.primary_color && !HEX_RE.test(update.primary_color)) {
      return Response.json({ error: 'Invalid primary_color (must be #rrggbb)' }, { status: 400 });
    }
    if ('accent_color' in update && update.accent_color && !HEX_RE.test(update.accent_color)) {
      return Response.json({ error: 'Invalid accent_color (must be #rrggbb)' }, { status: 400 });
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ success: true, reseller, unchanged: true });
    }

    // Capture the previous branding values for the audit trail.
    const oldValues: any = {};
    for (const k of ALLOWED_FIELDS) oldValues[k] = reseller[k] ?? null;

    const updated: any = await base44.asServiceRole.entities.Reseller.update(resellerId, update);

    // Audit log. Created as the caller (data.user_id == caller.id), which the
    // PlatformAuditLog create RLS permits.
    try {
      await base44.entities.PlatformAuditLog.create({
        event_type: 'reseller.branding.updated',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        reseller_id: resellerId,
        entity_name: 'Reseller',
        entity_id: resellerId,
        action: 'update_branding',
        old_values: JSON.stringify(oldValues),
        new_values: JSON.stringify(update),
        notes: `Reseller branding updated by ${admin ? 'platform admin' : 'reseller admin'}`,
      });
    } catch (_) {
      /* best-effort audit capture */
    }

    return Response.json({ success: true, reseller: updated });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}