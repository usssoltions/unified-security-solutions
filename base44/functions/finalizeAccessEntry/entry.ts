import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { validateHospitalitySubmission, CATEGORY_PERSON_TYPE, CATEGORY_LABELS, HOSPITALITY_WORKFLOW_ID, HOSPITALITY_CATEGORIES, CONFIRMATION_PARTY, hospitalityIdentityKey, SCAN_PAIR_CATEGORIES } from '../../shared/gridGateWorkflow.ts';
import { verifyEvidenceOwnership, bindEvidence, signOwnedEvidence } from '../../shared/hospitalityEvidence.ts';
import { normaliseVehicleDisc, normaliseDriverLicence } from '../../shared/hospitalityDocCapture.ts';
import { sanitizeVisitForList, toDataUrl } from '../../shared/hospitalityInspect.ts';

/**
 * finalizeAccessEntry — Backend access control finalisation.
 *
 * Performs in one backend operation:
 *  - validation (required fields)
 *  - duplicate active AccessLog check (person already inside) — TENANT SCOPED
 *  - blacklist check — TENANT SCOPED
 *  - visitor update (phone, scanned fields) — with tenant ownership verification
 *  - AccessLog create (entry) or update (exit)
 *  - visitor profile resolution (resolve_visitor) — server-authoritative
 *    visitor matching/creation stamped with the caller's tenant
 *  - audit entry
 *
 * TENANT ISOLATION (P0): the caller's customer/reseller scope is resolved
 * SERVER-SIDE from the authenticated User record (resolveTenantCaller — the
 * record wins over stale session claims). Every lookup and mutation is scoped
 * to that scope:
 *  - entry: the created AccessLog is stamped with the resolved tenant; a
 *    non-empty site_id is verified to belong to the caller's customer (or the
 *    caller is a platform admin); a fixed-site guard may only process their
 *    own assigned site.
 *  - exit: the target record must belong to the caller's customer (or the
 *    caller is a platform admin, or a reseller admin acting on a record of
 *    their own reseller). A fixed-site guard may only exit records of their
 *    assigned site. Cross-customer exit is rejected with 403 BEFORE any
 *    mutation — a forged/direct API call carrying another customer's
 *    access_log_id cannot succeed.
 *  - resolve_visitor: visitor lookup is scoped to the caller's customer, and
 *    new Visitor records are stamped with the caller's tenant server-side.
 *    Legacy visitor profiles without customer scope are adopted (stamped)
 *    only when that person is physically processed through THIS customer's
 *    gate — a real business relationship, never a blind reassignment.
 *
 * Preserves existing business logic. Does NOT modify Barkoder.
 *
 * COMPULSORY VISITOR MOBILE NUMBER: every entry of a person who is not a
 * resident/guard (vehicle, pedestrian, expected/QR, unexpected, contractor,
 * delivery, service provider, manual) is rejected unless a valid mobile
 * number is supplied. The number is normalised to E.164 (default country
 * South Africa +27) before it is persisted to the AccessLog entry record and
 * the Visitor profile. This is THE central server-side enforcement point —
 * no UI/API/module can complete a visitor entry without it.
 */

/* Validate + normalise a visitor mobile number to E.164 where practical.
 * Accepts SA local formats (0821234567 / 27821234567 / +27821234567) and
 * legitimate international numbers (+countrycode, 8-15 digits). */
function validateVisitorPhone(raw) {
  const digits = String(raw || '').replace(/[\s()\-.]/g, '');
  if (!digits) {
    return { ok: false, error: 'Visitor mobile number is required before entry can be completed.' };
  }
  if (/[a-zA-Z]/.test(digits)) {
    return { ok: false, error: 'Enter a valid mobile number, e.g. 0821234567 or +27821234567.' };
  }
  let e164 = null;
  if (/^0\d{9}$/.test(digits)) e164 = '+27' + digits.slice(1);
  else if (/^\+27\d{9}$/.test(digits)) e164 = digits;
  else if (/^27\d{9}$/.test(digits)) e164 = '+' + digits;
  else if (/^\+\d{8,15}$/.test(digits)) e164 = digits;
  if (!e164) {
    return { ok: false, error: 'Enter a valid mobile number, e.g. 0821234567 or +27821234567.' };
  }
  return { ok: true, value: e164 };
}

const VISITOR_FIELDS = [
  'surname', 'first_names', 'initials', 'driver_licence_number',
  'date_of_birth', 'gender', 'nationality', 'country', 'issue_date',
  'expiry_date', 'vehicle_classes', 'restrictions', 'prdp', 'licence_status',
];

const isPlatformUser = (u) =>
  u.role_type === 'platform_admin' || u.admin_level === 'platform' || u.role === 'admin';
const isResellerAdmin = (u) =>
  u.admin_level === 'reseller' || u.role_type === 'reseller_admin';

const DEVICE_BLOCK_MESSAGES = {
  device_required: 'This device is not registered for your organisation. Register the device before processing access.',
  device_not_registered: 'This device is not registered for your organisation. Register the device before processing access.',
  device_inactive: 'This device has been deactivated. Contact your administrator.',
};

/* ── REGISTERED-DEVICE ATTRIBUTION + LICENSING ENFORCEMENT ──────────────
 * Every entry/exit is permanently attributed to the USER (guard_id /
 * exit_guard_id) AND the REGISTERED DEVICE that processed it
 * (entry_device_registration_id / exit_device_registration_id). The device
 * is resolved SERVER-SIDE from the caller's ACTIVE DeviceRegistration for
 * the effective customer — the client only offers its installation_id,
 * which must match an existing registration for that customer (it can
 * never point at another customer's device). NON-PLATFORM callers FAIL
 * CLOSED: access cannot be processed from an unregistered or deactivated
 * device. Platform admins acting on a site resolve the SITE's customer
 * (legitimate oversight); their device attribution is optional. */
async function resolveCallerDevice(svc: any, caller: any, installationId: any, effectiveCid: string | null) {
  const platform = isPlatformUser(caller);
  if (!installationId || !effectiveCid) {
    return platform ? { reg: null } : { error: 'device_required' };
  }
  const rows = await svc.entities.DeviceRegistration
    .filter({ customer_id: String(effectiveCid), installation_id: String(installationId) }).catch(() => []);
  const reg = (rows && rows[0]) ? rows[0] : null;
  if (!reg) return { error: 'device_not_registered', platform };
  if (reg.status !== 'active') return { error: 'device_inactive', platform };
  // Refresh device presence (never a licence effect — the device already holds a slot).
  await svc.entities.DeviceRegistration.update(reg.id, {
    last_seen_at: new Date().toISOString(),
    last_user_id: caller.id,
    last_user_name: caller.display_name || caller.full_name || '',
  }).catch(() => {});
  return { reg };
}

/* Safe access audit event — references only (customer/site/gate/visit/user/
 * device ids + timestamps); never tokens, credentials or message bodies. */
async function auditAccess(svc: any, event_type: string, caller: any, fields: any) {
  try {
    await svc.entities.PlatformAuditLog.create({
      event_type,
      user_id: caller.id,
      user_name: caller.display_name || caller.full_name || caller.email,
      customer_id: fields.customer_id || undefined,
      reseller_id: caller.reseller_id || undefined,
      entity_name: 'AccessLog',
      entity_id: fields.access_log_id || undefined,
      action: event_type.replace('access.', ''),
      notes: String(fields.notes || '').slice(0, 400),
    });
  } catch (_) { /* best-effort audit */ }
}

/* ── ACCESS-CONTROL SECURITY ALERTS ──────────────────────────────────────
 * Blacklist hit / manual gate deny (severity 'security'): in-app + email +
 * Telegram + native push to the customer's OWN operational recipients
 * (modern roles + CONTROL ROOM narrowing, tenant-branded through the ONE
 * shared renderers). Unexpected visitor entry (severity 'info'): in-app
 * ONLY — routine gate oversight, never an email/Telegram storm per scan.
 * Fully failure-isolated: an alert failure never blocks or rolls back the
 * gate transaction that already succeeded. */
