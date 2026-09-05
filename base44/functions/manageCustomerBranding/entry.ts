import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * manageCustomerBranding — server-side, allowlisted customer-level white-label
 * branding update. Mirrors the proven updateResellerBranding pattern.
 *
 * BRANDING HIERARCHY (resolved per field by getWhiteLabelBranding):
 *   Customer override → Reseller branding → Platform default.
 * The Customer record stores ONLY overrides — inherited values are never
 * copied into the customer record.
 *
 * Authorization (fail closed):
 *   - Platform Admin (role "admin" / admin_level "platform" /
 *     role_type "platform_admin"), OR
 *   - a verified member of the customer's reseller (Reseller.members — the
 *     same verified-membership mechanism as the Reseller READ RLS).
 * Customer admins / staff do NOT get branding edit rights — they inherit.
 *
 * Allowlist: app_name, logo_url, primary_color, accent_color, email, phone,
 * website, address + PWA install fields (pwa_app_name, pwa_short_name,
 * pwa_background_color, pwa_icon_192_url, pwa_icon_512_url; pwa_slug is
 * validated separately — unique + immutable once assigned). Every other
 * submitted field (status, ownership, tenant
 * ids, reseller_id, licensing, …) is silently rejected. The client-supplied
 * customer_id only names the target — it is never trusted as authorization.
 */

const ALLOWED_FIELDS = [
  'app_name',
  'logo_url',
  'logo_background',
  'primary_color',
  'accent_color',
  'email',
  'phone',
  'website',
  'address',
  'pwa_app_name',
  'pwa_short_name',
  'pwa_background_color',
  'pwa_icon_192_url',
  'pwa_icon_512_url',
] as const;

// Public PWA install slug: lowercase, URL-safe. Uniqueness and immutability
// are validated server-side below (pwa_slug is NOT in ALLOWED_FIELDS).
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

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
    const customerId: string | undefined = body?.customer_id;
    if (!customerId || typeof customerId !== 'string') {
      return Response.json({ error: 'customer_id is required' }, { status: 400 });
    }

    // Resolve the target customer with the service role to inspect ownership.
    const customer: any = await base44.asServiceRole.entities.Customer
      .get(customerId)
      .catch(() => null);
    if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });

    // Authorization: Platform Admin OR verified member of the customer's
    // reseller. Direct platform-managed customers (no reseller) are
    // platform-admin-only.
    const admin = isPlatformAdmin(caller);
    let member = false;
    if (customer.reseller_id) {
      const reseller: any = await base44.asServiceRole.entities.Reseller
        .get(customer.reseller_id)
        .catch(() => null);
      member = !!reseller && Array.isArray(reseller.members) && reseller.members.includes(caller.id);
    }
    if (!admin && !member) {
      return Response.json({ error: 'Not authorized to update this customer' }, { status: 403 });
    }

    // Allowlisted update payload only — everything else is rejected/ignored.
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
    // Logo background controls the CONTAINER behind the logo only.
    if ('logo_background' in update && update.logo_background && !['auto', 'white', 'transparent'].includes(update.logo_background)) {
      return Response.json({ error: 'Invalid logo_background' }, { status: 400 });
    }
    if ('pwa_background_color' in update && update.pwa_background_color && !HEX_RE.test(update.pwa_background_color)) {
      return Response.json({ error: 'Invalid PWA background colour (must be #rrggbb)' }, { status: 400 });
    }

    // PWA install slug — public identifier baked into installed PWAs
    // (manifest id/start_url). Immutable once assigned, globally unique,
    // validated here. COSMETIC ONLY: it never grants tenant access.
    if ('pwa_slug' in submitted) {
      const newSlug = String(submitted.pwa_slug || '').toLowerCase().trim();
      const existingSlug = String(customer.pwa_slug || '').toLowerCase().trim();
      if (newSlug) {
        if (!SLUG_RE.test(newSlug)) {
          return Response.json({ error: 'PWA Slug must be lowercase letters, numbers and hyphens (2-31 characters, no spaces)' }, { status: 400 });
        }
        if (existingSlug && newSlug !== existingSlug) {
          return Response.json({ error: 'PWA Slug is immutable once assigned — it is baked into installed apps and cannot be changed.' }, { status: 400 });
        }
        if (newSlug !== existingSlug) {
          const dupes = await base44.asServiceRole.entities.Customer
            .filter({ pwa_slug: newSlug }, 'created_date', 10)
            .catch(() => []);
          if ((dupes || []).some((c: any) => c.id !== customerId)) {
            return Response.json({ error: `PWA Slug "${newSlug}" is already used by another customer` }, { status: 400 });
          }
          update.pwa_slug = newSlug;
        }
      } else if (existingSlug) {
        return Response.json({ error: 'PWA Slug cannot be cleared once assigned — it is baked into installed apps.' }, { status: 400 });
      }
    }

    if (Object.keys(update).length === 0) {
      return Response.json({ success: true, customer, unchanged: true });
    }

    // Capture the previous branding values for the audit trail.
    const oldValues: any = {};
    for (const k of ALLOWED_FIELDS) oldValues[k] = customer[k] ?? null;
    oldValues.pwa_slug = customer.pwa_slug ?? null;

    const updated: any = await base44.asServiceRole.entities.Customer.update(customerId, update);

    // Audit log. Created as the caller (data.user_id == caller.id), which the
    // PlatformAuditLog create RLS permits.
    try {
      await base44.entities.PlatformAuditLog.create({
        event_type: 'customer.branding.updated',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        customer_id: customerId,
        reseller_id: customer.reseller_id || undefined,
        entity_name: 'Customer',
        entity_id: customerId,
        action: 'update_customer_branding',
        old_values: JSON.stringify(oldValues),
        new_values: JSON.stringify(update),
        notes: `Customer branding updated by ${admin ? 'platform admin' : 'reseller admin'}`,
      });
    } catch (_) {
      /* best-effort audit capture */
    }

    return Response.json({ success: true, customer: updated });
  } catch (error: any) {
    return Response.json({ error: error?.message || String(error) }, { status: 500 });
  }
}