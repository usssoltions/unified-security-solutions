import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

/**
 * demoSeed — PLATFORM-ADMIN-ONLY gateway that seeds a realistic, fully
 * consistent DEMO dataset for one customer (default: Grid Protection /
 * Hyatt House Sandton — Demo), classifies existing technical-test records,
 * and supports batch-scoped idempotent reruns and reset.
 *
 * SAFETY RULES (enforced here, never in the client):
 *  - Platform administrators only (role 'admin' or admin_level 'platform').
 *  - NO user invites, NO emails, NO Telegram, NO push, NO external side
 *    effects of any kind. Seeded records carry pre-stamped notification
 *    markers so scheduled sweeps can never notify on them:
 *      Shifts          -> reminder_sent: true, ended_notified: true
 *      TaskBatches     -> status 'reported', report_generated_at stamped
 *      OperationalTasks-> last_reminder_at stamped on outstanding tasks
 *      OBOccurrences   -> due_notified_at / overdue_notified_at /
 *                         escalation_notified_at stamped (sweep stamps are
 *                         only written after a send; pre-stamped = skip)
 *      OBSchedules     -> status 'paused' (no generation, no reminders)
 *      Incidents       -> notification_sent: true, never priority 'critical'
 *  - Every created record carries demo_batch_id (+ visible '[SIMULATED'
 *    markers in notes/titles). Small-count entities without the schema field
 *    are tracked 1:1 in the DemoSeedRecord ledger.
 *  - Technical-test classification NEVER deletes anything (audit history is
 *    preserved) and never touches genuine operational records.
 *  - Reset deletes ONLY records carrying this batch's demo_batch_id (or its
 *    ledger rows) and restores the Site snapshot taken before seeding.
 *
 * Actions: status | seed (phases: setup, shifts, patrols, hospitality, ops,
 * incidents, comms, estate, finalize) | reset
 */

/* NO hardcoded default customer/site: every deployment is explicitly
   authorised against a target customer + site supplied by the platform
   administrator. All display names are resolved from the TARGET customer's
   site configuration — Grid Protection / Hyatt House Sandton details are
   never copied into another customer's demo. */
const GATE = 'Main Gate';
const DEMO_MARKER = 'SIMULATED demo record';

/* ── deterministic PRNG (mulberry32) ── */
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const FIRST = ['Sipho','Thabo','Ayanda','Johan','Precious','Bongani','Lerato','Andile','Kobus','Nomsa','Shaun','Zanele','Michael','Sarah','David','Naledi','Pieter','Refilwe','Kagiso','Tumi','Anna','Sibusiso','Chantelle','Vusi','Megan','Sello','Yolanda','Themba','Karabo','Riaan','Fatima','Dineo','Mandla','Elmarie','Given','Nomvula','Dumisani','Lindiwe','Frans','Palesa','Sizwe','Marlene','Sphamandlo','Rethabile','Wikus','Zama','Gugu','Derrick','Buhle','Jaco','Tshepo','Ilse','Musa','Ronel','Fikile','Werner','Asanda','Derek','Annah','Dawid'];
const LAST = ['Ndlovu','Mokoena','Dlamini','van Wyk','Khumalo','Zulu','Molefe','Mahlangu','Pretorius','Buthelezi','Petersen','Nkosi','Botha','Naidoo','Sithole','Mbeki','Kruger','Sibiya','Coetzee','Mabaso','Jacobs','Mahlong','Fourie','Ngubane','Steyn','Cele','Pillay','Motaung','van Tonder','Khoza','Le Roux','Maluleke','Du Plessis','Ngcobo','Mthembu','Swart','Nyembe','Erasmus','Maseko','Barnard'];
const INTL_FIRST = ['James','Emily','Daniel','Olivia','Liam','Sofia','Lucas','Chloe','Ethan','Maya','Noah','Ivy','Ryan','Zara','Owen','Nora','Cole','Ruby','Andre','Leah'];
const INTL_LAST = ['Smith','Johnson','Brown','Taylor','Wilson','Martin','Clarke','Walker','Hall','Young','King','Wright','Scott','Green','Baker','Adams','Nelson','Hill','Moore','Baker'];
const MAKES = [['Toyota','Corolla','White'],['Toyota','Hilux','Silver'],['Volkswagen','Polo','Blue'],['Ford','Ranger','Grey'],['Mercedes-Benz','C180','Black'],['BMW','320i','Blue'],['Hyundai','i20','Red'],['Kia','Seltos','White'],['Nissan','NP200','Silver'],['Haval','Jolion','Grey']];
const MAKES_MODELS = MAKES.map(([, m]) => m);
const COMPANIES = ['Sandton Facility Services','Gauteng Electrical Repairs','FreshFlow Catering','BlueTile Plumbing','SecureNet Systems','ProClean Hygiene','Summit Events Co','Hotel Interiors Design','GreenScape Gardens','AeroFire Compliance'];
const CATEGORIES = ['check_in','guest','visitor','contractor','delivery','uber_eats_mrd','uber','event_visitor','service_provider','staff'];
// Weights per 10 visits/day (sums 10)
const CATEGORY_PLAN = ['check_in','check_in','guest','guest','visitor','contractor','delivery','uber_eats_mrd','event_visitor','service_provider'];
const PERSON_TYPE = { check_in: 'visitor', guest: 'visitor', visitor: 'visitor', event_visitor: 'visitor', staff: 'visitor', contractor: 'contractor', service_provider: 'contractor', delivery: 'vendor', uber: 'vendor', uber_eats_mrd: 'vendor' };
const PARTY = { check_in: 'reception', contractor: 'relevant_department', delivery: 'relevant_department', service_provider: 'relevant_department', uber_eats_mrd: 'reception', uber: 'reception' };

const ROOMS = ['101','102','104','108','112','118','201','205','210','214','221','228','305','312','318','401','406','415','422','505','512','PH1','PH2'];
const WORK_TYPES = { contractor: 'work', delivery: 'visit', uber: 'visit', uber_eats_mrd: 'visit', service_provider: 'work', staff: 'none', check_in: 'visit', guest: 'visit', visitor: 'visit', event_visitor: 'visit' };
const SCAN_METHODS = ['qr_code','drivers_licence','vehicle_disc','manual','sa_id'];

const CHECKPOINTS = [
  { id: 'demo-ck-01', name: 'Main Gate', zone: 'Perimeter', risk_level: 'high', required: true, lat: -26.1077, lng: 28.0567 },
  { id: 'demo-ck-02', name: 'Lobby & Reception', zone: 'Public', risk_level: 'medium', required: true, lat: -26.1079, lng: 28.0571 },
  { id: 'demo-ck-03', name: 'Room Corridors A–F', zone: 'Rooms', risk_level: 'medium', required: true, lat: -26.1081, lng: 28.0574 },
  { id: 'demo-ck-04', name: 'Parking Basement P1', zone: 'Parking', risk_level: 'high', required: true, lat: -26.1083, lng: 28.0569 },
  { id: 'demo-ck-05', name: 'Pool Deck & Gym', zone: 'Leisure', risk_level: 'low', required: true, lat: -26.1075, lng: 28.0573 },
  { id: 'demo-ck-06', name: 'Back-of-House & Plant Room', zone: 'Service', risk_level: 'critical', required: true, lat: -26.1080, lng: 28.0577 },
];

const ROSTER = [
  ['demo-g01','Sipho Ndlovu','DP-1001'], ['demo-g02','Thabo Mokoena','DP-1002'],
  ['demo-g03','Ayanda Dlamini','DP-1003'], ['demo-g04','Johan van Wyk','DP-1004'],
  ['demo-g05','Precious Khumalo','DP-1005'], ['demo-g06','Bongani Zulu','DP-1006'],
  ['demo-g07','Lerato Molefe','DP-1007'], ['demo-g08','Andile Mahlangu','DP-1008'],
  ['demo-g09','Kobus Pretorius','DP-1009'], ['demo-g10','Nomsa Buthelezi','DP-1010'],
  ['demo-g11','Shaun Petersen','DP-1011'], ['demo-g12','Zanele Nkosi','DP-1012'],
];

const INC_TITLES = [
  ['Suspicious person loitering at Main Gate','suspicious_activity','medium'],
  ['Guest slipped on wet pool deck tiles','medical','medium'],
  ['Attempted gate forcing after midnight','trespassing','high'],
  ['Fire panel fault — Zone 4 activation','fire','high'],
  ['Vehicle mirror clipped in parking basement','vandalism','low'],
  ['Intoxicated guest refusing to leave lobby','other','medium'],
  ['Unsecured back-of-house service door found open','safety_hazard','medium'],
  ['Bag left unattended at reception','suspicious_activity','medium'],
  ['Theft of linen trolley from service corridor','theft','medium'],
  ['CCTV camera obstructed by signage','equipment_failure','low'],
];
const MAINT_TITLES = [
  ['Lobby entrance sliding door sticking','structural','Gate','medium'],
  ['Corridor A light fittings flickering','electrical','Rooms','low'],
  ['Parking P1 boom gate sensor misaligned','gate','Parking','high'],
  ['Back-of-house door closer faulty','locks','Service','medium'],
  ['Pool deck railing bolt loose','structural','Leisure','high'],
  ['Fire exit sign not illuminated','lighting','Rooms','medium'],
  ['CCTV camera 12 offline','camera','Perimeter','high'],
  ['Guest bathroom basin leaking','plumbing','Rooms','medium'],
  ['Electric fence alarm intermittent','alarm_system','Perimeter','medium'],
  ['Gym door access reader unresponsive','locks','Leisure','low'],
];

/* ── SAST helpers (fixed +02:00) ── */
function saUTC(y, m, d, hh, mm) { return new Date(Date.UTC(y, m, d, hh - 2, mm, 0, 0)); }
function iso(dt) { return dt.toISOString(); }
function dayList(now, back, fwd) {
  const days = [];
  for (let i = back; i >= -fwd; i--) {
    const t = new Date(now.getTime() - i * 86400000);
    const y = t.getUTCFullYear(), m = t.getUTCMonth(), d = t.getUTCDate();
    // operating SAST calendar date = UTC date + 2h — use the SAST date of 'now'
    days.push({ y, m, d, offsetDays: i });
  }
  return days;
}
function saNowParts(now) {
  const s = new Date(now.getTime() + 2 * 3600000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), hh: s.getUTCHours(), mm: s.getUTCMinutes() };
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

