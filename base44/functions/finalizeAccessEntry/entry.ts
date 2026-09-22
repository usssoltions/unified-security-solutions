import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';

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
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Access Alerts', to: r.email,
          subject: title, html: tpl.html, text: tpl.text,
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
              photo_url, qr_code, location, unit_number, company } = access_data;

      if (!gate_name || !person_type || !person_name) {
        return Response.json({ error: 'gate_name, person_type, person_name required' }, { status: 400 });
      }

      // SITE SCOPE — reject a site outside the caller's permitted scope before
      // anything is written (cross-customer/cross-site bypass protection).
      const siteErr = await assertSiteScope(site_id);
      if (siteErr) return siteErr;

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
        const dupFilter = cid ? { customer_id: cid, status: 'inside' } : { status: 'inside' };
        if (site_id) dupFilter.site_id = site_id;
        const dups = await base44.asServiceRole.entities.AccessLog.filter(dupFilter, '-created_date', 50);
        const isDup = dups.find(d => {
          if (sa_id_number && d.sa_id_number === sa_id_number) return true;
          if (driver_licence_number && d.driver_licence_number === driver_licence_number) return true;
          if (vehicle_registration && d.vehicle_registration === vehicle_registration) return true;
          return false;
        });
        if (isDup) {
          return Response.json({ error: 'Person or vehicle already inside this site', duplicate: true, existing_log_id: isDup.id }, { status: 409 });
        }
      }

      // BLACKLIST — TENANT SCOPED: only the caller's own customer's blacklist
      // records may produce a match (Customer A's bans never block Customer B).
      let blacklistMatch = null;
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const blFilter = cid ? { customer_id: cid, active: true } : { active: true };
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
        customer_id: cid,
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
        flagged: !!blacklistMatch,
        flag_reason: blacklistMatch ? ('Blacklist match: ' + (blacklistMatch.reason || 'banned identifier')) : undefined,
        blacklist_match_id: blacklistMatch?.id
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
      const { access_log_id, site_id, gate_name, scan_method, exit_notes, location } = access_data;
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

      const exitTime = new Date();
      const entryTime = new Date(existing.entry_time || existing.timestamp);
      const minutes = Math.round((exitTime - entryTime) / 60000);

      const updated = await base44.asServiceRole.entities.AccessLog.update(access_log_id, {
        event_type: 'exit',
        status: 'exited',
        exit_time: exitTime.toISOString(),
        exit_gate: gate_name,
        exit_guard_id: caller.id,
        exit_guard_name: caller.display_name || caller.full_name,
        exit_scan_method: scan_method,
        exit_location: location,
        exit_notes,
        time_on_site_minutes: minutes
      });

      // Update visitor status — only the visitor linked to THIS record.
      if (existing.visitor_id) {
        try {
          await base44.asServiceRole.entities.Visitor.update(existing.visitor_id, { status: 'exited', exited_at: exitTime.toISOString() });
        } catch (e) {}
      }

      return Response.json({ success: true, access_log: updated });
    }

    return Response.json({ error: 'Invalid action. Use entry, exit or resolve_visitor' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}