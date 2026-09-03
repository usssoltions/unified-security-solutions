import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getWhiteLabelBranding — resolves the white-label branding for the CALLING
 * user's tenant context and returns ONLY the public branding fields.
 *
 * BRANDING HIERARCHY (customer-first):
 *   1. Customer-level branding (Customer.app_name / logo_url / primary_color /
 *      accent_color / email / website) — wins when configured.
 *   2. Reseller-level branding (Reseller.app_name / logo_url / colors /
 *      support_* / website) — inherited by all customers of the reseller.
 *   3. Platform defaults (returned null → caller applies USS defaults).
 *
 * Security:
 *  - The caller's customer/reseller is resolved SERVER-SIDE from the caller's
 *    own customer_id / reseller_id. A client cannot request another tenant's
 *    branding — a client-supplied id is never trusted for access.
 *  - Only non-sensitive branding fields are returned.
 *  - Platform admins (no reseller/customer context) receive null → the app
 *    shows the USS platform default theme.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ branding: null });

    // Resolve the caller's customer (customer users) — server-side only.
    const customerId: string | null = caller.customer_id || null;
    let customer: any = null;
    if (customerId) {
      customer = await base44.asServiceRole.entities.Customer
        .get(customerId)
        .catch(() => null);
    }

    // Resolve the caller's reseller — own reseller_id, or via the customer.
    let resellerId: string | null = caller.reseller_id || null;
    if (!resellerId && customer?.reseller_id) resellerId = customer.reseller_id;
    if (!resellerId && caller.customer_id && !customer) {
      // customer fetch failed above but caller claims a customer — do not trust.
      return Response.json({ branding: null });
    }

    const reseller: any = resellerId
      ? await base44.asServiceRole.entities.Reseller.get(resellerId).catch(() => null)
      : null;

    const b: any = {
      reseller_id: reseller?.id || null,
      reseller_name: reseller?.name || null,
      app_name: reseller?.app_name || null,
      logo_url: reseller?.logo_url || null,
      primary_color: reseller?.primary_color || null,
      accent_color: reseller?.accent_color || null,
      support_name: reseller?.support_name || null,
      support_email: reseller?.support_email || null,
      support_phone: reseller?.support_phone || null,
      website: reseller?.website || null,
    };

    // Customer-level overrides win over reseller branding, per field.
    if (customer) {
      b.customer_id = customer.id;
      b.customer_name = customer.name || null;
      b.app_name = customer.app_name || b.app_name;
      b.logo_url = customer.logo_url || b.logo_url;
      b.primary_color = customer.primary_color || b.primary_color;
      b.accent_color = customer.accent_color || b.accent_color;
      b.support_email = customer.email || b.support_email;
      b.website = customer.website || b.website;
    }

    return Response.json({ branding: b });
  } catch (error) {
    return Response.json({ branding: null, error: error.message }, { status: 500 });
  }
}