function pickName(rnd, poolF, poolL) { return `${poolF[Math.floor(rnd() * poolF.length)]} ${poolL[Math.floor(rnd() * poolL.length)]}`; }
function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

/* ═══════════ GENERATORS ═══════════ */

function buildShifts(rnd, batch, cid, rid, site, now) {
  const rows = [];
  const days = dayList(now, 59, 7);
  let gi = 0;
  for (const day of days) {
    const future = day.offsetDays < 0;
    const dayIdx = (day.d + day.m * 37) % ROSTER.length;
    const slots = [
      { g: ROSTER[dayIdx % ROSTER.length], s: 6, e: 18, label: 'Day' },
      { g: ROSTER[(dayIdx + 3) % ROSTER.length], s: 18, e: 6, label: 'Night' },
    ];
    if (day.d % 2 === 0) slots.push({ g: ROSTER[(dayIdx + 7) % ROSTER.length], s: 10, e: 22, label: 'Swing' });
    for (const slot of slots) {
      const start = saUTC(day.y, day.m, day.d, slot.s, 0);
      const endDT = new Date(start.getTime() + 12 * 3600000);
      const [gid, gname, badge] = slot.g;
      gi++;
      const row = {
        demo_batch_id: batch, customer_id: cid, reseller_id: rid,
        guard_id: gid, guard_name: gname, site_id: site.id, site_name: site.name,
        start_time: iso(start), end_time: iso(endDT), is_test: false,
        reminder_sent: true, ended_notified: true,
        ended_notified_at: future ? null : iso(new Date(endDT.getTime() + 5 * 60000)),
        notes: `[${DEMO_MARKER}] ${slot.label} shift — ${site.hospitality_display_name || site.name}`,
      };
      if (!future) {
        const missed = rnd() < 0.05 && slot.label !== 'Day';
        if (missed) {
          row.status = 'missed';
        } else {
          row.status = 'completed';
          const cin = new Date(start.getTime() + Math.floor(rnd() * 9 - 4) * 60000);
          row.clock_in = { timestamp: iso(cin), location: { lat: -26.1077 + rnd() * 0.0006, lng: 28.0567 + rnd() * 0.0006 }, verified: true };
          const cout = new Date(endDT.getTime() + Math.floor(rnd() * 15) * 60000);
          row.clock_out = { timestamp: iso(cout), location: { lat: -26.1077 + rnd() * 0.0006, lng: 28.0567 + rnd() * 0.0006 }, verified: true };
        }
      } else {
        row.status = 'scheduled';
        row.guard_ack_status = rnd() < 0.6 ? 'accepted' : undefined;
        if (row.guard_ack_status === 'accepted') row.guard_ack_at = iso(new Date(now.getTime() - Math.floor(rnd() * 20 + 4) * 3600000));
      }
      rows.push(row);
    }
  }
  return rows;
}

function buildPatrols(rnd, batch, cid, rid, site, shifts, now) {
  const patrols = [], logs = [];
  const shiftsByStart = new Map(shifts.filter(s => s.status === 'completed').map(s => [s.start_time, s]));
  const days = dayList(now, 55, 2);
  let num = 0;
  for (const day of days) {
    const future = day.offsetDays < 0;
    for (const route of ['A', 'B']) {
      num++;
      const startH = route === 'A' ? 9 : 21;
      const start = saUTC(day.y, day.m, day.d, startH, Math.floor(rnd() * 3) * 10);
      const ckps = route === 'A' ? [CHECKPOINTS[1], CHECKPOINTS[2], CHECKPOINTS[5]] : [CHECKPOINTS[3], CHECKPOINTS[0], CHECKPOINTS[6 - 3 + 0]];
      const useCkps = route === 'A' ? [CHECKPOINTS[1], CHECKPOINTS[2], CHECKPOINTS[5]] : [CHECKPOINTS[3], CHECKPOINTS[0], CHECKPOINTS[5]];
      // find a completed shift overlapping this patrol
      let guard = null, shiftRow = null;
      for (const s of shifts.filter(s => s.status === 'completed')) {
        const st = Date.parse(s.start_time), en = Date.parse(s.end_time);
        if (st <= start.getTime() && start.getTime() <= en) { guard = { id: s.guard_id, name: s.guard_name }; shiftRow = s; break; }
      }
      if (!guard) { const r = ROSTER[num % ROSTER.length]; guard = { id: r[0], name: r[1] }; }
      const missed = !future && rnd() < 0.05;
      const upcoming = future;
      const end = new Date(start.getTime() + 35 * 60000);
      const routeArr = useCkps.map((c, i) => ({
        checkpoint_id: c.id, checkpoint_name: c.name, order: i + 1, risk_level: c.risk_level, required: true,
        completed: missed ? (rnd() < 0.3) : !upcoming,
        completed_at: (missed || upcoming) ? null : iso(new Date(start.getTime() + (8 + i * 11) * 60000)),
        scan_log_id: (missed || upcoming) ? null : `${batch}-scan-${num}-${i}`,
        gps_verified: (missed || upcoming) ? null : true,
        gps_status: (missed || upcoming) ? null : 'verified',
        distance_metres: (missed || upcoming) ? null : Math.round(6 + rnd() * 34),
      }));
      const row = {
        demo_batch_id: batch, customer_id: cid, reseller_id: rid,
        site_id: site.id, site_name: site.name,
        guard_id: guard.id, guard_name: guard.name,
        shift_id: shiftRow ? shiftRow.start_time + '|' + guard.id : `${batch}-shiftref-${num}`,
        scheduled_start: iso(start), scheduled_end: iso(end),
        actual_start: (missed || upcoming) ? null : iso(new Date(start.getTime() + Math.floor(rnd() * 10) * 60000)),
        actual_end: (missed || upcoming) ? null : iso(new Date(end.getTime() + Math.floor(rnd() * 8) * 60000)),
        status: upcoming ? 'upcoming' : missed ? 'missed' : 'completed',
        patrol_number: num,
        route_checkpoints: routeArr,
        checkpoints_completed: routeArr.filter(c => c.completed).length,
        checkpoints_total: routeArr.length,
        distance_metres: (missed || upcoming) ? 0 : Math.round(420 + rnd() * 380),
        duration_minutes: (missed || upcoming) ? null : 33 + Math.floor(rnd() * 12),
        ai_route_generated: true, alerts_sent: missed ? ['demo_notification_suppressed'] : [],
        escalated: missed, linked_incidents: [], offline_synced: false,
        notes: `[${DEMO_MARKER}] Route ${route === 'A' ? 'Lobby & Rooms' : 'Perimeter & Parking'}`,
        completion_score: missed ? null : 100,
      };
      patrols.push(row);
      if (!missed && !upcoming) {
        useCkps.forEach((c, i) => {
          const t = new Date(start.getTime() + (8 + i * 11) * 60000);
          logs.push({
            demo_batch_id: batch, customer_id: cid, reseller_id: rid,
            guard_id: guard.id, guard_name: guard.name, shift_id: row.shift_id,
            site_id: site.id, checkpoint_id: c.id, checkpoint_name: c.name,
            qr_code: `USS-DEMO-${c.id.replace('demo-ck-0', 'CK')}`,
            location: { lat: c.lat + (rnd() - 0.5) * 0.0002, lng: c.lng + (rnd() - 0.5) * 0.0002 },
            checkpoint_location: { lat: c.lat, lng: c.lng },
            distance_metres: row.route_checkpoints[i].distance_metres,
            gps_status: 'verified', timestamp: iso(t), verified: true,
            notes: `[${DEMO_MARKER}] Checkpoint scan`,
          });
        });
      }
    }
  }
  return { patrols, logs };
}

