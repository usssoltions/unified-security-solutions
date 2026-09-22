/**
 * brandingDeliverySelfTest — administrator EMAIL BRANDING PREVIEW and
 * DELIVERY-GUARD SELF-TEST in one server-side function.
 *
 * PREVIEW MODE (send: false — default): renders the six representative
 * transactional templates (incident alert, missed Stay Awake check,
 * scheduled report, maintenance request, estate notification, medical
 * notification) through the ONE central renderer with the caller-selected
 * tenant's authoritative resolved brand, and returns the HTML + plain-text
 * pair plus validation results (logo accessibility, WCAG AA contrast,
 * support email/phone/website formats, fallback chain). NOTHING is sent.
 *
 * SELF-TEST MODE (send: true): additionally delivers each rendered template
 * through the guarded audited sender to an OBVIOUSLY-FICTITIOUS intended
 * recipient. In test delivery mode every recipient is rewritten server-side
 * to the TEST_MAILBOX allowlist with a '[TEST]' subject prefix; in
 * production mode the synthetic AUDIT- reference fails closed. The guard
 * outcome for every send (intended vs effective recipient, mode, reason) is
 * returned AND persisted as a truthful NotificationDelivery audit row.
 *
 * AUTHORIZATION: platform administrators may preview/test any tenant;
 * tenant administrators (customer_admin / reseller admin) only their own
 * tenant scope; everyone else is rejected. Brand resolution is server-side
 * from authoritative Customer/Reseller records — never browser-supplied.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveCommunicationBrand, PLATFORM_COMMUNICATION_BRAND } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail, currentDeliveryMode, testMailboxAllowlist } from '../../shared/auditedEmail.ts';
import {
  buildTransactionalEmail, brandContrastReport, isValidEmailLogo,
  fmtDateTime, friendlyLabel,
} from '../../shared/transactionalEmail.ts';

const isPlatformAdmin = (u: any) => !!u && (
  u.role === 'admin' || u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
const isTenantAdmin = (u: any) => !!u && (
  u.admin_level === 'customer' || u.admin_level === 'reseller' ||
  ['customer_admin', 'reseller_admin', 'practice_admin', 'estate_manager'].includes(u.role_type || ''));

const emailOk = (v: any) => !!v && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(v));
const phoneOk = (v: any) => !!v && /^[+()0-9\s-]{7,20}$/.test(String(v));
const webOk = (v: any) => !!v && /^https?:\/\/[a-z0-9.-]+/i.test(String(v));

function representativeTemplates(brand: any) {
  const now = new Date().toISOString();
  return [
    {
      key: 'incident_alert', subject: 'Incident Alert — Suspicious Activity at Main Gate',
      severity: 'high', template_name: 'incident_alert',
      content: {
        title: 'Incident Alert — Suspicious Activity',
        intro: 'A new incident has been reported and requires management attention.',
        details: [
          { label: 'Reference', value: 'INC-2041' },
          { label: 'Category', value: 'suspicious_activity' },
          { label: 'Priority', value: 'high' },
          { label: 'Site', value: 'Main Gate' },
          { label: 'Reported By', value: 'J. Mokoena (Guard)' },
          { label: 'Reported', value: fmtDateTime(now) },
        ],
      },
    },
    {
      key: 'missed_stay_awake_check', subject: 'Missed Stay Awake Check — J. Mokoena',
      severity: 'critical', template_name: 'missed_stay_awake_check',
      content: {
        title: 'Missed Stay Awake Check',
        intro: 'A guard did not acknowledge the Stay Awake check before the deadline.',
        details: [
          { label: 'Guard', value: 'J. Mokoena' },
          { label: 'Site', value: 'Main Gate' },
          { label: 'Check Issued', value: fmtDateTime(new Date(Date.now() - 10 * 60000).toISOString()) },
          { label: 'Deadline', value: fmtDateTime(new Date(Date.now() - 4 * 60000).toISOString()) },
          { label: 'Status', value: 'missed_checkin' },
          { label: 'Response', value: 'NO RESPONSE' },
        ],
      },
    },
    {
      key: 'scheduled_report', subject: 'Daily Activity Report — ' + new Date().toLocaleDateString('en-ZA'),
      severity: undefined, template_name: 'scheduled_report',
      content: {
        title: 'Daily Activity Report',
        intro: 'Your scheduled report is ready.',
        details: [
          { label: 'Report', value: 'daily_activity' },
          { label: 'Date', value: new Date().toLocaleDateString('en-ZA') },
          { label: 'Incidents', value: '3' },
          { label: 'Shifts', value: '12' },
          { label: 'Completed Shifts', value: '9' },
          { label: 'Active Shifts', value: '2' },
          { label: 'Maintenance Requests', value: '4' },
          { label: 'Patrol Checkpoints', value: '27' },
        ],
        bodyLines: ['Incident: Trespasser at loading bay (High priority)'],
      },
    },
    {
      key: 'maintenance_request', subject: 'Maintenance Request — Plumbing at Block B',
      severity: 'medium', template_name: 'maintenance_request',
      content: {
        title: 'Maintenance Request',
        intro: 'A new maintenance fault report requires review.',
        details: [
          { label: 'Reference', value: 'MNT-118' },
          { label: 'Type', value: 'Plumbing' },
          { label: 'Location', value: 'Block B, Unit 12' },
          { label: 'Reported', value: fmtDateTime(now) },
          { label: 'Status', value: 'reported' },
        ],
      },
    },
    {
      key: 'estate_notification', subject: 'Estate Notice — Water Shutdown on Saturday',
      severity: 'low', template_name: 'estate_notification',
      content: {
        title: 'Estate Notice — Scheduled Water Shutdown',
        intro: 'The estate manager has published an announcement for all residents.',
        details: [
          { label: 'Announcement', value: 'Water shutdown: Saturday 08:00–12:00' },
          { label: 'Published', value: fmtDateTime(now) },
          { label: 'Category', value: 'OTHER' },
        ],
      },
    },
    {
      key: 'medical_notification', subject: 'Medical Notification — Appointment Confirmed',
      severity: 'info', template_name: 'medical_notification',
      content: {
        title: 'Appointment Confirmed',
        intro: 'An occupational therapy appointment has been confirmed.',
        details: [
          { label: 'Service', value: 'Functional Capacity Evaluation' },
          { label: 'Patient', value: 'K. van der Merwe' },
          { label: 'Date', value: new Date(Date.now() + 86400000).toLocaleDateString('en-ZA') },
          { label: 'Time', value: '09:30' },
          { label: 'Status', value: 'confirmed' },
        ],
      },
    },
  ];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPlatformAdmin(user) && !isTenantAdmin(user)) {
      return Response.json({ error: 'Forbidden — administrator access only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const send = body?.send === true;

    // ── TENANT SCOPE — server-side, never browser-supplied ──────────────────
    let customerId: string | null = null;
    let resellerId: string | null = null;
    if (isPlatformAdmin(user)) {
      customerId = body?.customer_id ? String(body.customer_id) : null;
      resellerId = body?.reseller_id ? String(body.reseller_id) : null;
      // Optional lookup by exact customer NAME (platform administrators only)
      if (!customerId && body?.customer_name) {
        try {
          const rows = await svc.entities.Customer.list();
          const match = (rows || []).find((c: any) =>
            String(c.name || '').toLowerCase() === String(body.customer_name).toLowerCase());
          if (match) { customerId = match.id; resellerId = match.reseller_id || null; }
        } catch (_) { /* unknown name → unscoped preview */ }
      }
    } else {
      customerId = user.customer_id || null;
      resellerId = user.reseller_id || null;
      // A tenant administrator may NEVER leave/expand their own scope.
      if (body?.customer_id && String(body.customer_id) !== customerId) {
        return Response.json({ error: 'Forbidden — cross-tenant preview is not permitted' }, { status: 403 });
      }
    }

    // ── AUTHORITATIVE BRAND RESOLUTION (customer → reseller → platform) ────
    const brand = await resolveCommunicationBrand(svc, {
      customer_id: customerId, reseller_id: resellerId });

    // ── VALIDATION ──────────────────────────────────────────────────────────
    const contrast = brandContrastReport(brand);
    const validations = {
      brand_name: brand.brand_name || PLATFORM_COMMUNICATION_BRAND.brand_name,
      branding_source: brand.customer_id ? 'customer' : (brand.reseller_id ? 'reseller' : 'platform'),
      logo_url: brand.logo_url || null,
      logo_valid_for_email: isValidEmailLogo(brand.logo_url),
      logo_missing_renders_text_header: !isValidEmailLogo(brand.logo_url),
      contrast,
      support_email: brand.support_email || null,
      support_email_valid: brand.support_email ? emailOk(brand.support_email) : null,
      support_phone: brand.support_phone || null,
      support_phone_valid: brand.support_phone ? phoneOk(brand.support_phone) : null,
      website: brand.website || null,
      website_valid: brand.website ? webOk(brand.website) : null,
    };

    // ── RENDER the six representative templates (send:false sends NOTHING) ──
    const templates = representativeTemplates(brand).map((t) => {
      const rendered = buildTransactionalEmail({
        brand,
        title: t.content.title,
        severity: t.severity,
        preheader: t.subject,
        intro: t.content.intro,
        details: t.content.details,
        bodyLines: t.content.bodyLines || [],
      });
      return {
        key: t.key,
        subject: t.subject,
        template_name: t.template_name,
        html: rendered.html,
        text: rendered.text,
      };
    });

    // ── SELF-TEST SENDS (guarded; only when send:true) ─────────────────────
    let sends: any[] = [];
    if (send) {
      const mode = currentDeliveryMode();
      for (const t of templates) {
        // OBVIOUSLY FICTITIOUS intended recipient — the guard must rewrite it
        // to the TEST_MAILBOX allowlist in test mode (and fail closed in
        // production mode because of the AUDIT- reference).
        const intended = `selftest-${t.key}@selftest.invalid`;
        const res = await sendAuditedEmail(svc, {
          to: intended,
          subject: t.subject,
          html: t.html, text: t.text,
          brand,
          customer_id: customerId, reseller_id: resellerId,
          event_type: 'branding_self_test',
          reference_id: 'AUDIT-SELFTEST-' + t.key,
          template_name: t.template_name,
          is_test_record: true,
        });
        sends.push({
          template: t.key,
          intended_recipient: intended,
          effective_recipient: res.ok ? (testMailboxAllowlist()[0] || 'BLOCKED') : 'NOT DELIVERED',
          delivery_mode: mode,
          ok: res.ok, skipped: res.skipped, reason: res.error || null,
        });
      }
    }

    return Response.json({
      success: true,
      send,
      delivery_mode: currentDeliveryMode(),
      test_mailbox: send ? testMailboxAllowlist() : undefined,
      customer_id: customerId,
      reseller_id: resellerId,
      validations,
      templates,
      sends,
    });
  } catch (error) {
    console.error('brandingDeliverySelfTest error:', error);
    return Response.json({ error: error?.message || 'Preview failed' }, { status: 500 });
  }
});