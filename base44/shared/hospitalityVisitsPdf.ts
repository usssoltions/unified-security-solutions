/**
 * hospitalityVisitsPdf — server-side builder for the branded GRID GATE
 * Hospitality Visits PDF. Faithful port of the production frontend export
 * (src/lib/hospitalityExport.js exportVisitsPdf): landscape A4, site group
 * bands, totals band, both tenant logos (primary GRID GATE + secondary
 * customer logo as configured on the tenant brand), evidence/identity
 * numbers deliberately EXCLUDED.
 *
 * Server adaptations (behaviour-preserving):
 *  - Logos are fetched from the tenant brand's public URLs and embedded as
 *    PNG data URLs (the frontend's canvas JPEG re-encode is a browser-only
 *    optimisation; logos above ~1.5 MB are skipped rather than bloating the
 *    attachment).
 *  - Text uses the standard-14 Helvetica pair (the frontend embeds Nimbus
 *    Sans, a Helvetica-metric font, because browser viewers substitute
 *    standard-14 fonts; the server-rendered bytes carry no substitution).
 *  - Returns the PDF bytes (no doc.save) so the caller can attach or
 *    upload them.
 */
import { jsPDF } from 'npm:jspdf@2.5.2';

const HOSP_CATEGORY_LABELS: Record<string, string> = {
  check_in: 'Check Ins', contractor: 'Contractors', delivery: 'Deliveries',
  event_visitor: 'Event or Function Visitor', guest: 'Guests',
  service_provider: 'Service Provider', staff: 'Staff',
  uber_eats_mrd: 'Uber Eats / Mr D', uber: 'Uber', visitor: 'Visitors',
};

const PRESENCE_LABELS: Record<string, string> = {
  pending: 'Pending', cancelled: 'Cancelled', on_site: 'On site', exited: 'Exited',
  denied: 'Denied (blacklist)', void: 'Void', unknown: 'No entry record',
};

const ADMISSION_LABELS: Record<string, string> = {
  pending: 'Pending', confirming: 'Confirming', confirmed: 'Confirmed', cancelled: 'Cancelled',
};

const PARTY_LABELS: Record<string, string> = { reception: 'Reception', relevant_department: 'Relevant department' };

function parseTs(iso: any): Date | null {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  if (typeof iso !== 'string') return null;
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(`${s}Z`);
  return new Date(s);
}

function presenceOf(v: any): string {
  if (v.status === 'pending' || v.status === 'confirming') return 'pending';
  if (v.status === 'cancelled') return 'cancelled';
  const s = v.entry?.status;
  if (s === 'inside') return 'on_site';
  if (s === 'exited') return 'exited';
  if (s === 'blacklisted' || s === 'denied') return 'denied';
  if (s === 'voided') return 'void';
  return 'unknown';
}

const yesNo = (b: any) => (b === true ? 'Yes' : b === false ? 'No' : 'N/A');
const maskPhone = (p: any) => (p ? String(p).replace(/.(?=.{4})/g, '\u2022') : '\u2014');

function confirmationText(v: any): string {
  if (!v.confirmation_party && v.category !== 'visitor') return 'Not required';
  if (v.category === 'visitor') {
    if (v.room_number_source === 'provided') return 'Not required — visitor knew room';
    if (v.room_number_source === 'confirmed_by_reception') return `Reception: ${yesNo(v.reception_confirmed)}`;
    return '\u2014';
  }
  return `${PARTY_LABELS[v.confirmation_party] || '\u2014'}: ${yesNo(v.reception_confirmed)}`;
}

function evidenceCount(v: any): number {
  return (v.vehicle_photo_count || 0) + (v.staff_declaration_photo_count || 0) +
    ['firearm_photo_present', 'po_invoice_photo_present', 'food_photo_present', 'delivery_person_photo_present', 'identity_document_photo_present']
      .filter((k) => v[k]).length;
}

function computeTotals(visits: any[]) {
  const t: any = { total: visits.length, byPresence: {} as Record<string, number>, byCategory: {} as Record<string, number> };
  for (const v of visits) {
    const p = presenceOf(v);
    t.byPresence[p] = (t.byPresence[p] || 0) + 1;
    t.byCategory[v.category] = (t.byCategory[v.category] || 0) + 1;
  }
  return t;
}