function buildHospitality(rnd, batch, cid, rid, site, shifts, now) {
  const visits = [], logs = [];
  const days = dayList(now, 59, 0);
  let phoneSeq = 1, vehSeq = 1, refSeq = 0;
  const usedToday = [];
  for (const day of days) {
    const future = day.offsetDays < 0;
    const count = future ? 0 : 8 + Math.floor(rnd() * 5); // 8–12/day
    for (let i = 0; i < count; i++) {
      refSeq++;
      const category = CATEGORY_PLAN[(refSeq + Math.floor(rnd() * 3)) % CATEGORY_PLAN.length];
      const hour = category === 'uber_eats_mrd' || category === 'uber' || category === 'delivery'
        ? 10 + Math.floor(rnd() * 10)
        : 7 + Math.floor(rnd() * 13);
      const minute = Math.floor(rnd() * 60);
      const entryT = saUTC(day.y, day.m, day.d, hour, minute);
      const local = rnd();
      let status = 'confirmed';
      if (local < 0.06 && day.offsetDays <= 0) status = 'confirmed'; // still inside handled below
      // offsetDays counts BACKWARD from today (59 = oldest) — recent days are
      // offsets <= 1. Cancelled drafts spread across history; pending drafts
      // only on the two most recent days.
      const cancelled = rnd() < 0.055 && day.offsetDays >= 2;
      const pending = !cancelled && day.offsetDays <= 1 && rnd() < 0.08;
      const pedestrianOnly = category === 'uber' || category === 'uber_eats_mrd';
      const isLocal = rnd() < 0.6;
      const name = isLocal ? pickName(rnd, FIRST, LAST) : pickName(rnd, INTL_FIRST, INTL_LAST);
      const phone = `+2782${String(10000000 + phoneSeq++).slice(1)}`; // sequential fictional E.164
      const norm = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
      const identity_key = `${norm}|${phone}`;
      const room = pick(rnd, ROOMS);
      const roomSource = category === 'visitor' ? (rnd() < 0.6 ? 'provided' : 'confirmed_by_reception') : (category === 'check_in' || category === 'guest' || category === 'staff' || category === 'event_visitor' ? 'confirmed_by_reception' : 'confirmed_by_reception');
      const confirmedReception = roomSource === 'confirmed_by_reception';
      const party = PARTY[category] || 'reception';
      const withVehicle = !pedestrianOnly && (category === 'guest' || category === 'check_in' || category === 'visitor' || category === 'contractor' || category === 'service_provider' || category === 'delivery') && rnd() < 0.75;
      const make = MAKES[vehSeq % MAKES.length]; vehSeq++;
      const vehicle = withVehicle ? {
        vehicle_registration: `CA ${100 + (vehSeq % 800)}-${String(100 + (vehSeq % 890))}`,
        vehicle_licence_disc_number: `VD-${batch.slice(5)}-${String(vehSeq).padStart(4, '0')}`,
        vehicle_make: make[0], vehicle_model: make[1], vehicle_colour: make[2],
      } : null;
      const stayMin = pedestrianOnly ? 2 + Math.floor(rnd() * 6) : category === 'contractor' || category === 'service_provider' ? 90 + Math.floor(rnd() * 240) : 15 + Math.floor(rnd() * 180);
      const exitT = new Date(entryT.getTime() + stayMin * 60000);
      const guard = ROSTER[Math.floor(rnd() * ROSTER.length)];
      const shift = shifts.find(s => s.guard_id === guard[0] && Math.abs(Date.parse(s.start_time) - entryT.getTime()) < 13 * 3600000 && s.status === 'completed');
      const visit = {
        demo_batch_id: batch, customer_id: cid, reseller_id: rid,
        site_id: site.id, site_name: site.name,
        category, workflow_id: 'grid_gate_hospitality', workflow_version: 1,
        status: cancelled ? 'cancelled' : pending ? 'pending' : 'confirmed',
        submit_token: null, access_log_id: null, identity_key,
        confirmation_party: pending || cancelled ? null : party,
        person_name: name, person_phone: phone,
        reception_confirmed: pending || cancelled ? null : (confirmedReception ? true : (category === 'visitor' ? null : true)),
        reception_confirmed_note: confirmedReception && !pending && !cancelled ? `[SIMULATED] ${party === 'reception' ? 'Reception' : 'Relevant department'} confirmed` : null,
        occupant_count: 1,
        room_number: ['check_in', 'guest', 'visitor', 'staff', 'uber', 'uber_eats_mrd', 'delivery'].includes(category) ? room : null,
        room_number_source: ['check_in', 'guest', 'visitor', 'staff', 'event_visitor'].includes(category) ? roomSource : null,
        firearm_declared: false, po_invoice_available: category === 'contractor' ? rnd() < 0.5 : null,
        vehicle_photo_uris: [], staff_declared: null, staff_declaration_photo_uris: [],
        pedestrian_only: pedestrianOnly,
        ...(vehicle ? { ...vehicle, vehicle_disc_capture_method: null, vehicle_disc_payload_sha256: null, vehicle_disc_photo_uri: null } : {}),
        driver_licence_number: withVehicle ? `DL-${batch.slice(5)}-${String(refSeq).padStart(4, '0')}` : null,
        driver_licence_capture_method: withVehicle ? null : null,
        driver_licence_payload_sha256: null, driver_licence_photo_uri: null,
        licence_holder_name: withVehicle ? name : null,
        scan_method: null, identity_document_type: null, identity_document_photo_uri: null, identity_document_number: null,
        cancelled_at: cancelled ? iso(new Date(entryT.getTime() + 4 * 60000)) : null,
        cancelled_by_id: cancelled ? 'demo-g01' : null, cancelled_by_name: cancelled ? 'Sipho Ndlovu' : null,
        confirmed_at: pending || cancelled ? null : iso(entryT),
        created_by_guard_id: guard[0], created_by_guard_name: guard[1],
        is_test: false,
      };
      if (cancelled) { visit.cancel_reason = 'Visitor declined entry / not confirmed by contact'; }
      if (pending) { /* recent pending draft */ }
      // AccessLog for confirmed visits
      if (!cancelled && !pending) {
        const insideNow = day.offsetDays === 0 && rnd() < 0.5;
        const exited = !insideNow;
        const g = shift || { guard_id: guard[0], guard_name: guard[1] };
        const log = {
          demo_batch_id: batch, customer_id: cid, reseller_id: rid,
          site_id: site.id, site_name: site.name,
          event_type: 'entry', status: exited ? 'exited' : 'inside',
          person_type: PERSON_TYPE[category] || 'visitor',
          person_name: name, person_phone: phone,
          unit_number: room, gate_name: GATE,
          scan_method: pedestrianOnly ? 'manual' : (withVehicle ? pick(rnd, SCAN_METHODS) : 'drivers_licence'),
          destination: `Room ${room}`,
          visit_or_work: WORK_TYPES[category] === 'work' ? 'work' : 'visit',
          work_type: WORK_TYPES[category] === 'work' ? pick(rnd, ['Maintenance','Electrical','Catering setup','Compliance inspection']) : 'none',
          company: category === 'contractor' || category === 'service_provider' ? pick(rnd, COMPANIES) : (category === 'delivery' ? pick(rnd, ['Sandton Courier','FreshFlow Catering']) : null),
          visitor_type: category, timestamp: iso(entryT),
          entry_time: iso(entryT), exit_time: exited ? iso(exitT) : null,
          time_on_site_minutes: exited ? stayMin : null,
          guard_id: g.guard_id || g[0], guard_name: g.guard_name || g[1],
          entry_device_name: 'Demo — Gate 1 Tablet',
          exit_gate: exited ? GATE : null,
          exit_guard_id: exited ? 'demo-g06' : null, exit_guard_name: exited ? 'Bongani Zulu' : null,
          exit_device_name: exited ? 'Demo — Gate 1 Tablet' : null,
          exit_scan_method: exited ? (pedestrianOnly ? 'manual' : 'qr_code') : null,
          exit_notes: exited ? `[${DEMO_MARKER}] Exit processed` : null,
          notes: `[${DEMO_MARKER}] ${category === 'check_in' ? 'Hotel check-in' : category.replace(/_/g, ' ')} — ${site.hospitality_display_name || site.name}`,
          hospitality_visit_id: null, identity_key, flagged: false,
        };
        if (!pedestrianOnly && vehicle) { log.vehicle_registration = vehicle.vehicle_registration; log.vehicle_licence_disc_number = vehicle.vehicle_licence_disc_number; log.vehicle_make = vehicle.vehicle_make; log.vehicle_model = vehicle.vehicle_model; log.vehicle_colour = vehicle.vehicle_colour; }
        if (pedestrianOnly && vehicle) { /* vehicle stays outside — never written to the AccessLog */ }
        logs.push(log);
        visit._logRef = log;
      }
      visits.push(visit);
    }
  }
  return { visits, logs };
}

