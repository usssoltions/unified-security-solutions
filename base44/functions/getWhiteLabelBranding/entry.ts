import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getWhiteLabelBranding — resolves the white-label branding for the CALLING
 * user's tenant context and returns ONLY the public branding fields.
 *
 * Branding lives on the Reseller entity (app_name, logo_url, primary_color,
 * accent_color, support_*). Customers inherit their parent reseller's
 * branding automatically — there is no per-customer branding setup.
 *
 * Security:
 *  - The caller's reseller is resolved SERVER-SIDE from the caller's own
 *    reseller_id, or (for customer users) from their customer's reseller_id.
 *    The client cannot supply an arbitrary reseller_id — a client-supplied
 *    reseller_id is never trusted for access.
 *  - Only non-sensitive branding fields are returned. The `members` array and
 *    any private reseller fields are never exposed.
 *  - Platform admins (no reseller/customer context) receive null → the app
 *    shows the USS platform default theme.
 *  - Reseller RLS (membership) is NOT weakened; this function reads the
 *    Reseller with the service role only to extract public branding for a
 *    tenant the caller already legitimately belongs to.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ branding: null });

    // Resolve the caller's reseller, server-side. Never trust a client value.
    let resellerId: string | null = caller.reseller_id || null;
    if (!resellerId && caller.customer_id) {
      const customer: any = await base44.asServiceRole.entities.Customer
        .get(caller.customer_id)
        .catch(() => null);
      resellerId = customer?.reseller_id || null;
    }
    if (!resellerId) return Response.json({ branding: null });

    const reseller: any = await base44.asServiceRole.entities.Reseller
      .get(resellerId)
      .catch(() => null);
    if (!reseller) return Response.json({ branding: null });

    return Response.json({
      branding: {
        reseller_id: reseller.id,
        reseller_name: reseller.name || null,
        app_name: reseller.app_name || null,
        logo_url: reseller.logo_url || null,
        primary_color: reseller.primary_color || null,
        accent_color: reseller.accent_color || null,
        support_name: reseller.support_name || null,
        support_email: reseller.support_email || null,
        support_phone: reseller.support_phone || null,
        website: reseller.website || null,
      },
    });
  } catch (error) {
    return Response.json({ branding: null, error: error.message }, { status: 500 });
  }
}