// ── Compact SAST time formatting: "01 Oct 14:35" ─────────────────────────────
const SAST_TZ = 'Africa/Johannesburg';
const sastFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: SAST_TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtSastCell = (iso: any) => {
  const d = parseTs(iso);
  return d && !isNaN(d.getTime()) ? sastFmt.format(d).replace(',', '') : '\u2014';
};

function hexRgb(hex?: string | null): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0x062b49;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── Server-side logo embedding: fetch once, embed as data URL ────────────────
async function fetchLogo(url?: string | null): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  try {
    const res = await fetch(String(url));
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 1_500_000) return null; // never bloat the attachment
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH) as any);
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    return `data:${type};base64,${btoa(bin)}`;
  } catch (_) {
    return null; // never block the report on logo processing
  }
}

function addLogo(doc: any, dataUrl: string | null, x: number, y: number, maxW: number, maxH: number, alignRight: boolean) {
  if (!dataUrl) return;
  try {
    const p = doc.getImageProperties(dataUrl);
    const r = Math.min(maxW / p.width, maxH / p.height);
    const w = p.width * r, h = p.height * r;
    doc.addImage(dataUrl, alignRight ? x - w : x, y, w, h);
  } catch (_) { /* logo optional */ }
}

// PDF columns: [label, weight, getter]. Weights are scaled to fill the full
// printable width; long values wrap (never truncated).
const PDF_COLS: [string, number, (v: any) => string][] = [
  ['Created', 20, (v) => fmtSastCell(v.created_date)],
  ['Category', 38, (v) => HOSP_CATEGORY_LABELS[v.category] || v.category],
  ['Name', 40, (v) => v.person_name || ''],
  ['Room', 8, (v) => v.room_number || ''],
  ['Occ.', 6, (v) => String(v.occupant_count ?? '')],
  ['Admission', 15, (v) => ADMISSION_LABELS[v.status] || v.status],
  ['Presence', 19, (v) => PRESENCE_LABELS[presenceOf(v)]],
  ['Entry', 20, (v) => fmtSastCell(v.entry?.entry_time)],
  ['Exit', 20, (v) => fmtSastCell(v.entry?.exit_time)],
  ['Processed by', 29, (v) => v.entry?.guard_name || v.created_by_guard_name || ''],
];