function buildOps(rnd, batch, cid, rid, site, controlRoomId, now) {
  const schedules = [], obs = [], tasks = [], batches = [];
  const startD = new Date(now.getTime() - 60 * 86400000);
  const sd = `${startD.getUTCFullYear()}-${String(startD.getUTCMonth() + 1).padStart(2, '0')}-${String(startD.getUTCDate()).padStart(2, '0')}`;
  const todayParts = saNowParts(now);
  const dateStr = (dOff) => { const t = new Date(now.getTime() - dOff * 86400000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };
  const CRN = 'Hyatt House Sandton Control Room';
  schedules.push({
    demo_batch_id: batch, customer_id: cid, reseller_id: rid,
    title: 'Lobby & entrance evening check', instructions: `[SIMULATED DEMO] Walk the lobby and entrance, confirm doors secured, note anything unusual in the OB entry.`,
    category: 'Security', scope: 'site', site_id: site.id, site_name: site.name,
    control_room_id: controlRoomId, control_room_name: CRN,
    cadence: 'interval', every_n_minutes: 120, specified_times: [], active_days: [0,1,2,3,4,5,6],
    start_date: dateStr(60), end_date: null, window_start: '17:00', window_end: '23:00',
    window_end_inclusive: true, overdue_grace_minutes: 15, escalation_delay_minutes: 30,
    evidence_required: false, status: 'paused', paused_at: iso(new Date(now.getTime() - 3 * 86400000)),
    change_history: [{ timestamp: iso(new Date(now.getTime() - 60 * 86400000)), actor_id: 'demo-admin', actor_name: 'Demo Administrator', action: 'created', notes: `[${DEMO_MARKER}] Seeded schedule` }, { timestamp: iso(new Date(now.getTime() - 3 * 86400000)), actor_id: 'demo-admin', actor_name: 'Demo Administrator', action: 'paused', notes: 'Demo pause' }],
    created_by_id: 'demo-admin', created_by_name: 'Demo Administrator', is_test: false,
  });
  schedules.push({
    demo_batch_id: batch, customer_id: cid, reseller_id: rid,
    title: 'Perimeter overnight check', instructions: `[SIMULATED DEMO] Patrol perimeter and parking levels, confirm fence and boom gate status, record the result.`,
    category: 'Security', scope: 'site', site_id: site.id, site_name: site.name,
    control_room_id: controlRoomId, control_room_name: CRN,
    cadence: 'times', every_n_minutes: null, specified_times: ['22:00','02:00','04:00'], active_days: [0,1,2,3,4,5,6],
    start_date: dateStr(60), end_date: null, window_start: '20:00', window_end: '04:00',
    window_end_inclusive: true, overdue_grace_minutes: 15, escalation_delay_minutes: 30,
    evidence_required: false, status: 'paused', paused_at: iso(new Date(now.getTime() - 2 * 86400000)),
    change_history: [{ timestamp: iso(new Date(now.getTime() - 60 * 86400000)), actor_id: 'demo-admin', actor_name: 'Demo Administrator', action: 'created', notes: `[${DEMO_MARKER}] Seeded schedule` }, { timestamp: iso(new Date(now.getTime() - 2 * 86400000)), actor_id: 'demo-admin', actor_name: 'Demo Administrator', action: 'paused', notes: 'Demo pause' }],
    created_by_id: 'demo-admin', created_by_name: 'Demo Administrator', is_test: false,
  });
  // OB occurrences — 50
  const OUTCOMES = ['all_in_order','all_in_order','all_in_order','all_in_order','issue_noted','action_taken','other'];
  let obNum = 0;
  for (let d = 59; d >= 0; d -= 1) {
    const times = ['18:00','20:00','22:00','00:00'];
    for (const t of times) {
      obNum++;
      if (obNum > 40) break; // 40 completed history checks; pending/overdue/cancelled examples added below
      const [hh, mm] = t.split(':').map(Number);
      const due = saUTC(new Date(now.getTime() - d * 86400000).getUTCFullYear(), new Date(now.getTime() - d * 86400000).getUTCMonth(), new Date(now.getTime() - d * 86400000).getUTCDate(), hh, mm);
      const completed = obNum <= 40;
      const sch = schedules[obNum % 2];
      const op = obNum % 2 === 0 ? ['demo-op1', 'R. Naidoo (Demo)'] : ['demo-op2', 'T. Banda (Demo)'];
      const late = rnd() < 0.12;
      const row = {
        demo_batch_id: batch, customer_id: cid, reseller_id: rid,
        ob_reference: `OB-DEMO-${batch.slice(5)}-${String(obNum).padStart(4, '0')}`,
        schedule_id: null, schedule_index: schedules.indexOf(sch) >= 0 ? schedules.indexOf(sch) : 0, occurrence_key: `${batch}:ob:${dateStr(d)}:${t}`,
        source: 'scheduled', scope: 'site', control_room_id: controlRoomId, control_room_name: CRN,
        site_id: site.id, site_name: site.name,
        title: sch ? sch.title : 'Perimeter overnight check',
        category: 'Security', instructions: sch ? sch.instructions : '[SIMULATED DEMO]',
        outcome: completed ? (late ? 'issue_noted' : 'all_in_order') : null,
        notes: completed ? (late ? `[${DEMO_MARKER}] Minor observation — door held ajar, addressed.` : `[${DEMO_MARKER}] All in order.`) : null,
        operating_date: dateStr(d), slot_label: t === '00:00' ? '00:00 (+1d)' : t,
        due_at: iso(due), evidence_required: false,
        status: completed ? 'completed' : 'pending',
        submitted_at: completed ? iso(new Date(due.getTime() + (late ? 38 : 3) * 60000)) : null,
        operator_id: completed ? op[0] : null, operator_name: completed ? op[1] : null,
        original_entry: completed ? { title: sch ? sch.title : '', category: 'Security', outcome: late ? 'issue_noted' : 'all_in_order', notes: late ? `[${DEMO_MARKER}] Minor observation — door held ajar, addressed.` : `[${DEMO_MARKER}] All in order.` } : null,
        amendments: [],
        due_notified_at: iso(due), overdue_notified_at: null, escalation_notified_at: null,
        is_test: false,
      };
      obs.push(row);
    }
  }
  // 5 pending upcoming (notification-suppressed), 3 overdue outstanding (escalation suppressed), 2 cancelled
  for (let i = 0; i < 5; i++) {
    const dOff = -(1 + Math.floor(i / 2));
    const t = ['20:00','22:00','18:00','02:00','04:00'][i];
    const [hh, mm] = t.split(':').map(Number);
    const due = saUTC(new Date(now.getTime() - dOff * 86400000).getUTCFullYear(), new Date(now.getTime() - dOff * 86400000).getUTCMonth(), new Date(now.getTime() - dOff * 86400000).getUTCDate(), hh, mm);
    obs.push({
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      ob_reference: `OB-DEMO-${batch.slice(5)}-P${String(i + 1).padStart(3, '0')}`,
      schedule_id: null, schedule_index: i % 2, occurrence_key: `${batch}:ob:pending:${i}`,
      source: 'scheduled', scope: 'site', control_room_id: controlRoomId, control_room_name: CRN,
      site_id: site.id, site_name: site.name, title: schedules[i % 2].title, category: 'Security',
      instructions: schedules[i % 2].instructions, outcome: null, notes: null,
      operating_date: dateStr(dOff), slot_label: t === '00:00' || t === '02:00' || t === '04:00' ? `${t} (+1d)` : t,
      due_at: iso(due), evidence_required: false, status: 'pending',
      submitted_at: null, operator_id: null, operator_name: null, original_entry: null, amendments: [],
      due_notified_at: iso(new Date(now.getTime() - 3600000)), overdue_notified_at: null, escalation_notified_at: null,
      is_test: false,
    });
  }
  for (let i = 0; i < 3; i++) {
    const due = new Date(now.getTime() - (20 + i * 6) * 3600000);
    obs.push({
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      ob_reference: `OB-DEMO-${batch.slice(5)}-O${String(i + 1).padStart(3, '0')}`,
      schedule_id: null, schedule_index: i % 2, occurrence_key: `${batch}:ob:overdue:${i}`,
      source: 'scheduled', scope: 'site', control_room_id: controlRoomId, control_room_name: CRN,
      site_id: site.id, site_name: site.name, title: schedules[i % 2].title, category: 'Security',
      instructions: schedules[i % 2].instructions, outcome: null, notes: null,
      operating_date: dateStr(1), slot_label: '22:00 (+1d)',
      due_at: iso(due), evidence_required: false, status: 'pending',
      overdue_at: iso(new Date(due.getTime() + 15 * 60000)),
      submitted_at: null, operator_id: null, operator_name: null, original_entry: null, amendments: [],
      due_notified_at: iso(new Date(due.getTime() - 600000)),
      overdue_notified_at: iso(new Date(due.getTime() + 16 * 60000)),
      escalation_notified_at: iso(new Date(due.getTime() + 46 * 60000)),
      is_test: false,
    });
  }
  for (let i = 0; i < 2; i++) {
    const due = new Date(now.getTime() - (30 + i * 10) * 3600000);
    obs.push({
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      ob_reference: `OB-DEMO-${batch.slice(5)}-C${String(i + 1).padStart(3, '0')}`,
      schedule_id: null, schedule_index: i, occurrence_key: `${batch}:ob:cancelled:${i}`,
      source: 'scheduled', scope: 'site', control_room_id: controlRoomId, control_room_name: CRN,
      site_id: site.id, site_name: site.name, title: schedules[i].title, category: 'Security',
      instructions: schedules[i].instructions, outcome: null,
      operating_date: dateStr(2), slot_label: '18:00', due_at: iso(due), evidence_required: false,
      status: 'cancelled', submitted_at: null, operator_id: null, operator_name: null, original_entry: null, amendments: [],
      cancelled_at: iso(new Date(due.getTime() + 60 * 60000)), cancelled_by_id: 'demo-admin', cancelled_by_name: 'Demo Administrator',
      cancel_reason: 'Control room closed early — simulated demo cancellation',
      due_notified_at: iso(new Date(due.getTime() - 600000)), is_test: false,
    });
  }
  // Operational tasks — 30
  const TASK_DEFS = [
    ['Confirm fire panel status with duty technician','review_alarm','high'],
    ['Contact site — verify gate camera feed','contact_site','medium'],
    ['Follow up lobby incident report','follow_up_incident','medium'],
    ['Verify night patrol completion','verify_patrol','medium'],
    ['Call guest services about parking complaint','contact_customer','low'],
    ['Check guard welfare on night shift','check_guard','medium'],
    ['Confirm contractor arrival window','confirm_shift','low'],
    ['Log and close shift checklist','other','low'],
  ];
  for (let i = 0; i < 30; i++) {
    const dOff = i < 22 ? 29 - Math.floor(i * 1.3) : (i < 25 ? -(1 + (i - 22)) : 24 - i > 0 ? 24 - i : 1);
    const def = TASK_DEFS[i % TASK_DEFS.length];
    const date = dateStr(Math.max(-6, Math.min(29, dOff)));
    const schedTime = `${String(8 + (i % 9)).padStart(2, '0')}:30`;
    const schedDT = saUTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 8 + (i % 9), 30);
    const dueDT = new Date(schedDT.getTime() + 4 * 3600000);
    const completed = i < 22, awaiting = i >= 22 && i < 24, queue = i >= 24 && i < 27, overdueT = i >= 27;
    const assignee = ROSTER[i % ROSTER.length];
    const verifier = ROSTER[(i + 5) % ROSTER.length];
    const op = ['demo-op1', 'R. Naidoo (Demo)'];
    const row = {
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      control_room_id: controlRoomId, control_room_name: CRN, task_batch_id: null,
      site_id: site.id, site_name: site.name, title: `[SIMULATED] ${def[0]}`,
      description: `[${DEMO_MARKER}] Operational task for demonstration.`, task_type: def[1], priority: def[2],
      assigned_to: queue ? null : assignee[0], assigned_to_name: queue ? null : assignee[1],
      assigned_by: 'demo-admin', assigned_by_name: 'Demo Administrator',
      assigned_at: queue ? null : iso(schedDT),
      scheduled_date: date, scheduled_time: schedTime, scheduled_at: iso(schedDT),
      due_date: iso(dueDT),
      status: completed ? 'completed' : awaiting ? 'awaiting_verification' : queue ? 'queue' : 'overdue',
      completion_notes_required: false, evidence_required: false,
      completion_notes: completed ? `[${DEMO_MARKER}] Task performed and confirmed.` : null,
      completed_at: completed ? iso(new Date(dueDT.getTime() - 30 * 60000)) : null,
      completed_by: completed ? assignee[0] : null, completed_by_name: completed ? assignee[1] : null,
      verified: completed, verified_by: completed ? op[0] : null, verified_by_name: completed ? op[1] : null,
      verified_at: completed ? iso(new Date(dueDT.getTime() - 20 * 60000)) : null,
      final_completed_at: completed ? iso(new Date(dueDT.getTime() - 20 * 60000)) : null,
      completed_late: false, late_reason: null,
      non_completion_reason: overdueT ? 'Duty supervisor unavailable — task deferred to next shift (simulated demo).' : null,
      reason_captured_by: overdueT ? 'demo-admin' : null, reason_captured_by_name: overdueT ? 'Demo Administrator' : null,
      reason_captured_at: overdueT ? iso(new Date(dueDT.getTime() + 2 * 3600000)) : null,
      last_reminder_at: completed ? null : iso(new Date(now.getTime() - 2 * 3600000)),
      additional_notification_user_ids: [], related_entity: null, related_id: null,
      notes: `[${DEMO_MARKER}]`, archived: false,
    };
    tasks.push(row);
  }
  // 3 TaskBatches — reported (no series: no regeneration, no notifications)
  for (let i = 0; i < 3; i++) {
    const date = dateStr(20 - i * 7);
    batches.push({
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      control_room_id: controlRoomId, control_room_name: CRN,
      title: `[SIMULATED] Daily Operational Tasks — ${date}`,
      description: `[${DEMO_MARKER}] Task list for demonstration.`,
      scheduled_date: date, active_start_time: '08:00', deadline_time: '16:00',
      is_series: false, task_definitions: TASK_DEFS.slice(0, 4).map(d => ({ title: d[0], task_type: d[1], priority: d[2], site_id: site.id, site_name: site.name, scheduled_time: '09:00' })),
      recurrence_type: 'none', primary_supervisor_id: 'demo-admin', primary_supervisor_name: 'Demo Administrator',
      additional_notification_user_ids: [],
      status: 'reported', activation_notified_at: iso(new Date(now.getTime() - 30 * 86400000)),
      reason_required_notified_at: null, reminder_count: 4,
      last_reminder_at: iso(new Date(now.getTime() - 26 * 86400000)),
      report_generated_at: iso(new Date(now.getTime() - (20 - i * 7) * 86400000 + 8 * 3600000)),
      report_delivery: 'Simulated demo delivery — no real recipients',
      report_content: `[${DEMO_MARKER}] Task Completion Report — all tasks accounted for (simulated).`,
      created_by_name: 'Demo Administrator', archived: false,
    });
  }
  return { schedules, obs, tasks, batches };
}

