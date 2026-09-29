/**
 * Shared DAILY ACCESS CONTROL REPORT engine — the ONE implementation used by
 * generateDailyAccessReport (scheduled 17:00 sends, manual per-site sends and
 * authorised TEST sends). Pure, deterministic computations (no SDK access):
 *  - CONTINUOUS reporting period: PREVIOUS DAY 17:00:00 → CURRENT DAY 16:59:59
 *    in the SITE-LOCAL timezone (default Africa/Johannesburg; never UTC-
 *    hardcoded), so no activity after 17:00 ever disappears from reporting.
 *  - Section ordering and content per the report specification:
 *    1) VISITORS STILL ON SITE (live snapshot at generation time — includes
 *       carry-over visitors from previous days)
 *    2) Executive Summary
 *    3) Complete Entry/Exit Register (authoritative stored attribution only)
 *    4) Top Destinations / Top Visit-Work Types / Access by Gate
 *    5) Device Activity / Access Activity by Operator
 *    6) Attention Required (factual only — no invented incidents)
 *  - Renders: branded mobile-friendly email body HTML (wrapped by the central
 *    transactional renderer), a paginated branded PDF, and a detailed CSV.
 *
 * ATTRIBUTION: derived ONLY from the stored AccessLog fields
 * (guard_name/entry_device_name/gate_name/entry_time and
 * exit_guard_name/exit_device_name/exit_gate/exit_time). A historical report
 * is NEVER based on the current logged-in user, and an exit never overwrites
 * the original entry attribution.
 */

import { jsPDF } from 'npm:jspdf@2.5.2';

export const DEFAULT_REPORT_TIMEZONE = 'Africa/Johannesburg';
export const REPORT_HOUR_LOCAL = 17;
export const LONG_STAY_HOURS = 8;
export const EXTENDED_STAY_HOURS = 24;

/* ── Timezone math (no external deps) ───────────────────────────────────── */

function zonedParts(ms: number, tz: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out: any = {};
  for (const p of dtf.formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    y: Number(out.year), m: Number(out.month), d: Number(out.day),
    h: Number(out.hour) % 24, min: Number(out.minute), s: Number(out.second),
  };
}

function tzOffsetMinutes(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - ms) / 60000);
}

/** Site-local wall clock → UTC instant (DST-safe iteration). The offset is
 *  always subtracted from the ORIGINAL naive instant — re-subtracting from
 *  the already-corrected value applied the offset twice and shifted every
 *  period boundary 2 hours early (17:00 windows actually ran 15:00→15:00,
 *  a daily reporting gap). */
export function wallToUtcMs(tz: string, y: number, m: number, d: number, h: number, min = 0, s = 0): number {
  const naive = Date.UTC(y, m - 1, d, h, min, s);
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    const corrected = naive - tzOffsetMinutes(ts, tz) * 60000;
    if (corrected === ts) return ts;
    ts = corrected;
  }
  return ts;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * CONTINUOUS reporting period. The scheduled run happens AT 17:00 site-local
 * time, so the period is yesterday 17:00:00 → today 16:59:59 (local). A run
 * invoked BEFORE today's 17:00 resolves to the PREVIOUS period (yesterday's
 * window) so a manual generation can never double-count or skip activity.
 */
export function computeReportingPeriod(nowMs: number, tz: string) {
  const nowParts = zonedParts(nowMs, tz);
  const todayEndExclusive = wallToUtcMs(tz, nowParts.y, nowParts.m, nowParts.d, REPORT_HOUR_LOCAL);
  let endParts = nowParts;
  if (nowMs < todayEndExclusive) {
    const shifted = zonedParts(nowMs - 24 * 3600 * 1000, tz);
    endParts = shifted;
  }
  const startMs = wallToUtcMs(tz, endParts.y, endParts.m, endParts.d - 1, REPORT_HOUR_LOCAL);
  const endExclusiveMs = wallToUtcMs(tz, endParts.y, endParts.m, endParts.d, REPORT_HOUR_LOCAL);
  const reportDateIso = `${endParts.y}-${pad(endParts.m)}-${pad(endParts.d)}`;
  return {
    timezone: tz,
    reportDateIso,
    startMs,
    endMs: endExclusiveMs - 1,
    endExclusiveMs,
    inWindow: (ms: any) => {
      const t = typeof ms === 'string' ? Date.parse(ms) : Number(ms);
      return Number.isFinite(t) && t >= startMs && t < endExclusiveMs;
    },
  };
}

