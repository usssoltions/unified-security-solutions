import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * finalizeAccessEntry — Backend access control finalisation.
 *
 * Performs in one backend operation:
 *  - validation (required fields)
 *  - duplicate active AccessLog check (person already inside)
 *  - blacklist check
 *  - visitor update (phone, scanned fields)
 *  - AccessLog create (entry) or update (exit)
 *  - audit entry
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

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action, access_data } = await req.json();
    if (!action || !access_data) {
      return Response.json({ error: 'action and access_data required' }, { status: 400 });
    }

    const cid = caller.customer_id;
    const rid = caller.reseller_id;
    const now = new Date().toISOString();

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

      // COMPULSORY VISITOR MOBILE NUMBER — enforced centrally for every
      // entering person who is not a resident or guard. Rejects entry
      // completion with no number or an invalid one; normalises to E.164.
      const phoneCheck = validateVisitorPhone(person_phone);
      if (person_type !== 'resident' && person_type !== 'guard' && !phoneCheck.ok) {
        return Response.json({ error: phoneCheck.error }, { status: 400 });
      }
      const e164Phone = phoneCheck.ok ? phoneCheck.value : (person_phone || '');

      // Check for duplicate active entry (person already inside)
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const dupFilter = { site_id, status: 'inside' };
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

      // Blacklist check
      let blacklistMatch = null;
      if (sa_id_number || driver_licence_number || vehicle_registration) {
        const blEntries = await base44.asServiceRole.entities.BlacklistEntry.filter({ customer_id: cid, active: true }, '-created_date', 200);
        blacklistMatch = blEntries.find(b => {
          if (b.identifier_type === 'sa_id' && sa_id_number && b.identifier_value === sa_id_number.toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'driver_licence' && driver_licence_number && b.identifier_value === driver_licence_number.toUpperCase().replace(/\s/g, '')) return true;
          if (b.identifier_type === 'vehicle_registration' && vehicle_registration && b.identifier_value === vehicle_registration.toUpperCase().replace(/\s/g, '')) return true;
          return false;
        });
      }

      // Update visitor if exists
      if (visitor_id) {
        try {
          await base44.asServiceRole.entities.Visitor.update(visitor_id, {
            visitor_phone: e164Phone,
            entered_at: now,
            status: 'entered'
          });
        } catch (e) {}
      }

      // Create AccessLog
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
        blacklist_match_id: blacklistMatch?.id
      });

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

      // Update visitor status
      if (existing.visitor_id) {
        try {
          await base44.asServiceRole.entities.Visitor.update(existing.visitor_id, { status: 'exited', exited_at: exitTime.toISOString() });
        } catch (e) {}
      }

      return Response.json({ success: true, access_log: updated });
    }

    return Response.json({ error: 'Invalid action. Use entry or exit' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}