function buildIncidents(rnd, batch, cid, rid, site, shifts, now) {
  const incidents = [], maints = [];
  for (let i = 0; i < 25; i++) {
    const dOff = 1 + Math.floor(i * 2.3);
    const def = INC_TITLES[i % INC_TITLES.length];
    const g = ROSTER[i % ROSTER.length];
    const t = saUTC(new Date(now.getTime() - dOff * 86400000).getUTCFullYear(), new Date(now.getTime() - dOff * 86400000).getUTCMonth(), new Date(now.getTime() - dOff * 86400000).getUTCDate(), 8 + (i % 12), (i * 7) % 60);
    const shift = shifts.find(s => s.status === 'completed' && Math.abs(Date.parse(s.start_time) - t.getTime()) < 12 * 3600000) || null;
    const resolved = i < 18, inprog = i < 22;
    const priority = def[2] === 'high' ? 'high' : i % 4 === 0 ? 'medium' : i % 7 === 0 ? 'low' : 'medium';
    const reported = iso(t);
    const row = {
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      title: `[SIMULATED] ${def[0]}`, description: `[${DEMO_MARKER}] ${def[0]} observed at ${site.name}. Details simulated for demonstration purposes.`,
      category: def[1], priority, status: resolved ? (i % 3 === 0 ? 'closed' : 'resolved') : inprog ? 'in_progress' : 'reported',
      incident_number: `INC-DEMO-${batch.slice(5)}-${String(i + 1).padStart(4, '0')}`,
      guard_id: g[0], guard_name: g[1], badge_number: g[2],
      site_id: site.id, site_name: site.name, shift_id: shift ? shift.start_time + '|' + shift.guard_id : null,
      location: { lat: -26.1077 + rnd() * 0.0008, lng: 28.0567 + rnd() * 0.0008 },
      gps_accuracy: 8 + Math.round(rnd() * 12), location_captured_at: reported,
      media: [], assigned_to: resolved || inprog ? 'demo-sup1' : null, assigned_to_name: resolved || inprog ? 'Control Room (Demo)' : null,
      assigned_by: 'demo-admin', assigned_by_name: 'Demo Administrator', assigned_at: resolved || inprog ? iso(new Date(t.getTime() + 6 * 60000)) : null,
      accepted_at: resolved || inprog ? iso(new Date(t.getTime() + 8 * 60000)) : null, accepted_by: resolved || inprog ? 'demo-sup1' : null, accepted_by_name: resolved || inprog ? 'Control Room (Demo)' : null,
      dispatcher_notes: resolved ? `[${DEMO_MARKER}] Dispatched and monitored.` : null,
      resolution_notes: resolved ? `[${DEMO_MARKER}] Resolved on site; guest/asset safe. (Simulated narrative.)` : null,
      resolved_by: resolved ? 'demo-sup1' : null, resolved_by_name: resolved ? 'Control Room (Demo)' : null,
      reported_at: reported, resolved_at: resolved ? iso(new Date(t.getTime() + 45 * 60000)) : null,
      escalated: def[2] === 'high' && resolved, escalation_reason: def[2] === 'high' && resolved ? 'priority' : null,
      escalated_at: def[2] === 'high' && resolved ? iso(new Date(t.getTime() + 10 * 60000)) : null,
      reassigned: false, notification_sent: true,
      activity_log: [{ timestamp: reported, action: 'created', by_user_id: g[0], by_user_name: g[1], from_status: null, to_status: 'reported', notes: `[${DEMO_MARKER}]` }],
    };
    incidents.push(row);
  }
  for (let i = 0; i < 20; i++) {
    const dOff = 2 + Math.floor(i * 2.6);
    const def = MAINT_TITLES[i % MAINT_TITLES.length];
    const g = ROSTER[(i + 2) % ROSTER.length];
    const t = saUTC(new Date(now.getTime() - dOff * 86400000).getUTCFullYear(), new Date(now.getTime() - dOff * 86400000).getUTCMonth(), new Date(now.getTime() - dOff * 86400000).getUTCDate(), 9 + (i % 10), (i * 11) % 60);
    const done = i < 14, inprog = i < 17;
    const row = {
      demo_batch_id: batch, customer_id: cid, reseller_id: rid,
      title: `[SIMULATED] ${def[0]}`, description: `[${DEMO_MARKER}] ${def[0]} reported at ${def[2]} area, ${site.name}.`,
      category: def[1].toLowerCase() === 'gate' ? 'gate' : def[1].toLowerCase(), urgency: def[3],
      status: done ? 'completed' : inprog ? 'in_progress' : 'reported',
      request_number: `MAINT-DEMO-${batch.slice(5)}-${String(i + 1).padStart(4, '0')}`,
      guard_id: g[0], guard_name: g[1], badge_number: g[2],
      site_id: site.id, site_name: site.name,
      location: { lat: -26.1077 + rnd() * 0.0008, lng: 28.0567 + rnd() * 0.0008 },
      gps_accuracy: 9 + Math.round(rnd() * 10), location_captured_at: iso(t), media: [],
      assigned_to: done || inprog ? 'demo-sup1' : null, assigned_to_name: done || inprog ? 'Facilities (Demo)' : null,
      assigned_by: 'demo-admin', assigned_by_name: 'Demo Administrator', assigned_at: done || inprog ? iso(new Date(t.getTime() + 10 * 60000)) : null,
      accepted_at: done || inprog ? iso(new Date(t.getTime() + 12 * 60000)) : null, accepted_by: done || inprog ? 'demo-sup1' : null, accepted_by_name: done || inprog ? 'Facilities (Demo)' : null,
      completion_notes: done ? `[${DEMO_MARKER}] Repaired and verified. (Simulated.)` : null,
      completed_by: done ? 'demo-sup1' : null, completed_by_name: done ? 'Facilities (Demo)' : null,
      follow_up_required: i === 4, recommendations: done ? '[SIMULATED] Monitor for recurrence.' : null,
      reported_at: iso(t), completed_at: done ? iso(new Date(t.getTime() + 26 * 3600000)) : null,
      activity_log: [{ timestamp: iso(t), action: 'created', by_user_id: g[0], by_user_name: g[1], from_status: null, to_status: 'reported', notes: `[${DEMO_MARKER}]` }],
    };
    maints.push(row);
  }
  return { incidents, maints };
}

