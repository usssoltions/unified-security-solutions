import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { isPlatformAdmin, isResellerAdmin, loadCustomerById } from '../../shared/deviceLicensing.ts';

/**
 * reportRecipientAccess — AUTHORITATIVE report-recipient management gateway.
 *
 * The ONE tenant-scoped report-recipient system (ExternalRecipient entity):
 * external client representatives WITHOUT any application login receive the
 * scheduled reports (Daily Access Control Report etc.) at their configured
 * addresses; authorised INTERNAL users may also be linked via user_id. No
 * fake system users are ever created to receive reports.
 *
 * TENANT SCOPE (fail-closed, never trusting a client-supplied customer_id):
 *  • Platform admin        → any customer
 *  • Reseller admin        → customers of their OWN reseller only
 *  • Customer-level admin  → their OWN customer only (forced server-side)
 * A customer administrator can NEVER view, add, edit or remove another
 * tenant's recipients or schedule.
 *
 * NORMALIZATION: every email is trimmed + lowercased; the same address can
 * never be configured twice within a customer (409 duplicate_recipient), and
 * the report generator deduplicates by normalized email at send time so an
 * internal-user recipient and an external record for the same address
 * receive exactly ONE copy.
 *
 * Actions: list | save | set_active | delete
 * AUDIT: report_recipient.created / .updated / .deactivated / .activated / .deleted
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e: any) => String(e || '').trim().toLowerCase();

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized', code: 'auth_required' }, { status: 401 });
    const callerName = caller.display_name || caller.full_name || caller.email;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    // ── Tenant scope resolution (server-side, fail closed) ──────────────
    let level: 'platform' | 'reseller' | 'customer' | null = null;
    if (isPlatformAdmin(caller)) level = 'platform';
    else if (isResellerAdmin(caller)) level = 'reseller';
    else if (caller.customer_id && ['customer_admin', 'admin'].includes(String(caller.role_type || ''))) level = 'customer';
    if (!level) {
      return Response.json({ error: 'You do not have permission to manage report recipients.', code: 'permission_denied' }, { status: 403 });
    }

    let customerId: string | null = null;
    if (level === 'customer') {
      // OWN customer only — a client-supplied customer_id can only ever fail
      // loudly, never grant access.
      if (body?.customer_id && String(body.customer_id) !== String(caller.customer_id)) {
        return Response.json({ error: 'You can only manage report recipients for your own organisation.', code: 'permission_denied' }, { status: 403 });
      }
      customerId = String(caller.customer_id);
    } else {
      customerId = String(body?.customer_id || '') || null;
      if (!customerId) return Response.json({ error: 'customer_id is required', code: 'missing_customer' }, { status: 400 });
    }
    const cust = await loadCustomerById(svc, customerId);
    if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
    if (level === 'reseller' && (!cust.reseller_id || String(cust.reseller_id) !== String(caller.reseller_id))) {
      return Response.json({ error: 'You do not have permission to manage report recipients for this customer.', code: 'permission_denied' }, { status: 403 });
    }

    /* ── LIST ─────────────────────────────────────────────────────────── */
    if (action === 'list') {
      const [recipients, sites, users] = await Promise.all([
        svc.entities.ExternalRecipient.filter({ customer_id: customerId }).catch(() => []),
        svc.entities.Site.filter({ customer_id: customerId }).catch(() => []),
        svc.entities.User.filter({ customer_id: customerId }).catch(() => []),
      ]);
      return Response.json({
        success: true,
        customer: { id: cust.id, name: cust.name },
        recipients: (recipients || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          company: r.company || null,
          title: r.title || null,
          recipient_type: r.recipient_type || 'other',
          site_id: r.site_id || null,
          user_id: r.user_id || null,
          active: r.active !== false,
          daily_access_enabled: Array.isArray(r.report_preferences)
            ? !r.report_preferences.includes('daily_access_opt_out')
            : true, // no explicit opt-out marker = enabled (legacy default)
        })),
        sites: (sites || []).map((s: any) => ({ id: s.id, name: s.name })),
        internal_users: (users || [])
          .filter((u: any) => u.user_status == null || u.user_status === 'active')
          .map((u: any) => ({ id: u.id, name: u.display_name || u.full_name || u.email, email: u.email, role_type: u.role_type })),
        can_change_limits: isPlatformAdmin(caller),
      });
    }

    /* ── SAVE (create or update) ──────────────────────────────────────── */
    if (action === 'save') {
      const id = String(body?.id || '') || null;
      const name = String(body?.name || '').trim();
      const email = normEmail(body?.email);
      if (!name) return Response.json({ error: 'Recipient Name is required', code: 'missing_name' }, { status: 400 });
      if (!email || !EMAIL_RE.test(email)) {
        return Response.json({ error: 'A valid email address is required', code: 'invalid_email' }, { status: 400 });
      }
      const dailyAccess = body?.daily_access_enabled !== false;
      const active = body?.active !== false;
      const siteId = String(body?.site_id || '') || null;
      const userId = String(body?.user_id || '') || null;

      // Site scoping validation — the site must belong to THIS customer.
      if (siteId) {
        const rows = await svc.entities.Site.filter({ id: siteId }).catch(() => []);
        const site = (rows || [])[0];
        if (!site || String(site.customer_id) !== String(customerId)) {
          return Response.json({ error: 'The selected site does not belong to this customer', code: 'bad_site' }, { status: 400 });
        }
      }
      // Internal-user link validation — the user must belong to THIS customer.
      if (userId) {
        const rows = await svc.entities.User.filter({ id: userId }).catch(() => []);
        const u = (rows || [])[0];
        if (!u || String(u.customer_id) !== String(customerId)) {
          return Response.json({ error: 'The selected user does not belong to this customer', code: 'bad_user' }, { status: 400 });
        }
      }

      // Duplicate guard within the customer (normalized email).
      const all = await svc.entities.ExternalRecipient.filter({ customer_id: customerId }).catch(() => []);
      const dup = (all || []).find((r: any) => normEmail(r.email) === email && r.id !== id);
      if (dup) {
        return Response.json({
          error: `This email address is already configured as a report recipient${siteId ? '' : ' for this customer'}.`,
          code: 'duplicate_recipient', duplicate_id: dup.id,
        }, { status: 409 });
      }

      // Preserve other report preferences; 'daily_access' is managed by this UI.
      const existing = id ? ((all || []).find((r: any) => r.id === id) || null) : null;
      if (id && !existing) return Response.json({ error: 'Recipient not found', code: 'recipient_not_found' }, { status: 404 });
      const prevPrefs: string[] = Array.isArray(existing?.report_preferences) ? existing.report_preferences : [];
      const prefs = Array.from(new Set([
        ...prevPrefs.filter((k: string) => k !== 'daily_access'),
        ...(dailyAccess ? ['daily_access'] : []),
      ]));

      const fields: any = {
        customer_id: customerId,
        reseller_id: cust.reseller_id || undefined,
        name,
        email,
        company: String(body?.company || '').trim() || undefined,
        title: String(body?.title || '').trim() || undefined,
        recipient_type: String(body?.recipient_type || 'other'),
        site_id: siteId || null,
        user_id: userId || null,
        active,
        reports_enabled: true,
        report_preferences: prefs,
      };

      let saved;
      if (existing) {
        saved = await svc.entities.ExternalRecipient.update(existing.id, fields);
        await svc.entities.PlatformAuditLog.create({
          event_type: 'report_recipient.updated',
          customer_id: customerId, reseller_id: cust.reseller_id || undefined,
          user_id: caller.id, user_name: callerName,
          entity_name: 'ExternalRecipient', entity_id: existing.id, action: 'report_recipient_update',
          old_values: JSON.stringify({ name: existing.name, email: existing.email, site_id: existing.site_id || null, active: existing.active !== false }),
          new_values: JSON.stringify({ name, email, site_id: siteId, daily_access_enabled: dailyAccess, active }),
          notes: `Report recipient updated (${email})`,
        }).catch(() => {});
      } else {
        saved = await svc.entities.ExternalRecipient.create(fields);
        await svc.entities.PlatformAuditLog.create({
          event_type: 'report_recipient.created',
          customer_id: customerId, reseller_id: cust.reseller_id || undefined,
          user_id: caller.id, user_name: callerName,
          entity_name: 'ExternalRecipient', entity_id: saved.id, action: 'report_recipient_create',
          new_values: JSON.stringify({ name, email, site_id: siteId, daily_access_enabled: dailyAccess }),
          notes: `Report recipient added (${email})`,
        }).catch(() => {});
      }
      return Response.json({ success: true, recipient: saved });
    }

    /* ── SET ACTIVE (deactivate / reactivate) ─────────────────────────── */
    if (action === 'set_active') {
      const id = String(body?.id || '') || null;
      if (!id) return Response.json({ error: 'id is required', code: 'missing_id' }, { status: 400 });
      const rows = await svc.entities.ExternalRecipient.filter({ id }).catch(() => []);
      const r = (rows || [])[0];
      if (!r || String(r.customer_id) !== String(customerId)) {
        return Response.json({ error: 'Recipient not found', code: 'recipient_not_found' }, { status: 404 });
      }
      const active = body?.active !== false;
      const updated = await svc.entities.ExternalRecipient.update(id, { active });
      await svc.entities.PlatformAuditLog.create({
        event_type: active ? 'report_recipient.activated' : 'report_recipient.deactivated',
        customer_id: customerId, reseller_id: cust.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'ExternalRecipient', entity_id: id, action: 'report_recipient_set_active',
        new_values: JSON.stringify({ active }),
        notes: `Report recipient ${active ? 'reactivated' : 'deactivated'} (${normEmail(r.email)})`,
      }).catch(() => {});
      return Response.json({ success: true, recipient: updated });
    }

    /* ── DELETE ───────────────────────────────────────────────────────── */
    if (action === 'delete') {
      const id = String(body?.id || '') || null;
      if (!id) return Response.json({ error: 'id is required', code: 'missing_id' }, { status: 400 });
      const rows = await svc.entities.ExternalRecipient.filter({ id }).catch(() => []);
      const r = (rows || [])[0];
      if (!r || String(r.customer_id) !== String(customerId)) {
        return Response.json({ error: 'Recipient not found', code: 'recipient_not_found' }, { status: 404 });
      }
      await svc.entities.ExternalRecipient.delete(id);
      await svc.entities.PlatformAuditLog.create({
        event_type: 'report_recipient.deleted',
        customer_id: customerId, reseller_id: cust.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'ExternalRecipient', entity_id: id, action: 'report_recipient_delete',
        old_values: JSON.stringify({ name: r.name, email: normEmail(r.email) }),
        notes: `Report recipient removed (${normEmail(r.email)})`,
      }).catch(() => {});
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action. Use list, save, set_active or delete', code: 'bad_action' }, { status: 400 });
  } catch (error) {
    const msg = String((error as any)?.message || error);
    console.log('[reportRecipientAccess] fatal', msg);
    return Response.json({ error: 'Report recipient operation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}