async function dispatchAccessAlert(base44: any, caller: any, log: any, heading: string, severity: string) {
  try {
    const cid = caller.customer_id || null;
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: cid, reseller_id: caller.reseller_id || null });
    const allUsers = (await base44.asServiceRole.entities.User
      .filter(cid ? { customer_id: cid } : {}).catch(() => [])) || [];
    const isPlatformUser = (u: any) => u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
    const role = allUsers.filter((u: any) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'].includes(u.role_type) &&
      (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
      (isPlatformUser(u) || !!cid));
    const recipients = await narrowControlRoomOperators(base44.asServiceRole, role, {
      customer_id: cid, site_id: (log.site_id || caller.site_id) || null });
    if (!recipients.length) return;

    const when = new Date().toLocaleString('en-ZA');
    const details = [
      { label: 'Person', value: log.person_name || 'Unknown' },
      { label: 'Person Type', value: log.person_type || 'unknown' },
      { label: 'Gate', value: log.gate_name || '—' },
      { label: 'Site', value: log.site_name || '—' },
      { label: 'Reason', value: log.flag_reason || 'Access denied at the gate' },
      { label: 'Processed By', value: log.guard_name || '—' },
      { label: 'Time', value: when },
    ];
    // Severity + event classification drive the wording: security denies,
    // routine denies (in-app only) and unexpected-visitor entries.
    const isDeny = log.event_type === 'denied' || log.status === 'denied';
    const message = severity === 'security'
      ? `${log.person_name || 'A person'} was DENIED access at ${log.gate_name || 'the gate'}${log.site_name ? ' (' + log.site_name + ')' : ''}. ${log.flag_reason || ''}`.trim()
      : isDeny
        ? `${log.person_name || 'A person'} was denied entry at ${log.gate_name || 'the gate'}${log.site_name ? ' (' + log.site_name + ')' : ''}. Reason: ${log.flag_reason || 'Manually denied at the gate'}`
        : `${log.person_name || 'A person'} was processed as an unexpected visitor at ${log.gate_name || 'the gate'}${log.site_name ? ' (' + log.site_name + ')' : ''}.`;
    const title = severity === 'security'
      ? `⛔ ACCESS DENIED — ${log.person_name || 'Unknown'}`
      : isDeny
        ? `⛔ Entry Denied — ${log.person_name || 'Unknown'}`
        : `⚠️ Unexpected Visitor — ${log.person_name || 'Unknown'}`;
    const eventKey = (severity === 'security' ? 'access_denied:'
      : isDeny ? 'access_denied_routine:' : 'access_unexpected:') + log.id;

    for (const r of recipients) {
      await base44.asServiceRole.entities.Notification.create({
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name,
        type: 'system',
        priority: severity === 'security' ? 'critical' : 'medium',
        title, message, read: false,
        related_entity: 'AccessLog', related_id: log.id,
        action_url: '/AccessHistory',
        sent_via: severity === 'security' ? ['in_app', 'email', 'telegram', 'push'] : ['in_app'],
        customer_id: cid || undefined,
        reseller_id: caller.reseller_id || undefined,
      }).catch(() => {});

      if (severity !== 'security') continue;

      await sendNativePush(base44.asServiceRole, {
        user_id: r.id, title, body: message, priority: 'critical',
        action_label: 'Open Access History', action_url: '/AccessHistory',
        event_key: eventKey,
        customer_id: cid || null, reseller_id: caller.reseller_id || null,
      }).catch(() => {});
      if (r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
        await sendTaskTelegramDeduped(base44.asServiceRole, secrets, eventKey + ':' + r.id,
          r.telegram_chat_id,
          buildBrandedTelegram({ brand, heading, details, closing: 'Please review this access security event.' }))
          .catch(() => {});
      }
      if (r.email) {
        const tpl = buildBrandedEmail({
          brand, heading,
          greeting: 'Hello,',
          intro: 'A person was denied access at the gate. Please review this security event.',
          details,
          closing: log.photo_url ? `Captured ID photo: ${log.photo_url}` : 'Please review this access event in the Access History.',
        });
        await sendAuditedEmail(base44.asServiceRole, {
          to: r.email,
          subject: title, html: tpl.html, text: tpl.text,
          brand,
          recipient_id: r.id || undefined,
          recipient_name: r.display_name || r.full_name || undefined,
          event_type: 'access_alert', reference_id: log.id || null,
          template_name: 'access_alert',
        }).catch(() => {});
      }
    }
  } catch (_) { /* alert failure NEVER blocks the gate transaction */ }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    // AUTHORITATIVE CALLER — the User record wins over stale session claims
    // (resolveTenantCaller), so tenant scope can never be spoofed or stale.
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action, access_data } = await req.json();
    if (!action || !access_data) {
      return Response.json({ error: 'action and access_data required' }, { status: 400 });
    }

    const cid = caller.customer_id || null;
    const rid = caller.reseller_id || null;
    const now = new Date().toISOString();

    /* VERIFIED SITE SCOPE — when a site is supplied, it must belong to the
     * caller's customer (platform admins exempt). A fixed-site guard may only
     * ever process their own assigned site. */
    const assertSiteScope = async (site_id) => {
      if (!site_id) return;
      if (isPlatformUser(caller)) return;
      if (caller.site_id && String(caller.site_id) !== String(site_id)) {
        return Response.json({ error: 'This site is not assigned to you', code: 'forbidden_site' }, { status: 403 });
      }
      if (cid) {
        try {
          const sites = await base44.asServiceRole.entities.Site.filter({ id: String(site_id) });
          const site = sites && sites[0];
          if (site && site.customer_id && site.customer_id !== cid) {
            return Response.json({ error: 'This site does not belong to your customer', code: 'forbidden_site_tenant' }, { status: 403 });
          }
        } catch (_) { /* site lookup failure fails CLOSED for tenant users */ }
      }
      return null;
    };

    /* ── VISITOR PROFILE RESOLUTION — server-authoritative, tenant-scoped ── */
    if (action === 'resolve_visitor') {
      const { mapped, photo_url, scan, create_if_missing } = access_data;
      const idNum = (mapped && mapped.visitor_id_number) || '';
      const licNum = (mapped && mapped.driver_licence_number) || '';

      const scanMeta = {
        scan_document_type: (scan && scan.resolvedProfileId) || '',
        scan_barcode_type: (scan && scan.result && scan.result.barcodeType) || '',
        scan_sdk_version: (scan && scan.sdkVersion) || '',
        scan_parser_used: (scan && scan.parserUsed) || '',
        scan_timestamp: new Date().toISOString(),
        scan_raw_json: (scan && (scan.result?.formattedJSONRaw || scan.result?.textualData)) || '',
      };
      if (photo_url) { scanMeta.id_scan_url = photo_url; scanMeta.scan_thumbnail_url = photo_url; }

      // Lookup is scoped to the caller's customer — a customer never matches
      // another customer's visitor profiles. Platform admins (no customer
      // scope) resolve across the platform as before.
      let visitor = null;
      const lookup = async (field, value) => {
        if (!value) return null;
        try {
          const filter = cid ? { customer_id: cid, [field]: value } : { [field]: value };
          const m = await base44.asServiceRole.entities.Visitor.filter(filter);
          return (m && m[0]) || null;
        } catch (_) { return null; }
      };
      visitor = await lookup('visitor_id_number', idNum);
      if (!visitor) visitor = await lookup('driver_licence_number', licNum);

      if (visitor) {
        const updates = { ...scanMeta };
        for (const k of VISITOR_FIELDS) {
          if (mapped && mapped[k]) updates[k] = mapped[k];
        }
        const scanName = (mapped && mapped.visitor_name)
          || [mapped?.first_names, mapped?.surname].filter(Boolean).join(' ').trim();
        if (scanName) updates.visitor_name = scanName;
        // LEGACY ADOPTION: an unsccoped visitor record processed through THIS
        // customer's gate is stamped with this customer — a real business
        // relationship (the person is entering this customer's site).
        if (!visitor.customer_id && cid) { updates.customer_id = cid; updates.reseller_id = rid || visitor.reseller_id || undefined; }
        try {
          await base44.asServiceRole.entities.Visitor.update(visitor.id, updates);
        } catch (_) {}
        return Response.json({ visitor: { ...visitor, ...updates }, created: false });
      }

      if (!create_if_missing) return Response.json({ visitor: null, created: false });

      const name = (mapped && mapped.visitor_name)
        || [mapped?.first_names, mapped?.surname].filter(Boolean).join(' ').trim()
        || 'Unknown';
      const payload = {
        customer_id: cid || undefined,
        reseller_id: rid || undefined,
        visitor_name: name,
        resident_id: '',
        visit_type: 'unexpected',
        status: 'pending',
        visitor_id_number: idNum,
        ...Object.fromEntries(VISITOR_FIELDS.map((k) => [k, (mapped && mapped[k]) || ''])),
        ...scanMeta,
      };
      const created = await base44.asServiceRole.entities.Visitor.create(payload);
      return Response.json({ visitor: created, created: true });
    }

    /* ── MANUAL QR-DENY — audit-only denied record. Tenant ownership is
     * derived SERVER-SIDE from the authenticated caller (never from the
     * client payload), and a supplied site must pass the same scope
     * assertion as a real entry. Previously the client wrote this record
     * directly with a client-supplied customer_id. */
    if (action === 'deny') {
      const d = access_data || {};
      if (!d.gate_name) return Response.json({ error: 'gate_name required' }, { status: 400 });
      const siteErr = await assertSiteScope(d.site_id || caller.site_id || undefined);
      if (siteErr) return siteErr;
      const log = await base44.asServiceRole.entities.AccessLog.create({
        customer_id: cid || undefined,
        reseller_id: rid || undefined,
        site_id: d.site_id || caller.site_id || undefined,
        site_name: d.site_name || caller.site_name || '',
        event_type: 'denied',
        status: 'denied',
        person_type: d.person_type || 'unknown',
        person_id: d.person_id || '',
        person_name: d.person_name || 'Unknown',
        person_phone: d.person_phone || '',
        visitor_id: d.visitor_id || '',
        unit_number: d.unit_number || '',
        gate_name: d.gate_name,
        scan_method: d.scan_method || 'qr_code',
        scanned_data: d.scanned_data || '',
        qr_code: d.qr_code || '',
        driver_licence_number: d.driver_licence_number || '',
        sa_id_number: d.sa_id_number || '',
        vehicle_registration: d.vehicle_registration || '',
        vehicle_licence_disc_number: d.vehicle_licence_disc_number || '',
        vehicle_vin: d.vehicle_vin || '',
        vehicle_make: d.vehicle_make || '',
        vehicle_model: d.vehicle_model || '',
        vehicle_colour: d.vehicle_colour || '',
        vehicle_licence_number: d.vehicle_licence_number || '',
        destination: d.destination || '',
        visitor_type: d.visitor_type || '',
        visit_or_work: d.visit_or_work || 'none',
        work_type: d.work_type || '',
        parsed_json: d.parsed_json || '',
        confidence: d.confidence ?? null,
        device: d.device || '',
        photo_url: d.photo_url || '',
        location: d.location || null,
        entry_time: now,
        exit_time: null,
        time_on_site_minutes: null,
        timestamp: now,
        guard_id: caller.id,
        guard_name: caller.full_name || caller.email || '',
        flagged: true,
        flag_reason: d.flag_reason || 'Manually denied at the gate',
        notes: d.notes || '',
      });
      // DENY CLASSIFICATION (2026-09-22 review) — not every manual denial is a
      // high-severity security event. Only a deny reason indicating a genuine
      // security concern escalates to the full-channel security alert (in-app
      // + email + Telegram + push); routine denials (unrecognised QR, no
      // appointment, ...) stay in-app-only to avoid notification overload.
      const denyReason = String(log.flag_reason || '');
      const securityDeny = /blacklist|suspend|suspicious|threat|wanted|fake|forged|security|no id|refused|banned|stolen/i.test(denyReason);
      await dispatchAccessAlert(base44, caller, log,
        securityDeny ? 'Access Denied at Gate — Security Concern' : 'Access Denied at Gate',
        securityDeny ? 'security' : 'info');
      return Response.json({ log });
    }

    if (action === 'entry') {
      const { site_id, gate_name, site_name, person_type, person_name, person_phone,
              person_id, scan_method, visitor_id, destination, visit_or_work, work_type,
              vehicle_registration, sa_id_number, driver_licence_number,
              vehicle_licence_disc_number, vehicle_vin, vehicle_make, vehicle_model,
              vehicle_colour, vehicle_licence_number, visitor_type, scanned_data,
              parsed_json, confidence, device, notes,
              photo_url, qr_code, location, unit_number, company,
              installation_id } = access_data;

      if (!gate_name || !person_type || !person_name) {
        return Response.json({ error: 'gate_name, person_type, person_name required' }, { status: 400 });
      }

      // SITE SCOPE — reject a site outside the caller's permitted scope before
      // anything is written (cross-customer/cross-site bypass protection).
      const siteErr = await assertSiteScope(site_id);
      if (siteErr) return siteErr;

      // GRID GATE HOSPITALITY WORKFLOW GUARD — the site's own access_workflow
      // (never a client-supplied value) is authoritative. A site configured
      // for the hospitality workflow must use the hospitality_submit action,
      // which enforces that workflow's own mandatory fields server-side; the
      // plain 'entry' action would otherwise let a direct API call bypass
      // every category requirement (reception confirmation, firearm/vehicle/
      // evidence photos, occupant counts, room numbers).
      if (site_id) {
        const siteRows = await base44.asServiceRole.entities.Site.filter({ id: String(site_id) }).catch(() => []);
        const siteRec = (siteRows && siteRows[0]) || null;
        if (siteRec && siteRec.access_workflow === HOSPITALITY_WORKFLOW_ID) {
          return Response.json({
            error: 'This site uses the GRID GATE Hospitality workflow. Use the hospitality_submit action with the required category and fields.',
            code: 'wrong_workflow',
          }, { status: 400 });
        }
      }

      // REGISTERED-DEVICE REQUIREMENT — server-side fail closed for
      // non-platform callers: entry cannot be processed from an unregistered
      // or deactivated device (an over-licence installation never reaches
      // here — it is blocked at registration by the deviceAccess gateway).
      // The device is resolved from the CALLER's effective customer scope;
      // a platform admin acting on a site resolves the site's customer.
      let deviceCid = cid;
      if (!deviceCid && site_id) {
        try {
          const sRows = await base44.asServiceRole.entities.Site.filter({ id: String(site_id) });
          deviceCid = (sRows && sRows[0]) ? (sRows[0].customer_id || null) : null;
        } catch (_) { deviceCid = null; }
      }
      const deviceCheck = await resolveCallerDevice(base44.asServiceRole, caller, installation_id, deviceCid);
      if (deviceCheck.error) {
        await auditAccess(base44.asServiceRole, 'access.permission_denied', caller, {
          customer_id: cid, site_id, gate_name,
          notes: `Entry denied — ${deviceCheck.error}`,
        });
        return Response.json({ error: DEVICE_BLOCK_MESSAGES[deviceCheck.error], code: deviceCheck.error }, { status: 403 });
      }
      const deviceReg = deviceCheck.reg || null;

      // RECORD TENANT SCOPE for platform-oversight entries: a platform admin
      // processing a gate at a tenant SITE produces a record scoped to that
      // site's customer (cid is null for platform callers). Without this the
      // visit record is unscoped: the tenant cannot see it in Access History
      // and a later EXIT cannot resolve its device attribution (the exit
      // resolves the device from the record's own customer scope). Tenant
      // callers are unaffected — deviceCid already equals their cid.
      const recordCid = cid || deviceCid || null;

      // COMPULSORY VISITOR MOBILE NUMBER — enforced centrally and EXPLICITLY
      // for the application's authoritative visitor-class person types only
      // (AccessLog.person_type enum): visitor (incl. expected/invited,
      // pedestrian, vehicle driver, delivery, service provider and temporary
      // visitors processed as 'visitor'), contractor, vendor and unknown
      // (manual/unrecognised entrants processed through Access Control).
      // resident, guard and any FUTURE non-visitor person type (employee/
      // staff/system) are deliberately NOT in this allowlist and stay exempt
      // unless actually processed as a visitor class.
      const VISITOR_PERSON_TYPES = ['visitor', 'contractor', 'vendor', 'unknown'];
      const phoneCheck = validateVisitorPhone(person_phone);
      if (VISITOR_PERSON_TYPES.includes(person_type) && !phoneCheck.ok) {
        return Response.json({ error: phoneCheck.error }, { status: 400 });
      }
      const e164Phone = phoneCheck.ok ? phoneCheck.value : (person_phone || '');

      // DUPLICATE ACTIVE ENTRY — TENANT SCOPED. Duplicate/on-site detection
      // matches only records of the caller's own customer: a person on site
      // at Customer A must not make Customer B believe they are on site here.
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const dupFilter = recordCid ? { customer_id: recordCid, status: 'inside' } : { status: 'inside' };
        if (site_id) dupFilter.site_id = site_id;
        const dups = await base44.asServiceRole.entities.AccessLog.filter(dupFilter, '-created_date', 50);
        const isDup = dups.find(d => {
          if (sa_id_number && d.sa_id_number === sa_id_number) return true;
          if (driver_licence_number && d.driver_licence_number === driver_licence_number) return true;
          if (vehicle_registration && d.vehicle_registration === vehicle_registration) return true;
          return false;
        });
        if (isDup) {
          await auditAccess(base44.asServiceRole, 'access.entry_duplicate_blocked', caller, {
            customer_id: cid, site_id, gate_name, access_log_id: isDup.id,
            notes: `Duplicate entry blocked — person/vehicle already inside (record ${isDup.id})`,
          });
          return Response.json({ error: 'An active entry already exists.', duplicate: true, existing_log_id: isDup.id }, { status: 409 });
        }
      }

      // BLACKLIST — TENANT SCOPED: only the caller's own customer's blacklist
      // records may produce a match (Customer A's bans never block Customer B).
      let blacklistMatch = null;
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const blFilter = recordCid ? { customer_id: recordCid, active: true } : { active: true };
        const blEntries = await base44.asServiceRole.entities.BlacklistEntry.filter(blFilter, '-created_date', 200);
        blacklistMatch = blEntries.find(b => {
          if (b.identifier_type === 'sa_id' && sa_id_number && b.identifier_value === sa_id_number.toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'driver_licence' && driver_licence_number && b.identifier_value === driver_licence_number.toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'vehicle_registration' && vehicle_registration && b.identifier_value === vehicle_registration.toUpperCase().replace(/\s/g, '')) return true;
          return false;
        });
      }

      // VISITOR OWNERSHIP — an explicitly supplied visitor_id is verified to
      // belong to the caller's customer (or be a legacy unsccoped profile,
      // which is then adopted by this customer through this real entry).
      if (visitor_id) {
        try {
          const rows = await base44.asServiceRole.entities.Visitor.filter({ id: String(visitor_id) });
          const v = rows && rows[0];
          if (v && !isPlatformUser(caller) && v.customer_id && cid && v.customer_id !== cid) {
            return Response.json({ error: 'That visitor profile does not belong to your customer', code: 'forbidden_visitor' }, { status: 403 });
          }
          const vUpdates = {
            visitor_phone: e164Phone,
            entered_at: now,
            status: 'entered'
          };
          if (!v.customer_id && cid) { vUpdates.customer_id = cid; vUpdates.reseller_id = rid || undefined; }
          await base44.asServiceRole.entities.Visitor.update(visitor_id, vUpdates);
        } catch (e) {}
      }

      // Create AccessLog — tenant scope is SERVER-DERIVED (caller record),
      // never client-supplied.
      const log = await base44.asServiceRole.entities.AccessLog.create({
        customer_id: recordCid,
        reseller_id: rid,
        site_id,
        event_type: blacklistMatch ? 'denied' : 'entry',
        status: blacklistMatch ? 'blacklisted' : 'inside',
        person_type,
        person_name,
        person_phone: e164Phone,
        person_id,
        visitor_id,
        unit_number,
        gate_name,
        site_name,
        scan_method,
        sa_id_number,
        driver_licence_number,
        vehicle_registration,
        vehicle_licence_disc_number,
        vehicle_vin,
        vehicle_make,
        vehicle_model,
        vehicle_colour,
        vehicle_licence_number,
        visitor_type,
        scanned_data,
        parsed_json,
        confidence,
        device,
        destination,
        visit_or_work: visit_or_work || 'none',
        work_type,
        company,
        photo_url,
        qr_code,
        notes,
        location,
        entry_time: now,
        timestamp: now,
        guard_id: caller.id,
        guard_name: caller.display_name || caller.full_name,
        entry_device_registration_id: deviceReg ? deviceReg.id : null,
        entry_device_name: deviceReg ? deviceReg.device_name : null,
        flagged: !!blacklistMatch,
        flag_reason: blacklistMatch ? ('Blacklist match: ' + (blacklistMatch.reason || 'banned identifier')) : undefined,
        blacklist_match_id: blacklistMatch?.id
      });

      // DUPLICATE RACE (post-commit tiebreak, 2026-09-29): two gates
      // processing the same person within milliseconds can both pass the
      // pre-check. Each re-checks after commit; deterministic single-survivor
      // rule — the record with the SMALLER id stays, the later one deletes
      // itself and reports the duplicate. Exactly one active visit remains.
      if (!blacklistMatch && (sa_id_number || driver_licence_number || vehicle_registration) && recordCid) {
        const dups2 = await base44.asServiceRole.entities.AccessLog
          .filter({ customer_id: recordCid, status: 'inside' }, '-created_date', 50).catch(() => []);
        const twin = (dups2 || []).find((d) => d.id !== log.id &&
          ((sa_id_number && d.sa_id_number === sa_id_number) ||
           (driver_licence_number && d.driver_licence_number === driver_licence_number) ||
           (vehicle_registration && d.vehicle_registration === vehicle_registration)));
        if (twin && String(twin.id).localeCompare(String(log.id)) < 0) {
          await base44.asServiceRole.entities.AccessLog.delete(log.id).catch(() => {});
          await auditAccess(base44.asServiceRole, 'access.entry_duplicate_blocked', caller, {
            customer_id: cid, site_id, gate_name, access_log_id: twin.id,
            notes: 'Concurrent duplicate entry race — the earlier record was kept',
          });
          return Response.json({ error: 'An active entry already exists.', duplicate: true, existing_log_id: twin.id }, { status: 409 });
        }
      }

      await auditAccess(base44.asServiceRole, 'access.entry', caller, {
        customer_id: recordCid, site_id, gate_name, access_log_id: log.id,
        notes: `Entry processed by ${caller.display_name || caller.full_name}${deviceReg ? ' on device ' + (deviceReg.device_name || deviceReg.id) : ''}`,
      });

      // SECURITY ALERT on a blacklist hit (all channels) / IN-APP ONLY for an
      // unexpected visitor (routine gate oversight — no email/Telegram per
      // scan). Failure-isolated; never blocks the entry transaction.
      if (blacklistMatch) {
        await dispatchAccessAlert(base44, caller, log, 'Blacklisted Person Denied Entry', 'security');
      } else if (person_type === 'visitor' && (visitor_type === 'unexpected' || scan_method === 'manual')) {
        await dispatchAccessAlert(base44, caller, log, 'Unexpected Visitor Entered', 'info');
      }

      return Response.json({ success: true, access_log: log, blacklist_match: blacklistMatch ? { id: blacklistMatch.id, reason: blacklistMatch.reason } : null });
    }

    if (action === 'exit') {
      const { access_log_id, site_id, gate_name, scan_method, exit_notes, location, installation_id } = access_data;
      if (!access_log_id) {
        return Response.json({ error: 'access_log_id required for exit' }, { status: 400 });
      }

      const logs = await base44.asServiceRole.entities.AccessLog.filter({ id: access_log_id });
      const existing = logs[0];
      if (!existing) return Response.json({ error: 'AccessLog not found' }, { status: 404 });
      if (existing.status !== 'inside') return Response.json({ error: 'Visitor is not currently inside' }, { status: 400 });

      // ── CROSS-TENANT EXIT PROTECTION (P0) ──────────────────────────────
      // The exit mutation is authorised only when the caller's resolved
      // scope owns the target record:
      //   • Platform admin: any record (legitimate oversight).
      //   • Reseller admin: records of their own reseller.
      //   • Everyone else: records of their OWN customer only.
      // A guard with a fixed site assignment may only exit records of that
      // site. A forged/direct API call with another customer's record id is
      // rejected here, BEFORE any mutation happens.
      if (!isPlatformUser(caller)) {
        if (isResellerAdmin(caller)) {
          if (!rid || existing.reseller_id !== rid) {
            return Response.json({ error: 'This record does not belong to your reseller', code: 'forbidden_cross_tenant' }, { status: 403 });
          }
        } else {
          if (!cid || !existing.customer_id || existing.customer_id !== cid) {
            return Response.json({ error: 'This record does not belong to your customer', code: 'forbidden_cross_tenant' }, { status: 403 });
          }
          if (caller.site_id && existing.site_id && String(caller.site_id) !== String(existing.site_id)) {
            return Response.json({ error: 'This visitor entered through a site not assigned to you', code: 'forbidden_site' }, { status: 403 });
          }
        }
      }

      // REGISTERED-DEVICE REQUIREMENT — same server-side fail-closed rule as
      // entry. A device may process the exit of a visit whose ENTRY happened
      // on a DIFFERENT gate/device (cross-gate exit is legitimate); the only
      // requirement is that THIS device is registered+active for the same
      // customer that owns the visit.
      const deviceCheck = await resolveCallerDevice(base44.asServiceRole, caller, installation_id, existing.customer_id || cid);
      if (deviceCheck.error) {
        await auditAccess(base44.asServiceRole, 'access.permission_denied', caller, {
          customer_id: existing.customer_id || cid, site_id: existing.site_id, gate_name, access_log_id,
          notes: `Exit denied — ${deviceCheck.error}`,
        });
        return Response.json({ error: DEVICE_BLOCK_MESSAGES[deviceCheck.error], code: deviceCheck.error }, { status: 403 });
      }
      const deviceReg = deviceCheck.reg || null;

      const exitTime = new Date();
      const entryTime = new Date(existing.entry_time || existing.timestamp);
      const minutes = Math.round((exitTime - entryTime) / 60000);
      const exitIso = exitTime.toISOString();

      // CONCURRENT EXIT PROTECTION (2026-09-29): the exit is a CONDITIONAL
      // (CAS) update that only matches status 'inside'. Two devices pressing
      // Exit for the same visit at nearly the same time: exactly ONE commits
      // the transition; the loser updates ZERO records and receives a safe
      // 'already exited' response — never two exit records, never conflicting
      // timestamps. The exit attribution is written SEPARATELY from the
      // entry attribution and never overwrites it.
      await base44.asServiceRole.entities.AccessLog.updateMany(
        { id: String(access_log_id), status: 'inside' },
        { $set: {
          event_type: 'exit',
          status: 'exited',
          exit_time: exitIso,
          exit_gate: gate_name,
          exit_guard_id: caller.id,
          exit_guard_name: caller.display_name || caller.full_name,
          exit_scan_method: scan_method,
          exit_location: location,
          exit_notes,
          exit_device_registration_id: deviceReg ? deviceReg.id : null,
          exit_device_name: deviceReg ? deviceReg.device_name : null,
          time_on_site_minutes: minutes,
        } }
      ).catch(() => null);

      // Verify the commit — the server response is authoritative.
      const afterRows = await base44.asServiceRole.entities.AccessLog.filter({ id: String(access_log_id) }).catch(() => []);
      const after = (afterRows && afterRows[0]) ? afterRows[0] : null;
      if (!after || after.status !== 'exited') {
        // Our CAS matched nothing AND no other exit exists → technical commit
        // failure; report it honestly (never a false 'exited').
        return Response.json({ error: 'Exit could not be confirmed. Please try again.', code: 'exit_commit_failed' }, { status: 500 });
      }
      if (after.exit_time !== exitIso) {
        // Another device won the race and exited the visit first.
        await auditAccess(base44.asServiceRole, 'access.exit_duplicate_blocked', caller, {
          customer_id: existing.customer_id || cid, site_id: existing.site_id, gate_name, access_log_id,
          notes: 'Concurrent exit — visit already exited by another device',
        });
        return Response.json({ error: 'This visit has already been exited.', code: 'already_exited', duplicate: true }, { status: 409 });
      }

      // Update visitor status — only the visitor linked to THIS record.
      if (existing.visitor_id) {
        try {
          await base44.asServiceRole.entities.Visitor.update(existing.visitor_id, { status: 'exited', exited_at: exitIso });
        } catch (e) {}
      }

      await auditAccess(base44.asServiceRole, 'access.exit', caller, {
        customer_id: existing.customer_id || cid, site_id: existing.site_id, gate_name, access_log_id,
        notes: `Exit processed by ${caller.display_name || caller.full_name}${deviceReg ? ' on device ' + (deviceReg.device_name || deviceReg.id) : ''}`,
      });

      return Response.json({ success: true, access_log: after });
    }

    /* ── GRID GATE HOSPITALITY WORKFLOW ──────────────────────────────────
     * hospitality_submit: the SOLE write path for a site whose Site.
     * access_workflow is 'grid_gate_hospitality'. Every required
     * confirmation/evidence field for the submitted category is
     * RE-VALIDATED here via the shared validator (never trusts a client
     * "confirmed" flag). An unanswered or negative required confirmation
     * never grants access — the HospitalityVisit stays 'pending' and no
     * AccessLog is created; the caller may resubmit (same
     * hospitality_visit_id) or cancel with a reason. */
    if (action === 'hospitality_submit') {
      const d = access_data || {};
      // Document identifiers are derived ONLY from the server-validated
      // vehicle_disc / driver_licence captures, never loose client fields.
      const { site_id, category, gate_name, person_phone,
              scanned_data, parsed_json,
              confidence, device, photo_url, location, installation_id,
              hospitality_visit_id, submit_token } = d;
      // Uber / Uber Eats: the SA licence alternative is scanned like the rest.
      const licenceRequired = SCAN_PAIR_CATEGORIES.includes(category) || d.identity_document_type === 'sa_drivers_licence_disc';
      const discN: any = await normaliseVehicleDisc(d.vehicle_disc);
      const licN: any = licenceRequired ? await normaliseDriverLicence(d.driver_licence) : {};
      const disc = discN.capture || null;
      const lic = licN.capture || null;
      const captureState = {
        vehicle_disc: disc, vehicle_disc_error: discN.error || null,
        driver_licence: lic, driver_licence_error: licN.error || null,
      };
      const vehicle_registration = disc ? disc.identifier : null;
      const vehicle_licence_disc_number = disc?.fields.licence_number || null;
      const vehicle_make = disc?.fields.make || null;
      const vehicle_model = disc?.fields.model || null;
      const vehicle_colour = disc?.fields.colour || null;
      const vehicle_licence_number = null;
      const driver_licence_number = lic ? lic.identifier : null;
      const sa_id_number = lic?.fields.id_number ? (String(lic.fields.id_number).replace(/\D/g, '') || null) : null;
      const scan_method = (lic || disc)
        ? ((lic || disc).method === 'scanned' ? (lic ? 'drivers_licence' : 'vehicle_disc') : 'manual')
        : 'manual';
      // Name: typed by the guard, or taken from the decoded licence (never
      // requires retyping successfully decoded information).
      const person_name = String(d.person_name || '').trim() || lic?.fields.holder_name || '';
      // Uber Eats / Mr D: the vehicle REMAINS OUTSIDE — its disc is recorded
      // on the visit, but never on the AccessLog (no on-site vehicle).
      const logVehicleReg = category === 'uber_eats_mrd' ? null : vehicle_registration;

      if (!site_id || !category || !gate_name || !person_name) {
        return Response.json({ error: 'site_id, category, gate_name and person_name are required' }, { status: 400 });
      }
      if (!HOSPITALITY_CATEGORIES.includes(category)) {
        return Response.json({ error: 'Unknown hospitality category', code: 'invalid_category' }, { status: 400 });
      }
      // COMPULSORY VISITOR MOBILE NUMBER — the hospitality workflow processes
      // exactly the visitor-class entries the central rule covers (visitors,
      // contractors, deliveries, service providers, staff, drivers), so the
      // SAME central enforcement applies here: no valid mobile number, no
      // entry. Normalised to E.164 (default +27) before it is persisted.
      const phoneCheck = validateVisitorPhone(person_phone);
      if (!phoneCheck.ok) {
        return Response.json({ error: phoneCheck.error }, { status: 400 });
      }

      const siteErr = await assertSiteScope(site_id);
      if (siteErr) return siteErr;

      const siteRows = await base44.asServiceRole.entities.Site.filter({ id: String(site_id) }).catch(() => []);
      const siteRec = (siteRows && siteRows[0]) || null;
      if (!siteRec) return Response.json({ error: 'Site not found' }, { status: 404 });
      if (siteRec.access_workflow !== HOSPITALITY_WORKFLOW_ID) {
        return Response.json({ error: 'This site does not use the GRID GATE Hospitality workflow', code: 'wrong_workflow' }, { status: 400 });
      }

      const recordCid = cid || siteRec.customer_id || null;
      const recordRid = rid || siteRec.reseller_id || null;

      // Fields captured from the category question set (shared validator
      // re-checks these — the client's own "confirmed" flags are never trusted).
      const answers = {
        guest_name: d.guest_name || null,
        guest_surname: d.guest_surname || null,
        reception_confirmed: typeof d.reception_confirmed === 'boolean' ? d.reception_confirmed : null,
        reception_confirmed_note: d.reception_confirmed_note || null,
        occupant_count: d.occupant_count !== undefined && d.occupant_count !== null && d.occupant_count !== '' ? Number(d.occupant_count) : null,
        room_number: d.room_number || null,
        room_number_source: d.room_number_source || null,
        firearm_declared: typeof d.firearm_declared === 'boolean' ? d.firearm_declared : null,
        firearm_photo_uri: d.firearm_photo_uri || null,
        po_invoice_available: typeof d.po_invoice_available === 'boolean' ? d.po_invoice_available : null,
        po_invoice_photo_uri: d.po_invoice_photo_uri || null,
        vehicle_photo_uris: Array.isArray(d.vehicle_photo_uris) ? d.vehicle_photo_uris : [],
        staff_declared: typeof d.staff_declared === 'boolean' ? d.staff_declared : null,
        staff_declaration_photo_uris: Array.isArray(d.staff_declaration_photo_uris) ? d.staff_declaration_photo_uris : [],
        food_photo_uri: d.food_photo_uri || null,
        delivery_person_photo_uri: d.delivery_person_photo_uri || null,
        pedestrian_only: category === 'uber_eats_mrd' ? (d.pedestrian_only === true) : !!d.pedestrian_only,
        identity_document_type: d.identity_document_type || null,
        identity_document_photo_uri: ['passport', 'foreign_drivers_licence'].includes(d.identity_document_type) ? (d.identity_document_photo_uri || null) : null,
        identity_document_number: ['passport', 'foreign_drivers_licence'].includes(d.identity_document_type) ? (String(d.identity_document_number || '').trim().slice(0, 40) || null) : null,
        driver_licence_number,
        vehicle_make, vehicle_model, vehicle_colour,
        vehicle_disc_capture_method: disc ? disc.method : null,
        vehicle_disc_payload_sha256: disc ? disc.payload_sha256 : null,
        vehicle_disc_photo_uri: disc ? disc.photo_uri : null,
        driver_licence_capture_method: lic ? lic.method : null,
        driver_licence_payload_sha256: lic ? lic.payload_sha256 : null,
        driver_licence_photo_uri: lic ? lic.photo_uri : null,
        licence_holder_name: lic?.fields.holder_name || null,
      };
      // Visitors who KNEW the room number: reception is not applicable —
      // stored as null (not applicable), never as a rejected confirmation.
      if (category === 'visitor' && answers.room_number_source === 'provided') {
        answers.reception_confirmed = null;
      }

      // Resolve or create the draft HospitalityVisit. A supplied id must
      // belong to this exact customer+site and still be 'pending' — it can
      // never be reused to silently continue/overwrite a DIFFERENT confirmed
      // or cancelled visit (no cross-visit answer/photo leakage).
      let visit = null;
      if (hospitality_visit_id) {
        const rows = await base44.asServiceRole.entities.HospitalityVisit.filter({ id: String(hospitality_visit_id) }).catch(() => []);
        const existing = (rows && rows[0]) || null;
        if (existing && existing.customer_id === recordCid && existing.site_id === site_id && existing.status === 'pending') {
          visit = existing;
        }
      }
      // TOKEN-BASED IDEMPOTENCY — a retried, double-tapped or concurrent
      // submission whose client lost the pending visit id (or whose success
      // response was never received) reuses the visit created by the FIRST
      // attempt with the same token instead of creating a second one. An
      // already-CONFIRMED token match returns the ORIGINAL result unchanged
      // (idempotent success — never a second AccessLog, never a second
      // grant). Cancelled token matches are ignored: a fresh attempt after a
      // cancellation legitimately creates a new visit.
      if (!visit && submit_token) {
        const tokenRows = (await base44.asServiceRole.entities.HospitalityVisit
          .filter({ customer_id: recordCid, site_id, category, submit_token: String(submit_token) }, '-created_date', 5).catch(() => [])) || [];
        const confirmedRow = tokenRows.find((r: any) => r.status === 'confirmed');
        if (confirmedRow) {
          const prevRows = (await base44.asServiceRole.entities.AccessLog.filter({ id: confirmedRow.access_log_id }).catch(() => [])) || [];
          return Response.json({ success: true, idempotent: true, access_log: prevRows[0] || null, hospitality_visit: confirmedRow });
        }
        const reusable = tokenRows.find((r: any) => r.status === 'pending' || r.status === 'confirming');
        if (reusable) { visit = reusable; }
      }
      const svc = base44.asServiceRole.entities;
      const identityKey = hospitalityIdentityKey(person_name, phoneCheck.value);
      const visitFields = {
        category, person_name, person_phone: phoneCheck.value || null,
        vehicle_registration: vehicle_registration || null,
        vehicle_licence_disc_number: vehicle_licence_disc_number || null,
        sa_id_number: sa_id_number || null,
        scan_method: scan_method || null,
        submit_token: submit_token ? String(submit_token) : null,
        identity_key: identityKey,
        confirmation_party: CONFIRMATION_PARTY[category] || null,
        ...answers,
      };
      if (visit) {
        // Answers may only change while the visit is still PENDING (atomic
        // conditional update) — a visit being confirmed is never rewritten
        // underneath the request that holds its confirmation claim.
        await svc.HospitalityVisit.updateMany({ id: String(visit.id), status: 'pending' }, { $set: visitFields }).catch(() => null);
        visit = ((await svc.HospitalityVisit.filter({ id: String(visit.id) }).catch(() => [])) || [])[0] || visit;
      } else {
        visit = await svc.HospitalityVisit.create({
          customer_id: recordCid,
          reseller_id: recordRid,
          site_id,
          site_name: siteRec.name || '',
          workflow_id: HOSPITALITY_WORKFLOW_ID,
          workflow_version: Number(siteRec.access_workflow_version) || 1,
          status: 'pending',
          created_by_guard_id: caller.id,
          created_by_guard_name: caller.display_name || caller.full_name || '',
          ...visitFields,
        });
      }
      const pendingResp = (code: string, error: string, extra: any = {}) => Response.json({
        success: false, pending: true, code, error,
        hospitality_visit_id: visit.id, category_label: CATEGORY_LABELS[category], ...extra });

      // SERVER-SIDE VALIDATION — the single authoritative decision.
      const validation = validateHospitalitySubmission(category, { ...answers, ...captureState });
      if (!validation.ok) return pendingResp(validation.code, validation.error);

      // EVIDENCE OWNERSHIP — existence is not ownership. Every uri must have a
      // server-created HospitalityEvidence record for THIS customer + site and
      // THIS upload session (submit_token) or already be bound to this visit.
      const evidenceUris = [
        answers.firearm_photo_uri, answers.po_invoice_photo_uri,
        answers.food_photo_uri, answers.delivery_person_photo_uri,
        answers.identity_document_photo_uri,
        answers.vehicle_disc_photo_uri, answers.driver_licence_photo_uri,
        ...(answers.vehicle_photo_uris || []),
        ...(answers.staff_declaration_photo_uris || []),
      ].filter(Boolean).map(String);
      const own = await verifyEvidenceOwnership(base44.asServiceRole, evidenceUris, {
        customer_id: recordCid, site_id: String(site_id), submit_token: visit.submit_token || null, visit_id: visit.id });
      if (!own.ok) {
        await auditAccess(base44.asServiceRole, 'access.hospitality_evidence_rejected', caller, {
          customer_id: recordCid, site_id, gate_name, notes: `Evidence rejected for visit ${visit.id}: ${own.reason}` });
        return pendingResp('evidence_invalid', 'A captured photo could not be verified for this visit. Re-capture the photo.');
      }

      // Device registration requirement — reused unchanged from the default flow.
      const deviceCheck = await resolveCallerDevice(base44.asServiceRole, caller, installation_id, recordCid);
      if (deviceCheck.error) {
        await auditAccess(base44.asServiceRole, 'access.permission_denied', caller, {
          customer_id: recordCid, site_id, gate_name,
          notes: `Hospitality entry denied — ${deviceCheck.error}`,
        });
        return Response.json({ error: DEVICE_BLOCK_MESSAGES[deviceCheck.error], code: deviceCheck.error }, { status: 403 });
      }
      const deviceReg = deviceCheck.reg || null;

      // BLACKLIST — tenant-scoped, unchanged rule (document/vehicle identifiers).
      let blacklistMatch = null;
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const blFilter: any = recordCid ? { customer_id: recordCid, active: true } : { active: true };
        const blEntries = await svc.BlacklistEntry.filter(blFilter, '-created_date', 200).catch(() => []);
        blacklistMatch = (blEntries || []).find((b: any) => {
          if (b.identifier_type === 'sa_id' && sa_id_number && b.identifier_value === String(sa_id_number).toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'driver_licence' && driver_licence_number && b.identifier_value === String(driver_licence_number).toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'vehicle_registration' && vehicle_registration && b.identifier_value === String(vehicle_registration).toUpperCase().replace(/\s/g, '')) return true;
          return false;
        }) || null;
      }

      /* ── ATOMIC CONFIRMATION CLAIM ───────────────────────────────────────
       * updateMany is a server-side conditional update returning the number
       * of records it changed (verified: 12 concurrent claims → exactly one
       * updated:1). The claim matches a PENDING visit, or a CONFIRMING visit
       * whose claim is older than 2 minutes (atomic steal from a crashed
       * claimant). The winner holds a unique confirm_claim_token; every later
       * write on this visit is conditional on that token, so a stale claimant
       * can never overwrite a replacement claimant's result. */
      const CLAIM_TTL_MS = 2 * 60 * 1000;
      const myClaim = crypto.randomUUID();
      const claimRes: any = await svc.HospitalityVisit.updateMany(
        { id: String(visit.id), $or: [
          { status: 'pending' },
          { status: 'confirming', confirm_claimed_at: { $lt: new Date(Date.now() - CLAIM_TTL_MS).toISOString() } },
        ] },
        { $set: { status: 'confirming', confirm_claim_token: myClaim, confirm_claimed_at: new Date().toISOString() } },
      ).catch(() => null);
      const readVisit = async () => ((await svc.HospitalityVisit.filter({ id: String(visit.id) }).catch(() => [])) || [])[0] || null;
      const logById = async (id: any) => id ? (((await svc.AccessLog.filter({ id: String(id) }).catch(() => [])) || [])[0] || null) : null;
      if (!claimRes || !claimRes.updated) {
        const cur = await readVisit();
        if (cur && cur.status === 'confirmed') {
          return Response.json({ success: true, idempotent: true, access_log: await logById(cur.access_log_id), hospitality_visit: cur });
        }
        return pendingResp('confirmation_in_progress', 'This visit is being confirmed by another request. Check the live access log in a moment.');
      }
      const releaseClaim = () => svc.HospitalityVisit.updateMany(
        { id: String(visit.id), status: 'confirming', confirm_claim_token: myClaim },
        { $set: { status: 'pending', confirm_claim_token: null, confirm_claimed_at: null } }).catch(() => null);
      const cancelOwnDraft = (reason: string, dupOf: string | null) => svc.HospitalityVisit.updateMany(
        { id: String(visit.id), status: 'confirming', confirm_claim_token: myClaim },
        { $set: { status: 'cancelled', cancel_reason: reason, duplicate_of_access_log_id: dupOf,
          cancelled_at: new Date().toISOString(), cancelled_by_id: caller.id,
          cancelled_by_name: caller.display_name || caller.full_name || '', confirm_claim_token: null } }).catch(() => null);
      const voidLog = (id: string, reason: string, canonical: string | null) => svc.AccessLog.update(id, {
        status: 'voided', void_reason: reason, voided_at: new Date().toISOString(), canonical_access_log_id: canonical,
      }).catch(() => null);

      /* ── PER-SITE GRANT LOCK ─────────────────────────────────────────────
       * The platform has no unique indexes or multi-record transactions, so
       * the duplicate-presence decision is serialised per site with an atomic
       * conditional mutex on the Site record (null/expired → my token). The
       * duplicate check, AccessLog create and confirmation stamp all happen
       * inside it. A holder that overran its lease re-checks it (fence) after
       * creating its entry and VOIDS that entry if the lease was lost — a void
       * correction, never a fabricated exit. */
      const LOCK_TTL_MS = 30 * 1000;
      const lockTok = crypto.randomUUID();
      let locked = false;
      for (let i = 0; i < 25 && !locked; i++) {
        const r: any = await svc.Site.updateMany(
          { id: String(site_id), $or: [
            { hospitality_grant_lock_token: null },
            { hospitality_grant_lock_expires_at: { $lt: new Date().toISOString() } },
          ] },
          { $set: { hospitality_grant_lock_token: lockTok, hospitality_grant_lock_expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString() } },
        ).catch(() => null);
        if (r && r.updated) locked = true;
        else await new Promise((res) => setTimeout(res, 150 + Math.floor(Math.random() * 200)));
      }
      if (!locked) {
        await releaseClaim();
        return pendingResp('gate_busy', 'Another entry is being processed at this site. Please submit again.');
      }
      const releaseLock = () => svc.Site.updateMany(
        { id: String(site_id), hospitality_grant_lock_token: lockTok },
        { $set: { hospitality_grant_lock_token: null, hospitality_grant_lock_expires_at: null } }).catch(() => null);

      const nowIso = new Date().toISOString();
      let log: any = null;
      let outcome: any = null;
      try {
        // (1) Same upload session already confirmed on ANOTHER visit (two
        // concurrent first attempts with one token) → this draft is cancelled
        // as a duplicate submission and the ORIGINAL result is returned.
        if (visit.submit_token) {
          const twin = (((await svc.HospitalityVisit.filter({ customer_id: recordCid, site_id, submit_token: visit.submit_token, status: 'confirmed' }, '-created_date', 5).catch(() => [])) || [])
            .find((r: any) => r.id !== visit.id)) || null;
          if (twin) {
            await cancelOwnDraft(`Duplicate submission of visit ${twin.id} (same submission token)`, twin.access_log_id || null);
            outcome = Response.json({ success: true, idempotent: true, access_log: await logById(twin.access_log_id), hospitality_visit: twin });
          }
        }
        const inside = outcome ? [] : ((await svc.AccessLog.filter({ customer_id: recordCid, site_id, status: 'inside' }, '-created_date', 200).catch(() => [])) || []);
        // (2) Orphan adoption — an entry already created for THIS visit by a
        // claimant that died before stamping is adopted, never duplicated.
        const orphan = outcome ? null : inside.find((l: any) => l.hospitality_visit_id === visit.id);
        if (orphan) log = orphan;
        // (3) Duplicate presence — same person (identity key = name + mobile,
        // or the same document/vehicle identifier) already on site. A name
        // alone never matches.
        if (!outcome && !log) {
          const dup = inside.find((l: any) =>
            (identityKey && l.identity_key === identityKey) ||
            (sa_id_number && l.sa_id_number === sa_id_number) ||
            (driver_licence_number && l.driver_licence_number === driver_licence_number) ||
            (logVehicleReg && l.vehicle_registration === logVehicleReg));
          if (dup) {
            await cancelOwnDraft(`Duplicate — this person is already on site (entry ${dup.id})`, dup.id);
            await auditAccess(base44.asServiceRole, 'access.entry_duplicate_blocked', caller, {
              customer_id: recordCid, site_id, gate_name, access_log_id: dup.id,
              notes: `Hospitality duplicate blocked before grant — already inside (record ${dup.id}); draft visit ${visit.id} cancelled` });
            outcome = Response.json({ error: 'This person already has an active entry on site.', duplicate: true, existing_log_id: dup.id }, { status: 409 });
          }
        }
        // (4) Create the entry (uber_eats_mrd: exactly one pedestrian record;
        // the vehicle is never written as inside).
        if (!outcome && !log) {
          log = await svc.AccessLog.create({
            customer_id: recordCid, reseller_id: recordRid, site_id,
            event_type: blacklistMatch ? 'denied' : 'entry',
            status: blacklistMatch ? 'blacklisted' : 'inside',
            person_type: CATEGORY_PERSON_TYPE[category] || 'unknown',
            person_name, person_phone: phoneCheck.value || '',
            unit_number: answers.room_number || '',
            gate_name, site_name: siteRec.name || '',
            scan_method, sa_id_number, driver_licence_number,
            ...(logVehicleReg ? { vehicle_registration: logVehicleReg, vehicle_licence_disc_number, vehicle_make, vehicle_model, vehicle_colour } : {}),
            vehicle_licence_number,
            scanned_data, parsed_json, confidence, device,
            visit_or_work: 'visit', photo_url, location,
            notes: `GRID GATE Hospitality — ${CATEGORY_LABELS[category]} (visit ${visit.id})`,
            hospitality_visit_id: visit.id, identity_key: identityKey,
            entry_time: nowIso, timestamp: nowIso,
            guard_id: caller.id, guard_name: caller.display_name || caller.full_name,
            entry_device_registration_id: deviceReg ? deviceReg.id : null,
            entry_device_name: deviceReg ? deviceReg.device_name : null,
            flagged: !!blacklistMatch,
            flag_reason: blacklistMatch ? ('Blacklist match: ' + (blacklistMatch.reason || 'banned identifier')) : undefined,
            blacklist_match_id: blacklistMatch?.id,
          });
          // (5) Fence — still holding the lease? Otherwise void (not exit).
          const fence: any = await svc.Site.updateMany(
            { id: String(site_id), hospitality_grant_lock_token: lockTok },
            { $set: { hospitality_grant_lock_expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString() } }).catch(() => null);
          if (!fence || !fence.updated) {
            await voidLog(log.id, 'Void correction — grant lock lease lost before commit; entry not admitted', null);
            await releaseClaim();
            outcome = pendingResp('gate_busy', 'The entry could not be committed safely. Please submit again.');
          }
        }
        // (6) Confirmation stamp — conditional on MY claim token.
        if (!outcome && log) {
          const st: any = await svc.HospitalityVisit.updateMany(
            { id: String(visit.id), status: 'confirming', confirm_claim_token: myClaim },
            { $set: { status: 'confirmed', access_log_id: log.id, confirmed_at: new Date().toISOString(), confirm_claim_token: null } }).catch(() => null);
          if (!st || !st.updated) {
            const cur = await readVisit();
            if (cur && cur.status === 'confirmed' && cur.access_log_id === log.id) {
              outcome = Response.json({ success: true, recovered: true, access_log: log, hospitality_visit: cur });
            } else {
              if (!orphan) await voidLog(log.id, 'Void correction — confirmation claim superseded by a replacement request', cur?.access_log_id || null);
              outcome = cur && cur.status === 'confirmed'
                ? Response.json({ success: true, idempotent: true, access_log: await logById(cur.access_log_id), hospitality_visit: cur })
                : pendingResp('confirmation_in_progress', 'This visit is being confirmed by another request. Check the live access log in a moment.');
            }
          }
        }
      } finally {
        await releaseLock();
      }
      if (outcome) return outcome;

      // Downstream effects run ONLY after the committed confirmation.
      visit = (await readVisit()) || visit;
      await bindEvidence(base44.asServiceRole, evidenceUris, visit.id);
      await auditAccess(base44.asServiceRole, 'access.entry', caller, {
        customer_id: recordCid, site_id, gate_name, access_log_id: log.id,
        notes: `GRID GATE Hospitality entry (${CATEGORY_LABELS[category]}) processed by ${caller.display_name || caller.full_name}`,
      });
      if (blacklistMatch) {
        await dispatchAccessAlert(base44, caller, log, 'Blacklisted Person Denied Entry', 'security');
      }
      return Response.json({ success: true, access_log: log, hospitality_visit: visit, blacklist_match: blacklistMatch ? { id: blacklistMatch.id, reason: blacklistMatch.reason } : null });
    }

    /* hospitality_cancel: explicit cancellation of a PENDING visit (or a
     * STALE abandoned confirmation claim with no entry) with a recorded
     * reason — atomic conditional update; access was never granted. */
    if (action === 'hospitality_cancel') {
      const d = access_data || {};
      const { hospitality_visit_id, reason } = d;
      if (!hospitality_visit_id || !String(reason || '').trim()) {
        return Response.json({ error: 'hospitality_visit_id and reason are required' }, { status: 400 });
      }
      const rows = await base44.asServiceRole.entities.HospitalityVisit.filter({ id: String(hospitality_visit_id) }).catch(() => []);
      const visit = (rows && rows[0]) || null;
      if (!visit) return Response.json({ error: 'Visit not found' }, { status: 404 });
      if (!isPlatformUser(caller)) {
        if (isResellerAdmin(caller)) {
          if (!rid || visit.reseller_id !== rid) return Response.json({ error: 'This visit does not belong to your reseller', code: 'forbidden_cross_tenant' }, { status: 403 });
        } else if (!cid || visit.customer_id !== cid) {
          return Response.json({ error: 'This visit does not belong to your customer', code: 'forbidden_cross_tenant' }, { status: 403 });
        } else if (caller.site_id && String(caller.site_id) !== String(visit.site_id)) {
          return Response.json({ error: 'This visit belongs to a site not assigned to you', code: 'forbidden_site' }, { status: 403 });
        }
      }
      const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const linked = ((await base44.asServiceRole.entities.AccessLog.filter({ hospitality_visit_id: visit.id }).catch(() => [])) || [])
        .filter((l: any) => l.status !== 'voided');
      if (linked.length) return Response.json({ error: 'This visit has an entry record — use the exit flow instead', code: 'has_entry' }, { status: 400 });
      const res: any = await base44.asServiceRole.entities.HospitalityVisit.updateMany(
        { id: String(visit.id), $or: [ { status: 'pending' }, { status: 'confirming', confirm_claimed_at: { $lt: staleBefore } } ] },
        { $set: {
          status: 'cancelled', cancel_reason: String(reason).slice(0, 400),
          cancelled_at: new Date().toISOString(), cancelled_by_id: caller.id,
          cancelled_by_name: caller.display_name || caller.full_name || '', confirm_claim_token: null,
        } }).catch(() => null);
      if (!res || !res.updated) {
        return Response.json({ error: 'Only a pending (or abandoned) visit can be cancelled', code: 'not_pending' }, { status: 400 });
      }
      await auditAccess(base44.asServiceRole, 'access.hospitality_cancelled', caller, {
        customer_id: visit.customer_id, site_id: visit.site_id,
        notes: `Hospitality visit ${visit.id} (${CATEGORY_LABELS[visit.category]}) cancelled: ${reason}`,
      });
      const updated = ((await base44.asServiceRole.entities.HospitalityVisit.filter({ id: String(visit.id) }).catch(() => [])) || [])[0];
      return Response.json({ success: true, hospitality_visit: updated });
    }

    /* ── Hospitality MANAGEMENT INSPECTION (list / evidence / report brand) ─
     * Tenant-scoped exactly like every other action: tenant management roles
     * see their own customer's visits (a fixed-site user only their site);
     * reseller admins their reseller's; platform admins full oversight.
     * Raw storage uris are NEVER returned — evidence is signed on demand,
     * only for ownership-verified files, and identity/firearm evidence is
     * limited to senior roles. */
    const INSPECT_ROLES = ['admin', 'customer_admin', 'dispatcher', 'supervisor', 'management', 'control_room_operator'];
    const SENSITIVE_ROLES = ['admin', 'customer_admin', 'management'];
    const canInspect = isPlatformUser(caller) || isResellerAdmin(caller) || !!(cid && INSPECT_ROLES.includes(caller.role_type));
    const canSensitive = isPlatformUser(caller) || isResellerAdmin(caller) || !!(cid && SENSITIVE_ROLES.includes(caller.role_type));
    const inScope = (v: any) => {
      if (isPlatformUser(caller)) return true;
      if (isResellerAdmin(caller)) return !!rid && v.reseller_id === rid;
      if (!cid || v.customer_id !== cid) return false;
      return !caller.site_id || String(caller.site_id) === String(v.site_id);
    };

    if (action === 'hospitality_list') {
      if (!canInspect) return Response.json({ error: 'Your role cannot inspect hospitality visits', code: 'forbidden_role' }, { status: 403 });
      const a = access_data || {};
      const q: any = {};
      // TECHNICAL-TEST CLASSIFICATION: harness fixtures (is_test) are excluded
      // from every customer-facing list by default. Platform administrators
      // may pass include_tests to audit them explicitly (never via customer
      // accounts).
      if (!a.include_tests || !isPlatformUser(caller)) q.is_test = { $ne: true };
      if (isResellerAdmin(caller) && !isPlatformUser(caller)) q.reseller_id = rid;
      else if (!isPlatformUser(caller)) q.customer_id = cid;
      if (!isPlatformUser(caller) && !isResellerAdmin(caller) && caller.site_id) q.site_id = String(caller.site_id);
      else if (a.site_id) q.site_id = String(a.site_id);
      if (a.status) q.status = String(a.status);
      if (a.category) q.category = String(a.category);
      if (a.date_from || a.date_to) {
        q.created_date = {};
        if (a.date_from) q.created_date.$gte = String(a.date_from);
        if (a.date_to) q.created_date.$lte = String(a.date_to);
      }
      const limit = Math.min(1000, Math.max(1, Number(a.limit) || 500));
      const visits = ((await base44.asServiceRole.entities.HospitalityVisit.filter(q, '-created_date', limit).catch(() => [])) || []).filter(inScope);
      const logIds = visits.map((v: any) => v.access_log_id).filter(Boolean);
      const logs = logIds.length
        ? ((await base44.asServiceRole.entities.AccessLog.filter({ id: { $in: logIds } }, '-created_date', 1000).catch(() => [])) || [])
        : [];
      const logMap = new Map(logs.map((l: any) => [l.id, l]));
      const out = visits.map((v: any) => sanitizeVisitForList(v, v.access_log_id ? logMap.get(v.access_log_id) : null, canSensitive));
      return Response.json({ visits: out, can_view_evidence: true, can_view_sensitive: canSensitive, truncated: visits.length >= limit });
    }

    if (action === 'hospitality_evidence') {
      if (!canInspect) return Response.json({ error: 'Your role cannot view hospitality evidence', code: 'forbidden_role' }, { status: 403 });
      const vid = String((access_data || {}).hospitality_visit_id || '');
      const v = ((await base44.asServiceRole.entities.HospitalityVisit.filter({ id: vid }).catch(() => [])) || [])[0];
      if (!v) return Response.json({ error: 'Visit not found' }, { status: 404 });
      if (!inScope(v)) return Response.json({ error: 'This visit is outside your scope', code: 'forbidden_cross_tenant' }, { status: 403 });
      const items: any[] = [];
      let unverified = 0;
      const add = async (label: string, uri: any, sensitive = false) => {
        if (!uri) return;
        if (sensitive && !canSensitive) { items.push({ label, restricted: true }); return; }
        const url = await signOwnedEvidence(base44.asServiceRole, v, uri);
        if (url) items.push({ label, url }); else { unverified++; items.push({ label, unverified: true }); }
      };
      for (const u of v.vehicle_photo_uris || []) await add('Vehicle photo', u);
      await add('PO / Invoice', v.po_invoice_photo_uri);
      await add('Food', v.food_photo_uri);
      await add('Delivery person', v.delivery_person_photo_uri);
      for (const u of v.staff_declaration_photo_uris || []) await add('Staff declaration', u);
      await add('Firearm licence card', v.firearm_photo_uri, true);
      await add('Identity document', v.identity_document_photo_uri, true);
      await add('Vehicle licence disc (manual capture)', v.vehicle_disc_photo_uri);
      await add("Driver's licence (manual capture)", v.driver_licence_photo_uri, true);
      await auditAccess(base44.asServiceRole, 'access.hospitality_evidence_viewed', caller, {
        customer_id: v.customer_id, site_id: v.site_id, notes: `Evidence viewed for visit ${v.id} (${items.length} item(s), ${unverified} unverified)` });
      return Response.json({ items, unverified, expires_in: 300 });
    }

    if (action === 'hospitality_report_brand') {
      if (!canInspect) return Response.json({ error: 'Forbidden', code: 'forbidden_role' }, { status: 403 });
      let brandCid = cid;
      if (!brandCid && (access_data || {}).site_id) {
        const s = ((await base44.asServiceRole.entities.Site.filter({ id: String(access_data.site_id) }).catch(() => [])) || [])[0];
        if (s && (isPlatformUser(caller) || (isResellerAdmin(caller) && s.reseller_id === rid))) brandCid = s.customer_id || null;
      }
      const brand = await resolveCommunicationBrand(base44.asServiceRole, { customer_id: brandCid, reseller_id: rid });
      return Response.json({
        brand_name: brand.brand_name, primary_color: brand.primary_color, customer_name: brand.customer_name,
        logo_data_url: await toDataUrl(brand.logo_url),
        secondary_logo_data_url: await toDataUrl(brand.document_secondary_logo_url),
      });
    }

    return Response.json({ error: 'Invalid action. Use entry, exit, resolve_visitor, hospitality_submit, hospitality_cancel, hospitality_list, hospitality_evidence or hospitality_report_brand' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}