function buildComms(rnd, batch, cid, rid, site, now) {
  const ledger = [];
  const chat = [], calls = [], notifs = [], docs = [];
  const chatDefs = [
    ['demo-g01', 'Sipho Ndlovu', 'Gate 1 clear, proceeding to lobby check.', 1],
    ['demo-op1', 'Control Room', 'Copy. Log your OB entry when done.', 1],
    ['demo-g01', 'Sipho Ndlovu', 'OB entry logged, all in order.', 1],
    ['demo-g02', 'Thabo Mokoena', 'Night shift started, perimeter patrol at 22:00.', 2],
    ['demo-op2', 'Control Room', 'Acknowledged. Fence alarm was intermittent earlier — check CK-06.', 2],
    ['demo-g02', 'Thabo Mokoena', 'Fence zone 2 reading normal now. Will monitor.', 2],
    ['demo-g05', 'Precious Khumalo', 'Uber Eats rider at gate, one pedestrian admitted.', 3],
    ['demo-op1', 'Control Room', 'Confirmed, thank you.', 3],
    ['demo-g08', 'Andile Mahlangu', 'Parking P1 boom gate slow again, logging maintenance.', 4],
    ['demo-op2', 'Control Room', 'Noted — facilities informed.', 4],
    ['demo-g11', 'Shaun Petersen', 'Lobby incident report submitted, awaiting control room.', 5],
    ['demo-op1', 'Control Room', 'Received, dispatcher on it.', 5],
    ['demo-g12', 'Zanele Nkosi', 'Handover done, all quiet.', 6],
    ['demo-g04', 'Johan van Wyk', 'Taking over gate, receipt confirmed.', 6],
    ['demo-op1', 'Control Room', 'Evening all — storm warning, check pool deck furniture.', 0],
    ['demo-g07', 'Lerato Molefe', 'Pool deck secured, furniture tied down.', 0],
  ];
  chatDefs.forEach((c, i) => {
    const t = iso(new Date(now.getTime() - c[3] * 86400000 - (16 - i) * 600000));
    const row = {
      customer_id: cid, reseller_id: rid, sender_id: c[0], sender_name: `[SIMULATED] ${c[1]}`,
      recipient_id: i % 2 === 0 ? 'demo-op1' : c[0], recipient_name: i % 2 === 0 ? c[1] : 'Control Room (Demo)',
      message: `[${DEMO_MARKER}] ${c[2]}`, timestamp: t, is_broadcast: c[0] === 'demo-op1' && c[3] === 0,
      broadcast_to: c[0] === 'demo-op1' && c[3] === 0 ? 'all_guards' : null, read: true,
    };
    chat.push(row);
  });
  for (let i = 0; i < 8; i++) {
    const t = new Date(now.getTime() - (1 + Math.floor(i * 3)) * 86400000 - i * 900000);
    const g = ROSTER[i % ROSTER.length];
    calls.push({
      customer_id: cid, reseller_id: rid,
      call_id: `demo-call-${batch.slice(5)}-${i + 1}`,
      caller_id: g[0], caller_name: g[1],
      receiver_id: 'demo-op1', receiver_name: 'Control Room (Demo)',
      call_type: 'direct', status: 'completed',
      started_at: iso(t), ended_at: iso(new Date(t.getTime() + (60 + Math.floor(rnd() * 240)) * 1000)),
      duration_seconds: 60 + Math.floor(rnd() * 240),
      has_recording: false, recording_url: null, is_missed: false, created_by: 'demo-seed',
      notes: `[${DEMO_MARKER}] Simulated operational call — no real call, no recording.`,
    });
  }
  const notifDefs = [
    ['shift_assignment', 'Shift assigned', 'Day shift at Hyatt House Sandton — Demo (simulated)'],
    ['patrol_reminder', 'Patrol due', 'Perimeter & Parking patrol due shortly (simulated)'],
    ['ob_check', 'OB check due', 'Lobby & entrance evening check due at 20:00 (simulated)'],
    ['incident_update', 'Incident update', 'INC-DEMO resolved by control room (simulated)'],
    ['maintenance', 'Maintenance update', 'MAINT-DEMO completed by facilities (simulated)'],
  ];
  for (let i = 0; i < 10; i++) {
    const g = ROSTER[i % ROSTER.length];
    const d = notifDefs[i % notifDefs.length];
    notifs.push({
      customer_id: cid, reseller_id: rid, recipient_id: g[0], recipient_name: g[1],
      type: d[0], title: `[SIMULATED] ${d[1]}`, message: `[${DEMO_MARKER}] ${d[2]}`,
      read: i > 4, created_via: 'demo-seed', reference_type: 'demo', reference_id: batch,
      timestamp: iso(new Date(now.getTime() - (i + 1) * 7200000)),
    });
  }
  const docDefs = [
    ['sa_drivers_licence_disc', 'demo-g03', 'Ayanda Dlamini', 'driver licence capture'],
    ['sa_drivers_licence_disc', 'demo-g08', 'Andile Mahlangu', 'vehicle disc capture'],
    ['passport', 'demo-g05', 'Precious Khumalo', 'guest passport capture'],
    ['sa_drivers_licence_disc', 'demo-g12', 'Zanele Nkosi', 'contractor licence capture'],
  ];
  docDefs.forEach((d, i) => {
    docs.push({
      customer_id: cid, reseller_id: rid, document_type: d[0],
      success: true, confidence: 0.9, parser_used: 'demo_simulated',
      raw_json: JSON.stringify({ simulated: true, note: 'No genuine scan occurred — demo fixture' }),
      mapped_summary: `[SIMULATED DEMO] ${d[3]} — synthetic field summary, no genuine document scanned.`,
      caller_page: 'demo', guard_id: d[1], guard_name: d[2],
      site_id: site.id, time: iso(new Date(now.getTime() - (2 + i * 5) * 86400000)),
      timestamp: iso(new Date(now.getTime() - (2 + i * 5) * 86400000)),
    });
  });
  return { chat, calls, notifs, docs };
}