export async function buildHospitalityVisitsPdf(
  visits: any[],
  brand: any,
  filterSummary: string,
): Promise<Uint8Array> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const W = 297, H = 210, M = 8;
  const W2 = W - 2 * M;
  const primary = hexRgb(brand?.primary_color);

  const FONT = 8, LINE = 3.0, PADX = 1.2, ROW_MIN = 4.2, HEAD_H = 4.6, BAND_H = 4.8;
  const BOTTOM = H - 7.5;

  const weightSum = PDF_COLS.reduce((n, [, w]) => n + w, 0);
  const COLS = PDF_COLS.map(([h, w, f]) => [h, (w / weightSum) * W2, f] as [string, number, (v: any) => string]);
  const colX: number[] = [];
  let cx = M;
  COLS.forEach(([, w]) => { colX.push(cx); cx += w; });

  const siteKey = (v: any) => v.site_name || '(Unspecified site)';
  const siteNames = [...new Set(visits.map(siteKey))];
  const oneSite = siteNames.length === 1;
  const siteLine = oneSite
    ? `Site: ${siteNames[0]}`
    : `Sites: ${siteNames.length} — ${siteNames.slice(0, 4).join(', ')}${siteNames.length > 4 ? ', \u2026' : ''}`;

  const logoPrimary = await fetchLogo(brand?.logo_url);
  const logoSecondary = await fetchLogo(brand?.document_secondary_logo_url || brand?.secondary_logo_url);

  let y = 0;
  let pageIndex = 0;

  const drawColHead = (yy: number) => {
    doc.setFillColor(...primary);
    doc.rect(M, yy, W2, HEAD_H, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT);
    COLS.forEach(([h], i) => doc.text(h, colX[i] + PADX, yy + 3.2));
    return yy + HEAD_H;
  };

  const startPage = (showTotals: boolean) => {
    if (pageIndex > 0) doc.addPage();
    pageIndex++;
    let hy = 3;
    addLogo(doc, logoPrimary, M, hy, 40, 9.5, false);
    addLogo(doc, logoSecondary, W - M, hy + 0.5, 36, 8.5, true);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...primary);
    doc.text(`${brand?.brand_name || ''} — Hospitality Visits`, W / 2, hy + 3.4, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90);
    const subLines: string[] = doc.splitTextToSize(`${filterSummary}  ·  ${siteLine}`, W2);
    subLines.forEach((ln, i) => doc.text(ln, W / 2, hy + 6.8 + i * 2.8, { align: 'center' }));
    const subExtra = (subLines.length - 1) * 2.8;
    const dividerY = hy + 10.2 + subExtra;
    doc.setDrawColor(...primary); doc.setLineWidth(0.4); doc.line(M, dividerY, W - M, dividerY);
    let yy = dividerY + 3.6;
    if (showTotals) {
      const t = computeTotals(visits);
      const presence = Object.entries(t.byPresence).map(([k, n]) => `${PRESENCE_LABELS[k]}: ${n}`).join(' · ');
      const categories = Object.entries(t.byCategory).map(([k, n]) => `${HOSP_CATEGORY_LABELS[k]} ${n}`).join(' · ');
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(30);
      doc.text(`Total visits: ${t.total} — ${presence}`, M, yy);
      doc.setTextColor(110);
      doc.text('All times SAST (Africa/Johannesburg, UTC+2)', W - M, yy, { align: 'right' });
      yy += 2.6;
      doc.setTextColor(90);
      const catLines: string[] = doc.splitTextToSize(`By category: ${categories}`, W2);
      doc.text(catLines, M, yy);
      yy += 2.6 * (catLines.length - 1) + 2.0;
    }
    y = drawColHead(yy);
  };

  const drawRow = (cells: string[], fill: boolean) => {
    const wrapped: string[][] = cells.map((s, i) => doc.splitTextToSize(String(s ?? ''), COLS[i][1] - 2 * PADX));
    const lines = Math.max(1, ...wrapped.map((a) => a.length));
    const rowH = Math.max(ROW_MIN, lines * LINE + 1.0);
    if (y + rowH > BOTTOM) startPage(false);
    if (fill) { doc.setFillColor(242, 245, 249); doc.rect(M, y, W2, rowH, 'F'); }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(FONT); doc.setTextColor(30);
    wrapped.forEach((ws, i) => ws.forEach((ln, li) => doc.text(ln, colX[i] + PADX, y + 3.0 + li * LINE)));
    y += rowH;
  };

  const drawSiteBand = (name: string, count: number) => {
    if (y + BAND_H > BOTTOM) startPage(false);
    doc.setFillColor(...primary); doc.rect(M, y, W2, BAND_H, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(FONT);
    doc.text(`Site — ${name} (${count} ${count === 1 ? 'visit' : 'visits'})`, M + PADX, y + 3.4);
    y += BAND_H;
  };

  startPage(true);

  const rows = oneSite
    ? visits.map((v) => ({ v, band: null as string | null }))
    : [...siteNames].sort()
        .flatMap((sn) => [
          { band: sn, count: visits.filter((v) => siteKey(v) === sn).length, v: null as any },
          ...visits.filter((v) => siteKey(v) === sn).map((v) => ({ band: null as string | null, count: 0, v })),
        ]);

  let stripe = false;
  for (const r of rows) {
    if (r.band) { drawSiteBand(r.band, r.count); stripe = false; continue; }
    drawRow(COLS.map(([, , f]) => f(r.v)), stripe);
    stripe = !stripe;
  }

  const pages = doc.getNumberOfPages();
  const now = fmtSastCell(new Date().toISOString());
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(
      `Generated ${now} SAST · Evidence and identity numbers are excluded from this report · Page ${p} of ${pages}`,
      W / 2, H - 4, { align: 'center' },
    );
  }
  return new Uint8Array(doc.output('arraybuffer'));
}