export function makeZonedFormatters(tz: string) {
  const dateFmt = new Intl.DateTimeFormat('en-ZA', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-ZA', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const secsFmt = new Intl.DateTimeFormat('en-ZA', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return {
    date: (ms: number) => dateFmt.format(new Date(ms)),
    time: (ms: number) => timeFmt.format(new Date(ms)),
    dateTime: (ms: number) => `${dateFmt.format(new Date(ms))} ${timeFmt.format(new Date(ms))}`,
    dateTimeSecs: (ms: number) => `${dateFmt.format(new Date(ms))} ${secsFmt.format(new Date(ms))}`,
  };
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const esc = (v: any) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toMs(v: any): number | null {
  if (v == null) return null;
  const t = typeof v === 'string' ? Date.parse(v) : Number(v);
  return Number.isFinite(t) ? t : null;
}

function durationLabel(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

function minutesBetween(a: number, b: number): number {
  return Math.max(0, Math.round((b - a) / 60000));
}

function stayLabel(minutes: number): string {
  if (minutes >= EXTENDED_STAY_HOURS * 60) return 'Extended Stay';
  if (minutes >= LONG_STAY_HOURS * 60) return 'Attention';
  return 'Normal';
}

function groupCounts(rows: any[], keyFn: (r: any) => string): { name: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = (keyFn(r) || '').trim();
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ── Model ──────────────────────────────────────────────────────────────── */

export function buildDailyAccessModel(p: {
  period: ReturnType<typeof computeReportingPeriod>;
  fmt: ReturnType<typeof makeZonedFormatters>;
  stillInside: any[];
  exited: any[];
  denied: any[];
  devices: any[];
  customerName: string;
  siteName: string;
  generatedAtMs: number;
}): any {
  const { period, fmt, stillInside, exited, denied, devices } = p;
  const entryMs = (l: any) => toMs(l.entry_time) ?? toMs(l.timestamp);
  const exitMs = (l: any) => toMs(l.exit_time);

  // Visits ENTERED during the reporting period (each visit belongs to exactly
  // one period — entered today, regardless of exit status).
  const enteredInWindow = [...exited, ...stillInside].filter((l) => {
    const t = entryMs(l);
    return t != null && period.inWindow(t);
  });
  // Carry-over exits: visits entered BEFORE this period whose EXIT occurred
  // during it (the entry appeared in an earlier report — the exit appears
  // here, so no record is ever lost or duplicated).
  const carryOverExits = exited.filter((l) => {
    const e = entryMs(l); const x = exitMs(l);
    return x != null && period.inWindow(x) && (e == null || e < period.startMs);
  });
  const deniedInWindow = denied.filter((l) => {
    const t = toMs(l.timestamp) ?? entryMs(l);
    return t != null && period.inWindow(t);
  });

  const statusLabel = (l: any) => {
    if (l.status === 'inside') return 'STILL ON SITE';
    if (l.status === 'exited') return 'Exited';
    if (l.status === 'denied') return 'Denied';
    if (l.status === 'blacklisted') return 'Blacklisted';
    if (l.status === 'override_approved' || l.status === 'overridden') return 'Override';
    return String(l.status || '—');
  };

  const registerRow = (l: any, kind: 'visit' | 'carry' | 'denied') => {
    const e = entryMs(l); const x = exitMs(l);
    return {
      kind,
      visitor: l.person_name || 'Unknown',
      vehicle: l.vehicle_registration || '',
      visitType: l.visit_or_work === 'work' ? 'Work' : l.visit_or_work === 'visit' ? 'Visit' : '',
      workType: l.work_type || '',
      destination: l.destination || '',
      company: l.company || '',
      entryTimeMs: e,
      entryTime: e != null ? fmt.dateTime(e) : '—',
      entryGate: l.gate_name || '—',
      entryUser: l.guard_name || '—',
      entryDevice: l.entry_device_name || '—',
      exitTimeMs: x,
      exitTime: x != null ? fmt.dateTime(x) : '—',
      exitGate: l.exit_gate || '—',
      exitUser: l.exit_guard_name || '—',
      exitDevice: l.exit_device_name || '—',
      duration: (e != null && x != null) ? durationLabel(minutesBetween(e, x))
        : (e != null ? durationLabel(minutesBetween(e, p.generatedAtMs)) : '—'),
      status: statusLabel(l),
    };
  };

  const register = [
    ...enteredInWindow.map((l) => registerRow(l, 'visit')),
    ...carryOverExits.map((l) => registerRow(l, 'carry')),
    ...deniedInWindow.map((l) => registerRow(l, 'denied')),
  ].sort((a, b) => (a.entryTimeMs ?? 0) - (b.entryTimeMs ?? 0));

  // ── STILL ON SITE — live snapshot at generation time, ALL open visits
  // (regardless of which day they entered). ──
  const stillOnSite = stillInside
    .map((l) => {
      const e = entryMs(l) ?? toMs(l.timestamp);
      const mins = e != null ? minutesBetween(e, p.generatedAtMs) : 0;
      return {
        visitor: l.person_name || 'Unknown',
        vehicle: l.vehicle_registration || '',
        enteredAt: e != null ? fmt.dateTime(e) : '—',
        duration: durationLabel(mins),
        durationMinutes: mins,
        stayLabel: stayLabel(mins),
        visitType: l.visit_or_work === 'work' ? 'Work' : l.visit_or_work === 'visit' ? 'Visit' : '',
        workType: l.work_type || '',
        destination: l.destination || '',
        company: l.company || '',
        entryGate: l.gate_name || '—',
        entryUser: l.guard_name || '—',
        entryDevice: l.entry_device_name || '—',
        status: 'STILL ON SITE',
      };
    })
    .sort((a, b) => a.durationMinutes - b.durationMinutes);

  // ── Executive summary ──
  const exitsInWindow = [...exited].filter((l) => {
    const x = exitMs(l);
    return x != null && period.inWindow(x);
  });
  const uniqueVisitors = new Set(
    enteredInWindow.map((l) => String(l.person_name || '').trim().toLowerCase()).filter(Boolean)
  ).size;
  const vehicleEntries = enteredInWindow.filter((l) => (l.vehicle_registration || '').trim()).length;
  const deliveries = enteredInWindow.filter((l) => /deliver/i.test(String(l.work_type || ''))).length;
  const contractorVisits = enteredInWindow.filter((l) =>
    /contract/i.test(String(l.work_type || '')) || /contract/i.test(String(l.company || ''))).length;
  const overridesInWindow = deniedInWindow.filter((l) =>
    l.status === 'override_approved' || l.status === 'overridden').length;
  const deniedCount = deniedInWindow.filter((l) => l.status === 'denied' || l.status === 'blacklisted').length;

  const summary = {
    totalEntries: enteredInWindow.length,
    totalExits: exitsInWindow.length,
    stillOnSite: stillOnSite.length,
    uniqueVisitors,
    vehicleEntries,
    pedestrianEntries: enteredInWindow.length - vehicleEntries,
    deliveries,
    contractorVisits,
    denied: deniedCount,
    overrides: overridesInWindow,
  };

  // ── Top destinations / visit-work types (from real data only) ──
  const topDestinations = groupCounts(enteredInWindow, (l) => String(l.destination || ''));
  const topVisitTypes = groupCounts(enteredInWindow, (l) =>
    String(l.work_type || (l.visit_or_work === 'work' ? 'Work' : l.visit_or_work === 'visit' ? 'Visit' : '') || 'Other'));

  // ── Access by gate ──
  const entriesByGate = groupCounts(enteredInWindow, (l) => String(l.gate_name || ''));
  const exitsByGate = groupCounts(exitsInWindow, (l) => String(l.exit_gate || ''));
  const gateNames = new Set([...entriesByGate.map((g) => g.name), ...exitsByGate.map((g) => g.name)]);
  const gateSummary = Array.from(gateNames).map((g) => ({
    gate: g,
    entries: entriesByGate.find((x) => x.name === g)?.count || 0,
    exits: exitsByGate.find((x) => x.name === g)?.count || 0,
  })).sort((a, b) => (b.entries + b.exits) - (a.entries + a.exits));

  // ── Device activity (authoritative DeviceRegistration + log attribution) ──
  const deviceNames = new Set<string>([
    ...devices.map((d) => String(d.device_name || '')).filter(Boolean),
    ...enteredInWindow.map((l) => String(l.entry_device_name || '')).filter(Boolean),
    ...exitsInWindow.map((l) => String(l.exit_device_name || '')).filter(Boolean),
  ]);
  const deviceActivity = Array.from(deviceNames).map((name) => {
    const entries = enteredInWindow.filter((l) => l.entry_device_name === name).length;
    const exits = exitsInWindow.filter((l) => l.exit_device_name === name).length;
    let last: number | null = null;
    for (const l of [...enteredInWindow, ...exitsInWindow]) {
      const t = l.entry_device_name === name ? (entryMs(l) ?? null) : (l.exit_device_name === name ? exitMs(l) : null);
      if (t != null && (last == null || t > last)) last = t;
    }
    return { device: name, entries, exits, lastActivity: last != null ? fmt.time(last) : '—' };
  }).sort((a, b) => (b.entries + b.exits) - (a.entries + a.exits));

  // ── Access activity by operator (operational accountability only —
  // presented neutrally, never as a staff-performance ranking) ──
  const opNames = new Set<string>([
    ...enteredInWindow.map((l) => String(l.guard_name || '')).filter(Boolean),
    ...exitsInWindow.map((l) => String(l.exit_guard_name || '')).filter(Boolean),
  ]);
  const operatorActivity = Array.from(opNames).map((name) => ({
    operator: name,
    entriesProcessed: enteredInWindow.filter((l) => l.guard_name === name).length,
    exitsProcessed: exitsInWindow.filter((l) => l.exit_guard_name === name).length,
  })).sort((a, b) => a.operator.localeCompare(b.operator));

  // ── Attention required (factual conditions only) ──
  const attention: string[] = [];
  if (stillOnSite.length > 0) {
    attention.push(`${stillOnSite.length} visitor${stillOnSite.length === 1 ? '' : 's'} still on site at report time.`);
  }
  const extended = stillOnSite.filter((v) => v.durationMinutes >= LONG_STAY_HOURS * 60);
  for (const v of extended) {
    attention.push(`Extended-duration visit: ${v.visitor} on site for ${v.duration}${v.destination ? ` (destination: ${v.destination})` : ''}.`);
  }
  if (deniedCount > 0) {
    attention.push(`${deniedCount} access denial${deniedCount === 1 ? '' : 's'} recorded during the reporting period.`);
  }
  if (overridesInWindow > 0) {
    attention.push(`${overridesInWindow} blacklist override${overridesInWindow === 1 ? '' : 's'} recorded during the reporting period.`);
  }

  return {
    meta: {
      customerName: p.customerName,
      siteName: p.siteName,
      reportDate: fmt.date(period.endMs),
      reportingPeriod: `${fmt.dateTimeSecs(period.startMs)} to ${fmt.dateTimeSecs(period.endMs)}`,
      generatedAt: fmt.dateTimeSecs(p.generatedAtMs),
      timezone: period.timezone,
      reportDateIso: period.reportDateIso,
    },
    summary,
    stillOnSite,
    register,
    topDestinations,
    topVisitTypes,
    gateSummary,
    deviceActivity,
    operatorActivity,
    attention,
  };
}

/* ── Email body (mobile-friendly; wrapped by the central renderer) ─────── */

export function renderDailyAccessEmailBody(model: any): string {
  const m = model;
  const card = (title: string, value: any) =>
    `<td width="50%" align="left" valign="top" style="padding:6px 8px 6px 0">
       <div style="font-size:11px;letter-spacing:0.4px;text-transform:uppercase;color:#64748b;font-weight:700">${esc(title)}</div>
       <div style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.3">${esc(value)}</div>
     </td>`;

  const statRows = (stats: [string, any][]) => {
    const rows: string[] = [];
    for (let i = 0; i < stats.length; i += 2) {
      rows.push(`<tr>${card(stats[i][0], stats[i][1])}${stats[i + 1] ? card(stats[i + 1][0], stats[i + 1][1]) : '<td width="50%"></td>'}</tr>`);
    }
    return rows.join('');
  };

  const barList = (items: { name: string; count: number }[], maxCount: number) => items.map((it) => `
    <tr>
      <td style="padding:5px 12px 5px 0;color:#334155;font-size:13px;white-space:nowrap">${esc(it.name)}</td>
      <td style="padding:5px 0;width:100%">
        <div style="background:#e2e8f0;border-radius:4px;height:10px;max-width:280px">
          <div style="background:#0f172a;border-radius:4px;height:10px;width:${Math.max(4, Math.round((it.count / (maxCount || 1)) * 100))}%"></div>
        </div>
      </td>
      <td style="padding:5px 0 5px 10px;color:#0f172a;font-size:13px;font-weight:700;white-space:nowrap">${esc(it.count)}</td>
    </tr>`).join('');

  const stillCards = m.stillOnSite.length === 0
    ? `<p style="margin:0;color:#475569;font-size:13px">No visitors are currently on site.</p>`
    : m.stillOnSite.map((v: any) => `
    <div style="border:1px solid #e2e8f0;border-left:4px solid ${v.stayLabel === 'Normal' ? '#0ea5e9' : '#f59e0b'};border-radius:8px;padding:10px 12px;margin:0 0 8px">
      <div style="font-size:14px;font-weight:700;color:#0f172a">${esc(v.visitor)}${v.vehicle ? ` <span style="color:#64748b;font-weight:600">· ${esc(v.vehicle)}</span>` : ''}</div>
      <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:4px">
        <tr>
          <td style="font-size:12px;color:#64748b;padding:2px 0;white-space:nowrap">Entered: <b style="color:#334155">${esc(v.enteredAt)}</b></td>
          <td style="font-size:12px;color:#64748b;padding:2px 0;white-space:nowrap">Duration: <b style="color:#334155">${esc(v.duration)}</b></td>
        </tr>
        <tr>
          <td style="font-size:12px;color:#64748b;padding:2px 0;white-space:nowrap">Gate: <b style="color:#334155">${esc(v.entryGate)}</b></td>
          <td style="font-size:12px;color:#64748b;padding:2px 0;white-space:nowrap">Operator: <b style="color:#334155">${esc(v.entryUser)}</b></td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:12px;color:#64748b;padding:2px 0">${v.destination ? `Destination: <b style="color:#334155">${esc(v.destination)}</b> · ` : ''}Device: <b style="color:#334155">${esc(v.entryDevice)}</b> · Status: <b style="color:${v.stayLabel === 'Normal' ? '#0d9488' : '#b45309'}">${esc(v.status)} (${esc(v.stayLabel)})</b></td>
        </tr>
      </table>
    </div>`).join('');

  return `
  <p style="margin:0 0 12px;color:#475569;font-size:13px;line-height:1.6">
    <b style="color:#0f172a">Customer:</b> ${esc(m.meta.customerName)} &nbsp;·&nbsp;
    <b style="color:#0f172a">Site:</b> ${esc(m.meta.siteName)}<br/>
    <b style="color:#0f172a">Reporting Period:</b> ${esc(m.meta.reportingPeriod)} (${esc(m.meta.timezone)})<br/>
    <b style="color:#0f172a">Generated:</b> ${esc(m.meta.generatedAt)}
  </p>

  <h2 style="margin:20px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">Visitors Still On Site — ${esc(m.stillOnSite.length)}</h2>
  ${stillCards}

  <h2 style="margin:24px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">Executive Summary</h2>
  <table role="presentation" width="100%" style="border-collapse:collapse">${statRows([
    ['Total Entries', m.summary.totalEntries],
    ['Total Exits', m.summary.totalExits],
    ['Still On Site', m.summary.stillOnSite],
    ['Unique Visitors', m.summary.uniqueVisitors],
    ['Vehicle Entries', m.summary.vehicleEntries],
    ['Pedestrian Entries', m.summary.pedestrianEntries],
    ['Deliveries', m.summary.deliveries],
    ['Contractor Visits', m.summary.contractorVisits],
  ])}</table>

  <h2 style="margin:24px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">Top Destinations</h2>
  <table role="presentation" width="100%" style="border-collapse:collapse">${barList(m.topDestinations.slice(0, 5), m.topDestinations[0]?.count || 1)}</table>

  <h2 style="margin:24px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">Top Visit / Work Types</h2>
  <table role="presentation" width="100%" style="border-collapse:collapse">${barList(m.topVisitTypes.slice(0, 5), m.topVisitTypes[0]?.count || 1)}</table>

  <h2 style="margin:24px 0 8px;font-size:16px;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px">Gate Summary</h2>
  <table role="presentation" width="100%" style="border-collapse:collapse">
    ${m.gateSummary.map((g: any) => `<tr>
      <td style="padding:5px 12px 5px 0;font-size:13px;color:#334155;font-weight:600">${esc(g.gate)}</td>
      <td style="padding:5px 0;font-size:13px;color:#64748b">Entries: <b style="color:#0f172a">${esc(g.entries)}</b> &nbsp;·&nbsp; Exits: <b style="color:#0f172a">${esc(g.exits)}</b></td>
    </tr>`).join('') || '<tr><td style="font-size:13px;color:#64748b;padding:5px 0">No gate activity.</td></tr>'}
  </table>

  <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.6">
    The complete Entry/Exit Register, Device Activity, Operator Activity and Attention Required sections are included in the attached PDF report. A detailed CSV register is also attached.
  </p>`;
}

/* ── CSV register ──────────────────────────────────────────────────────── */

function csvCell(v: any): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildDailyAccessCsv(model: any): string {
  const header = [
    'Visitor', 'Vehicle', 'Visit Type', 'Work Type', 'Destination', 'Company',
    'Entry Timestamp', 'Entry Gate', 'Entry User', 'Entry Device',
    'Exit Timestamp', 'Exit Gate', 'Exit User', 'Exit Device', 'Duration', 'Status',
  ];
  const lines = [header.join(',')];
  for (const r of model.register) {
    lines.push([
      r.visitor, r.vehicle, r.visitType, r.workType, r.destination, r.company,
      r.entryTime, r.entryGate, r.entryUser, r.entryDevice,
      r.exitTime, r.exitGate, r.exitUser, r.exitDevice, r.duration, r.status,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n');
}

/* ── PDF (paginated, branded) ──────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const h = String(hex || '').replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(h)) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return [15, 118, 110]; // platform-neutral teal fallback
}

export function buildDailyAccessPdf(model: any, brand: any): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 36;
  const contentW = pageW - 2 * M;
  const [br, bg, bb] = hexToRgb(brand?.primary_color || '#0d9488');
  let y = 0;

  const contentBottom = () => pageH - 46;
  const gray = '#475569';
  const dark = '#0f172a';
  const line = '#cbd5e1';

  const brandBand = () => {
    doc.setFillColor(br, bg, bb);
    doc.rect(0, 0, pageW, 58, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(String(brand?.brand_name || 'Unified Security Solutions'), M, 24);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('DAILY ACCESS CONTROL REPORT', M, 40);
    y = 74;
  };
  brandBand();

  const ensure = (h: number) => {
    if (y + h > contentBottom()) {
      doc.addPage();
      doc.setFillColor(br, bg, bb);
      doc.rect(0, 0, pageW, 20, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('DAILY ACCESS CONTROL REPORT', M, 13);
      y = 40;
    }
  };

  const section = (title: string) => {
    ensure(34);
    doc.setFillColor(br, bg, bb);
    doc.rect(M, y, contentW, 17, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(title.toUpperCase(), M + 7, y + 12);
    y += 26;
  };

  const metaRow = (label: string, value: string) => {
    ensure(14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(label, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(15, 23, 42);
    doc.text(String(value ?? ''), M + 92, y, { maxWidth: contentW - 92 });
    y += 14;
  };

  const statGrid = (stats: [string, any][]) => {
    const perRow = 4;
    const cellW = contentW / perRow;
    for (let i = 0; i < stats.length; i += perRow) {
      ensure(38);
      const row = stats.slice(i, i + perRow);
      row.forEach(([label, value], idx) => {
        const x = M + idx * cellW;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(100, 116, 139);
        doc.text(String(label).toUpperCase(), x, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(15, 23, 42);
        doc.text(String(value ?? 0), x, y + 15);
        if (idx < row.length - 1) {
          doc.setDrawColor(203, 213, 225);
          doc.line(x + cellW - 10, y - 6, x + cellW - 10, y + 16);
        }
      });
      y += 38;
    }
  };

  const table = (cols: { label: string; width: number; get: (r: any) => string }[], rows: any[]) => {
    const drawHeader = () => {
      ensure(20);
      doc.setFillColor(241, 245, 249);
      doc.rect(M, y - 3, contentW, 14, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      let x = M + 3;
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x, y + 7, { maxWidth: c.width - 4 });
        x += c.width;
      }
      y += 17;
    };
    drawHeader();
    let alt = false;
    for (const r of rows) {
      const cells = cols.map((c) => doc.splitTextToSize(String(c.get(r) ?? ''), c.width - 5) as string[]);
      const rowH = Math.max(...cells.map((l) => l.length)) * 8.5 + 5;
      if (y + rowH > contentBottom()) { drawHeader(); alt = false; }
      if (alt) {
        doc.setFillColor(248, 250, 252);
        doc.rect(M, y - 3, contentW, rowH, 'F');
      }
      alt = !alt;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      let x = M + 3;
      cells.forEach((lines, ci) => {
        doc.text(lines, x, y + 4);
        x += cols[ci].width;
      });
      y += rowH;
      doc.setDrawColor(226, 232, 240);
      doc.line(M, y - 3, M + contentW, y - 3);
    }
    if (!rows.length) {
      ensure(14);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text('No records.', M, y);
      y += 16;
    }
  };

  const para = (text: string) => {
    ensure(16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    ensure(lines.length * 11 + 6);
    doc.text(lines, M, y);
    y += lines.length * 11 + 8;
  };

  const m = model;
  void gray; void dark; void line;

  // PAGE 1 — branding header, meta, still on site, executive summary.
  metaRow('Customer', m.meta.customerName);
  metaRow('Site', m.meta.siteName);
  metaRow('Report Date', m.meta.reportDate);
  metaRow('Reporting Period', `${m.meta.reportingPeriod} (${m.meta.timezone})`);
  metaRow('Generated At', m.meta.generatedAt);

  section(`Visitors Still On Site — ${m.stillOnSite.length}`);
  table(
    [
      // Column widths sum to 483pt — within the 523pt content width, matching
      // every other report table (the previous 559pt total pushed the Status
      // column past the right page margin).
      { label: 'Visitor', width: 76, get: (r: any) => r.visitor },
      { label: 'Vehicle', width: 44, get: (r: any) => r.vehicle || '—' },
      { label: 'Entered', width: 72, get: (r: any) => r.enteredAt },
      { label: 'Duration', width: 34, get: (r: any) => r.duration },
      { label: 'Destination', width: 50, get: (r: any) => r.destination || '—' },
      { label: 'Gate', width: 32, get: (r: any) => r.entryGate },
      { label: 'Operator', width: 48, get: (r: any) => r.entryUser },
      { label: 'Device', width: 42, get: (r: any) => r.entryDevice },
      { label: 'Status', width: 85, get: (r: any) => `${r.status} (${r.stayLabel})` },
    ],
    m.stillOnSite
  );

  section('Executive Summary');
  statGrid([
    ['Total Entries', m.summary.totalEntries],
    ['Total Exits', m.summary.totalExits],
    ['Still On Site', m.summary.stillOnSite],
    ['Unique Visitors', m.summary.uniqueVisitors],
    ['Vehicle Entries', m.summary.vehicleEntries],
    ['Pedestrian Entries', m.summary.pedestrianEntries],
    ['Deliveries', m.summary.deliveries],
    ['Contractor Visits', m.summary.contractorVisits],
  ]);
  para(`Denied: ${m.summary.denied} · Blacklist overrides: ${m.summary.overrides} · Reporting timezone: ${m.meta.timezone}`);

  // FOLLOWING PAGES
  section('Complete Entry / Exit Register');
  table(
    [
      // 14 columns sum to 483pt (within the 523pt content width). The previous
      // 755pt total rendered the Exit-attribution, Duration and Status columns
      // beyond the physical page edge — completely invisible in the report.
      { label: 'Visitor', width: 54, get: (r: any) => r.visitor },
      { label: 'Vehicle', width: 30, get: (r: any) => r.vehicle || '—' },
      { label: 'Destination', width: 38, get: (r: any) => r.destination || '—' },
      { label: 'Purpose', width: 24, get: (r: any) => [r.visitType, r.workType].filter(Boolean).join(' / ') || '—' },
      { label: 'Entry', width: 62, get: (r: any) => r.entryTime },
      { label: 'E-Gate', width: 20, get: (r: any) => r.entryGate },
      { label: 'E-User', width: 30, get: (r: any) => r.entryUser },
      { label: 'E-Device', width: 26, get: (r: any) => r.entryDevice },
      { label: 'Exit', width: 62, get: (r: any) => r.exitTime },
      { label: 'X-Gate', width: 20, get: (r: any) => r.exitGate },
      { label: 'X-User', width: 30, get: (r: any) => r.exitUser },
      { label: 'X-Device', width: 26, get: (r: any) => r.exitDevice },
      { label: 'Duration', width: 24, get: (r: any) => r.duration },
      { label: 'Status', width: 37, get: (r: any) => r.status },
    ],
    m.register
  );

  section('Top Destinations');
  table(
    [
      { label: 'Destination', width: 400, get: (r: any) => r.name },
      { label: 'Entries', width: 83, get: (r: any) => String(r.count) },
    ],
    m.topDestinations
  );

  section('Top Visit / Work Types');
  table(
    [
      { label: 'Type', width: 400, get: (r: any) => r.name },
      { label: 'Entries', width: 83, get: (r: any) => String(r.count) },
    ],
    m.topVisitTypes
  );

  section('Access By Gate');
  table(
    [
      { label: 'Gate', width: 200, get: (r: any) => r.gate },
      { label: 'Entries', width: 141, get: (r: any) => String(r.entries) },
      { label: 'Exits', width: 142, get: (r: any) => String(r.exits) },
    ],
    m.gateSummary
  );

  section('Device Activity');
  table(
    [
      { label: 'Device', width: 160, get: (r: any) => r.device },
      { label: 'Entries', width: 70, get: (r: any) => String(r.entries) },
      { label: 'Exits', width: 70, get: (r: any) => String(r.exits) },
      { label: 'Last Activity', width: 183, get: (r: any) => r.lastActivity },
    ],
    m.deviceActivity
  );

  section('Access Activity By Operator');
  para('Operational accountability record of who processed entries and exits. Not a staff-performance ranking.');
  table(
    [
      { label: 'Operator', width: 240, get: (r: any) => r.operator },
      { label: 'Entries Processed', width: 121, get: (r: any) => String(r.entriesProcessed) },
      { label: 'Exits Processed', width: 122, get: (r: any) => String(r.exitsProcessed) },
    ],
    m.operatorActivity
  );

  section('Attention Required');
  for (const a of m.attention) para(`• ${a}`);
  if (!m.attention.length) para('No access exceptions requiring attention.');

  // Footer on every page: generated timestamp + page numbers.
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.line(M, pageH - 34, pageW - M, pageH - 34);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated ${m.meta.generatedAt} · ${m.meta.timezone}`, M, pageH - 22);
    doc.text(`Page ${i} of ${total}`, pageW - M, pageH - 22, { align: 'right' });
  }

  return new Uint8Array(doc.output('arraybuffer'));
}