function buildEstate(rnd, batch, cid, rid, site, now) {
  const vendors = [
    { business_name: '[SIMULATED] Sandton Catering Co', category: 'restaurant', contact_name: 'M. du Toit', email: 'bookings@sandtoncatering.demo', phone: '+27820009001', description: 'Event catering for hotel functions (demo vendor).', delivery_available: true, rating: 4.6 },
    { business_name: '[SIMULATED] Hotel Shuttle Services', category: 'other', contact_name: 'K. Mahlaba', email: 'dispatch@hotelshuttle.demo', phone: '+27820009002', description: 'Airport shuttle and guest transfers (demo vendor).', delivery_available: false, rating: 4.4 },
    { business_name: '[SIMULATED] Sandton Laundry', category: 'laundry', contact_name: 'A. Fernandes', email: 'service@sandtonlaundry.demo', phone: '+27820009003', description: 'Linen and laundry service (demo vendor).', delivery_available: true, rating: 4.2 },
  ].map(v => ({ ...v, customer_id: cid, reseller_id: rid, status: 'active', operating_hours: '07:00–19:00', minimum_order: 0, notes: `[${DEMO_MARKER}] Demo vendor record.` }));
  const venues = [
    { name: '[SIMULATED] Grand Ballroom', category: 'hall', capacity: 220, description: 'Ballroom for events and functions (demo venue).', hourly_rate: 0 },
    { name: '[SIMULATED] Poolside Terrace', category: 'braai_area', capacity: 60, description: 'Outdoor terrace for smaller functions (demo venue).', hourly_rate: 0 },
  ].map(v => ({ ...v, customer_id: cid, reseller_id: rid, status: 'active', notes: `[${DEMO_MARKER}] Demo venue record.` }));
  const bookings = [
    { venue: 0, status: 'approved', when: 3, title: 'Corporate year-end function' },
    { venue: 1, status: 'pending', when: 6, title: 'Guest cocktail evening' },
    { venue: 0, status: 'approved', when: 10, title: 'Wedding reception' },
    { venue: 1, status: 'cancelled', when: -2, title: 'Team braai' },
  ].map(b => {
    const t = new Date(now.getTime() + b.when * 86400000);
    const y = t.getUTCFullYear(), m = String(t.getUTCMonth() + 1).padStart(2, '0'), d = String(t.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    return {
      customer_id: cid, reseller_id: rid, venue_id: null, venue_name: venues[b.venue].name,
      resident_id: 'demo-resident', resident_name: 'Demo Guest Services', unit_number: 'Events Desk',
      event_title: `[SIMULATED] ${b.title}`,
      start_datetime: `${dateStr}T18:00:00`, end_datetime: `${dateStr}T22:00:00`,
      booking_date: dateStr, start_time: '18:00', end_time: '22:00',
      guests_expected: 20 + Math.floor(rnd() * 80), status: b.status, collision_checked: true,
      notes: `[${DEMO_MARKER}] Demo booking.`,
    };
  });
  return { vendors, venues, bookings };
}

/* ═══════════ GATEWAY ═══════════ */

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isPlatform = user.role === 'admin' || user.admin_level === 'platform' || user.role_type === 'platform_admin';
    if (!isPlatform) return Response.json({ error: 'Platform administrators only' }, { status: 403 });

    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');
    const cid = String(body.customer_id || '');
    const siteId = String(body.site_id || '');
    if (!cid || !siteId) {
      return Response.json({ error: 'customer_id and site_id are required — the demo gateway never infers its target' }, { status: 400 });
    }

    const site = await svc.entities.Site.get(siteId).catch(() => null);
    if (!site || String(site.customer_id) !== cid) return Response.json({ error: 'Site not found for this customer' }, { status: 404 });
    const customer = await svc.entities.Customer.get(cid).catch(() => null);
    if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });
    const rid = site.reseller_id || customer.reseller_id || null;
    // Guest-facing display name resolved from the TARGET site's configuration
    // (falls back to the site's own name; never a hardcoded brand).
    const siteDisplay = site.hospitality_display_name || site.name;

    // ── batch resolution ──
    const batchRows = await svc.entities.DemoSeedRecord.filter({ kind: 'batch', customer_id: cid }, '-created_date', 5).catch(() => []);
    const batchRow = batchRows.find(r => r.batch_id && !r.reset_at) || null;
    const batchId = batchRow ? batchRow.batch_id : null;

    const ledgerKeyDone = async (key) => {
      const rows = await svc.entities.DemoSeedRecord.filter({ kind: 'seeded', idempotency_key: key }).catch(() => []);
      return rows.length > 0;
    };
    const markPhase = async (batch, key, notes) => {
      await svc.entities.DemoSeedRecord.create({ batch_id: batch, kind: 'seeded', entity_name: '_phase', record_id: key, idempotency_key: key, customer_id: cid, site_id: siteId, notes: notes || null });
    };

    if (action === 'status') {
      const counts = {};
      const TAGGED = ['AccessLog', 'HospitalityVisit', 'Shift', 'ScheduledPatrol', 'PatrolLog', 'OperationalTask', 'OBOccurrence', 'OBSchedule', 'TaskBatch', 'Incident', 'MaintenanceRequest', 'ControlRoom'];
      for (const e of TAGGED) {
        const rows = await svc.entities[e].filter({ demo_batch_id: batchId }).catch(() => []);
        counts[e] = rows.length;
      }
      const ledger = await svc.entities.DemoSeedRecord.filter({ batch_id: batchId, kind: 'seeded' }).catch(() => []);
      const byEntity = {};
      for (const r of ledger) { if (r.entity_name && r.entity_name !== '_phase') byEntity[r.entity_name] = (byEntity[r.entity_name] || 0) + 1; }
      const techTests = await svc.entities.DemoSeedRecord.filter({ batch_id: batchId, kind: 'technical_test' }).catch(() => []);
      const hvTech = (techTests.filter(r => r.entity_name === 'HospitalityVisit') || []).length;
      const siteNow = await svc.entities.Site.get(siteId);
      return Response.json({
        batch_id: batchId, config: batchRow?.notes ? JSON.parse(batchRow.notes) : null,
        counts, ledger_by_entity: byEntity,
        technical_test: { classified: techTests.length, hospitality_visits: hvTech },
        site: { checkpoints: (siteNow.checkpoints || []).length, patrol_enabled: siteNow.patrol_config?.enabled === true, workflow: siteNow.access_workflow },
      });
    }

    if (action === 'seed') {
      const phase = String(body.phase || '');
      if (!batchId) {
        // create batch
        const rand = Array.from(crypto.getRandomValues(new Uint8Array(3))).map(b => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 31]).join('');
        const nowSAST = new Date(Date.now() + 2 * 3600000);
        const newBatch = `DEMO-${nowSAST.getUTCFullYear()}${String(nowSAST.getUTCMonth() + 1).padStart(2, '0')}${String(nowSAST.getUTCDate()).padStart(2, '0')}-${rand}`;
        const rnd = mulberry32(hashStr(newBatch));
        const config = {
          customer_id: cid, site_id: siteId, created_for: customer.name,
          site_snapshot: { checkpoints: site.checkpoints || [], patrol_config: site.patrol_config || null, hospitality_display_name: site.hospitality_display_name || null },
          created_by: user.id, created_by_name: user.full_name || user.email,
        };
        await svc.entities.DemoSeedRecord.create({ batch_id: newBatch, kind: 'batch', entity_name: '_batch', record_id: newBatch, customer_id: cid, site_id: siteId, notes: JSON.stringify(config) });
        return Response.json({ ok: true, batch_id: newBatch, next_phase: 'setup', message: 'Batch created. Run seed phase "setup" next.' });
      }
      const config = batchRow?.notes ? JSON.parse(batchRow.notes) : {};
      const rnd = mulberry32(hashStr(batchId));
      const now = new Date();

      if (phase === 'setup') {
        const key = `${batchId}:setup`;
        // Classification is RERUN-SAFE (never deletes; re-marking is_test is
        // idempotent) so the skip check only applies to the control room.
        // 1) CLASSIFY technical tests — reconciled against the earlier 42-visit audit
        const tokenRe = /^(duptest|test|tk_|verify_|selftest|self_test)/i;
        const fixtureRe = /\b(test|probe|matrix|tiebreak|idem)\b/i;
        const prefixRe = /^(conc |gate walk one|john test|mr d rider)/i;
        const isFixture = (s) => fixtureRe.test(String(s || '')) || prefixRe.test(String(s || '').trim().toLowerCase());
        const hvAll = await svc.entities.HospitalityVisit.filter({ customer_id: cid }, '-created_date', 1000).catch(() => []);
        const testVisits = hvAll.filter(v => v.is_test === true || tokenRe.test(String(v.submit_token || '')) || isFixture(`${v.person_name || ''}`));
        const testVisitIds = testVisits.map(v => v.id);
        if (testVisitIds.length) await svc.entities.HospitalityVisit.bulkUpdate(testVisitIds.map(id => ({ id, is_test: true })));
        const alAll = await svc.entities.AccessLog.filter({ customer_id: cid }, '-created_date', 500).catch(() => []);
        const linked = new Set(alAll.filter(l => l.hospitality_visit_id && testVisitIds.includes(l.hospitality_visit_id)).map(l => l.id));
        const testLogs = alAll.filter(l =>
          linked.has(l.id) || l.is_test === true ||
          isFixture(`${l.person_name || ''}`) ||
          (String(l.notes || '').startsWith('GRID GATE Hospitality') && String(l.guard_name || '') === 'Danie Oelofse' && String(l.created_date || '').startsWith('2026-10-01'))
        );
        if (testLogs.length) await svc.entities.AccessLog.bulkUpdate(testLogs.map(l => ({ id: l.id, is_test: true })));
        const evAll = await svc.entities.HospitalityEvidence.filter({ customer_id: cid }).catch(() => []);
        const testEv = evAll.filter(e => e.is_test === true || e.kind === 'test' || tokenRe.test(String(e.submit_token || '')) || (e.visit_id && testVisitIds.includes(e.visit_id)));
        if (testEv.length) await svc.entities.HospitalityEvidence.bulkUpdate(testEv.map(e => ({ id: e.id, is_test: true })));
        // ledger rows for every classified record (audit, never deleted by
        // reset) — rerun-safe: existing classification rows are skipped.
        const existingTT = await svc.entities.DemoSeedRecord.filter({ batch_id: batchId, kind: 'technical_test' }).catch(() => []);
        const ttSeen = new Set(existingTT.map(r => `${r.entity_name}:${r.record_id}`));
        const ledgerRows = [
          ...testVisitIds.map(id => ({ batch_id: batchId, kind: 'technical_test', entity_name: 'HospitalityVisit', record_id: id, customer_id: cid, site_id: siteId })),
          ...testLogs.map(l => ({ batch_id: batchId, kind: 'technical_test', entity_name: 'AccessLog', record_id: l.id, customer_id: cid, site_id: siteId })),
          ...testEv.map(e => ({ batch_id: batchId, kind: 'technical_test', entity_name: 'HospitalityEvidence', record_id: e.id, customer_id: cid, site_id: siteId })),
        ].filter(r => !ttSeen.has(`${r.entity_name}:${r.record_id}`));
        for (const c of chunk(ledgerRows, 200)) await svc.entities.DemoSeedRecord.bulkCreate(c);
        // 2) Site config: checkpoints + patrol config + hospitality display name (preserve existing values)
        const siteUpdate = {};
        if (!(site.checkpoints || []).some(c => String(c.id || '').startsWith('demo-ck'))) {
          siteUpdate.checkpoints = [...(site.checkpoints || []), ...CHECKPOINTS.map(c => ({ id: c.id, name: c.name, qr_code: `USS-DEMO-${c.id.replace('demo-ck-0', 'CK')}`, zone: c.zone, risk_level: c.risk_level, description: `[${DEMO_MARKER}] ${c.name}`, required: true, location: { lat: c.lat, lng: c.lng } }))];
        }
        siteUpdate.patrol_config = { ...(site.patrol_config || {}), enabled: true, schedules: [{ start_time: '06:00', end_time: '18:00', frequency_minutes: 240, days: [0,1,2,3,4,5,6], random_timing: false }, { start_time: '18:00', end_time: '06:00', frequency_minutes: 300, days: [0,1,2,3,4,5,6], random_timing: false }], duration_target_minutes: 35, alert_before_minutes: 10, escalation_after_minutes: 15, supervisor_escalation: false, random_route: true, ai_route_optimization: false, required_checkpoints: [] };
        // Preserve the target site's own access workflow and guest-facing
        // display name: the hospitality display name is only derived (from
        // the site itself) for sites already running the hospitality
        // workflow — never applied to other customers' sites.
        if (!site.hospitality_display_name && site.access_workflow === 'grid_gate_hospitality') {
          siteUpdate.hospitality_display_name = siteDisplay;
        }
        await svc.entities.Site.update(siteId, siteUpdate);
        // 3) Control room
        const crExisting = await svc.entities.ControlRoom.filter({ demo_batch_id: batchId }).catch(() => []);
        let crId = crExisting[0]?.id || null;
        if (!crId) {
          const cr = await svc.entities.ControlRoom.create({ demo_batch_id: batchId, customer_id: cid, reseller_id: rid, name: `${site.name} Control Room`, physical_address: site.address || null, status: 'active', linked_site_ids: [siteId], supervisor_user_ids: [], operator_user_ids: [], notes: `[${DEMO_MARKER}] Demo control room.` });
          crId = cr.id;
        }
        await markPhase(batchId, `${batchId}:setup`, JSON.stringify({ control_room_id: crId, classified: { visits: testVisitIds.length, logs: testLogs.length, evidence: testEv.length } }));
        return Response.json({ ok: true, phase, control_room_id: crId, classified: { hospitality_visits: testVisitIds.length, access_logs: testLogs.length, evidence: testEv.length }, next_phase: 'shifts' });
      }

      if (phase === 'shifts') {
        const key = `${batchId}:shifts`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const existing = await svc.entities.Shift.filter({ demo_batch_id: batchId }).catch(() => []);
        if (existing.length) return Response.json({ ok: true, phase, skipped: true, existing: existing.length });
        const rows = buildShifts(rnd, batchId, cid, rid, site, now);
        for (const c of chunk(rows, 60)) await svc.entities.Shift.bulkCreate(c);
        await markPhase(batchId, key, `shifts=${rows.length}`);
        return Response.json({ ok: true, phase, shifts: rows.length, next_phase: 'patrols' });
      }

      if (phase === 'patrols') {
        const key = `${batchId}:patrols`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const shifts = await svc.entities.Shift.filter({ demo_batch_id: batchId }).catch(() => []);
        const { patrols, logs } = buildPatrols(rnd, batchId, cid, rid, site, shifts, now);
        for (const c of chunk(patrols, 50)) await svc.entities.ScheduledPatrol.bulkCreate(c);
        for (const c of chunk(logs, 100)) await svc.entities.PatrolLog.bulkCreate(c);
        await markPhase(batchId, key, `patrols=${patrols.length} logs=${logs.length}`);
        return Response.json({ ok: true, phase, patrols: patrols.length, patrol_logs: logs.length, next_phase: 'hospitality' });
      }

      if (phase === 'hospitality') {
        const key = `${batchId}:hospitality`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const existing = await svc.entities.HospitalityVisit.filter({ demo_batch_id: batchId }, '-created_date', 1).catch(() => []);
        if (existing.length) return Response.json({ ok: true, phase, skipped: true, existing: existing.length });
        const shifts = await svc.entities.Shift.filter({ demo_batch_id: batchId }).catch(() => []);
        const { visits, logs } = buildHospitality(rnd, batchId, cid, rid, site, shifts, now);
        // create logs first, then link visit -> log id
        const createdLogs = [];
        for (const c of chunk(logs, 100)) { const made = await svc.entities.AccessLog.bulkCreate(c); createdLogs.push(...(made || c)); }
        const logByKey = new Map();
        for (const v of visits) {
          if (!v._logRef) continue;
          const keyStr = v._logRef.person_name + '|' + v._logRef.entry_time;
          logByKey.set(keyStr, v._logRef);
        }
        // map created logs back by (person_name, entry_time)
        const allLogs = await svc.entities.AccessLog.filter({ demo_batch_id: batchId }, '-created_date', 1000).catch(() => []);
        const logMap = new Map(allLogs.map(l => [`${l.person_name}|${l.entry_time}`, l]));
        for (const v of visits) {
          if (!v._logRef) continue;
          const l = logMap.get(`${v._logRef.person_name}|${v._logRef.entry_time}`);
          if (l) { v.access_log_id = l.id; v.status = 'confirmed'; }
          delete v._logRef;
        }
        for (const c of chunk(visits, 100)) await svc.entities.HospitalityVisit.bulkCreate(c);
        await markPhase(batchId, key, `visits=${visits.length} logs=${logs.length}`);
        return Response.json({ ok: true, phase, visits: visits.length, access_logs: logs.length, next_phase: 'ops' });
      }

      if (phase === 'ops') {
        const key = `${batchId}:ops`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const crRows = await svc.entities.ControlRoom.filter({ demo_batch_id: batchId }).catch(() => []);
        const crId = crRows[0]?.id || null;
        const { schedules, obs, tasks, batches } = buildOps(rnd, batchId, cid, rid, site, crId, now);
        const createdSchedules = [];
        for (const s of schedules) { const made = await svc.entities.OBSchedule.create(s); createdSchedules.push(made); }
        for (const o of obs) {
          o.schedule_id = createdSchedules[o.schedule_index || 0]?.id || null;
          delete o.schedule_index;
        }
        for (const c of chunk(obs, 50)) await svc.entities.OBOccurrence.bulkCreate(c);
        for (const c of chunk(tasks, 30)) await svc.entities.OperationalTask.bulkCreate(c);
        for (const c of chunk(batches, 3)) await svc.entities.TaskBatch.bulkCreate(c);
        await markPhase(batchId, key, `obschedules=${schedules.length} ob=${obs.length} tasks=${tasks.length} batches=${batches.length}`);
        return Response.json({ ok: true, phase, ob_schedules: schedules.length, ob_occurrences: obs.length, tasks: tasks.length, task_batches: batches.length, next_phase: 'incidents' });
      }

      if (phase === 'incidents') {
        const key = `${batchId}:incidents`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const shifts = await svc.entities.Shift.filter({ demo_batch_id: batchId }).catch(() => []);
        const { incidents, maints } = buildIncidents(rnd, batchId, cid, rid, site, shifts, now);
        for (const c of chunk(incidents, 25)) await svc.entities.Incident.bulkCreate(c);
        for (const c of chunk(maints, 20)) await svc.entities.MaintenanceRequest.bulkCreate(c);
        await markPhase(batchId, key, `incidents=${incidents.length} maintenance=${maints.length}`);
        return Response.json({ ok: true, phase, incidents: incidents.length, maintenance: maints.length, next_phase: 'comms' });
      }

      if (phase === 'comms') {
        const key = `${batchId}:comms`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const { chat, calls, notifs, docs } = buildComms(rnd, batchId, cid, rid, site, now);
        const ledgerRows = [];
        const track = (entity, made, idField) => { for (const m of made) ledgerRows.push({ batch_id: batchId, kind: 'seeded', entity_name: entity, record_id: m.id || m[idField], customer_id: cid, site_id: siteId }); };
        const madeChat = []; for (const c of chunk(chat, 16)) madeChat.push(...(await svc.entities.ChatMessage.bulkCreate(c)));
        const madeCalls = []; for (const c of chunk(calls, 8)) madeCalls.push(...(await svc.entities.CallHistory.bulkCreate(c)));
        const madeNotifs = []; for (const c of chunk(notifs, 10)) madeNotifs.push(...(await svc.entities.Notification.bulkCreate(c)));
        const madeDocs = []; for (const c of chunk(docs, 4)) madeDocs.push(...(await svc.entities.DocumentScan.bulkCreate(c)));
        track('ChatMessage', madeChat, 'id'); track('CallHistory', madeCalls, 'id'); track('Notification', madeNotifs, 'id'); track('DocumentScan', madeDocs, 'id');
        for (const c of chunk(ledgerRows, 100)) await svc.entities.DemoSeedRecord.bulkCreate(c);
        await markPhase(batchId, key, `chat=${chat.length} calls=${calls.length} notifications=${notifs.length} docscans=${docs.length}`);
        return Response.json({ ok: true, phase, chat_messages: chat.length, call_history: calls.length, notifications: notifs.length, document_scans: docs.length, next_phase: 'estate' });
      }

      if (phase === 'estate') {
        const key = `${batchId}:estate`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        const { vendors, venues, bookings } = buildEstate(rnd, batchId, cid, rid, site, now);
        const madeV = []; for (const c of chunk(vendors, 3)) madeV.push(...(await svc.entities.Vendor.bulkCreate(c)));
        const madeVen = []; for (const c of chunk(venues, 2)) madeVen.push(...(await svc.entities.Venue.bulkCreate(c)));
        for (const b of bookings) { const ven = madeVen[venues.findIndex(v => v.name === b.venue_name)]; if (ven) b.venue_id = ven.id; }
        const madeB = []; for (const c of chunk(bookings, 4)) madeB.push(...(await svc.entities.VenueBooking.bulkCreate(c)));
        const ledgerRows = [
          ...madeV.map(m => ({ batch_id: batchId, kind: 'seeded', entity_name: 'Vendor', record_id: m.id, customer_id: cid, site_id: siteId })),
          ...madeVen.map(m => ({ batch_id: batchId, kind: 'seeded', entity_name: 'Venue', record_id: m.id, customer_id: cid, site_id: siteId })),
          ...madeB.map(m => ({ batch_id: batchId, kind: 'seeded', entity_name: 'VenueBooking', record_id: m.id, customer_id: cid, site_id: siteId })),
        ];
        for (const c of chunk(ledgerRows, 50)) await svc.entities.DemoSeedRecord.bulkCreate(c);
        await markPhase(batchId, key, `vendors=${vendors.length} venues=${venues.length} bookings=${bookings.length}`);
        return Response.json({ ok: true, phase, vendors: vendors.length, venues: venues.length, venue_bookings: bookings.length, next_phase: 'finalize' });
      }

      if (phase === 'finalize') {
        const key = `${batchId}:finalize`;
        if (await ledgerKeyDone(key)) return Response.json({ ok: true, phase, skipped: true });
        // Tag any platform-generated (workflow) records that reference demo
        // shifts/patrols but were created without the batch tag — only when
        // this is the first seed (no genuine operational records exist yet).
        const taggable = ['ScheduledPatrol', 'PatrolLog'];
        const demoShifts = await svc.entities.Shift.filter({ demo_batch_id: batchId }).catch(() => []);
        const demoShiftIds = new Set(demoShifts.map(s => s.id));
        const tagged = {};
        for (const e of taggable) {
          const rows = await svc.entities[e].filter({ customer_id: cid, demo_batch_id: null }, '-created_date', 500).catch(() => []);
          const mine = rows.filter(r => (e === 'ScheduledPatrol' && demoShiftIds.has(r.shift_id)) || (e === 'PatrolLog' && demoShiftIds.has(r.shift_id)));
          if (mine.length) {
            await svc.entities[e].bulkUpdate(mine.map(m => ({ id: m.id, demo_batch_id: batchId })));
            await svc.entities.DemoSeedRecord.bulkCreate(mine.map(m => ({ batch_id: batchId, kind: 'seeded', entity_name: e, record_id: m.id, customer_id: cid, site_id: siteId, notes: 'platform-generated during seed; tagged' })));
            tagged[e] = mine.length;
          }
        }
        // any leftover untagged generated rows (e.g. patrol logs generated from tagged patrols)
        const logRows = await svc.entities.PatrolLog.filter({ customer_id: cid, demo_batch_id: null }, '-created_date', 500).catch(() => []);
        if (logRows.length) {
          await svc.entities.PatrolLog.bulkUpdate(logRows.map(m => ({ id: m.id, demo_batch_id: batchId })));
          await svc.entities.DemoSeedRecord.bulkCreate(logRows.map(m => ({ batch_id: batchId, kind: 'seeded', entity_name: 'PatrolLog', record_id: m.id, customer_id: cid, site_id: siteId, notes: 'platform-generated during seed; tagged' })));
          tagged['PatrolLog'] = (tagged['PatrolLog'] || 0) + logRows.length;
        }
        await markPhase(batchId, key, JSON.stringify({ tagged }));
        return Response.json({ ok: true, phase, workflow_generated_tagged: tagged, complete: true });
      }

      return Response.json({ error: 'Unknown phase. Use setup, shifts, patrols, hospitality, ops, incidents, comms, estate, finalize.' }, { status: 400 });
    }

    if (action === 'reset') {
      if (!batchId) return Response.json({ error: 'No seed batch exists for this customer' }, { status: 404 });
      const config = batchRow?.notes ? JSON.parse(batchRow.notes) : {};
      const siteSnapshot = config.site_snapshot || {};
      const results = {};
      // 1) batch-tagged entities
      const TAGGED = ['HospitalityVisit', 'AccessLog', 'Shift', 'ScheduledPatrol', 'PatrolLog', 'OperationalTask', 'OBOccurrence', 'OBSchedule', 'TaskBatch', 'Incident', 'MaintenanceRequest', 'ControlRoom'];
      for (const e of TAGGED) {
        const rows = await svc.entities[e].filter({ demo_batch_id: batchId }).catch(() => []);
        if (rows.length) await svc.entities[e].deleteMany({ demo_batch_id: batchId });
        results[e] = rows.length;
      }
      // 2) ledger-tracked entities (delete by stored record ids only)
      const ledger = await svc.entities.DemoSeedRecord.filter({ batch_id: batchId, kind: 'seeded' }).catch(() => []);
      const byEntity = {};
      for (const r of ledger) { if (r.entity_name && r.entity_name !== '_phase') (byEntity[r.entity_name] = byEntity[r.entity_name] || []).push(r.record_id); }
      for (const [e, ids] of Object.entries(byEntity)) {
        for (const id of ids) await svc.entities[e].delete(id).catch(() => {});
        results[e] = ids.length;
      }
      // 3) restore site snapshot
      await svc.entities.Site.update(siteId, {
        checkpoints: (siteSnapshot.checkpoints || []).filter(c => !String(c.id || '').startsWith('demo-ck')),
        patrol_config: siteSnapshot.patrol_config || { enabled: false, schedules: [] },
        hospitality_display_name: siteSnapshot.hospitality_display_name || null,
      });
      // 4) delete ledger rows for this batch (keep technical_test classification rows)
      await svc.entities.DemoSeedRecord.deleteMany({ batch_id: batchId, kind: { $ne: 'technical_test' } });
      return Response.json({ ok: true, reset_batch: batchId, deleted: results, site_restored: true, technical_test_rows_preserved: true });
    }

    return Response.json({ error: 'Invalid action. Use status, seed or reset.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message, stack: String(error.stack || '').split('\n').slice(0, 4) }, { status: 500 });
  }
}