/**
 * opsReportPdfs — extracted PDF builders for the platform's OPERATIONS
 * report exports, in ONE shared module so the production dispatch functions
 * and the Report & Notification Showcase use the SAME code (no copies):
 *
 *   buildDailyActivityPdf       — ported from sendDailyActivityReport
 *   buildMonthlyIncidentPdf     — ported from generateMonthlyIncidentReport
 *   buildMonthlyMaintenancePdf  — ported from generateMonthlyMaintenanceReport
 *
 * ONE behavioural change, deliberate: the legacy builders hardcoded
 * 'UNIFIED SECURITY SOLUTIONS' + fixed header colours. The header band,
 * accent strip, title and footer now take the tenant's communication brand
 * (name + primary/accent colours), falling back to the exact original fixed
 * palette when no brand is available — production dispatch passes the brand
 * it already resolves, so live outputs gain correct tenant branding and
 * otherwise render exactly as before.
 */
import { jsPDF } from 'npm:jspdf@2.5.2';

function hexToRgb(hex?: string | null): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [30, 41, 59];
  return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
}

const calculateChange = (current: number, previous: number): string => {
  if (previous === 0) return current > 0 ? '100.0' : '0.0';
  return ((current - previous) / previous * 100).toFixed(1);
};

const sastMonthKey = (iso: any): string | null => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const sast = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  return `${sast.getUTCFullYear()}-${String(sast.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Partitions records into the NEWEST reported month (current) and the month
 *  before it (prev) in SAST — mirrors the production generators' month
 *  windows while remaining usable from demo-seeded data. */
function monthPartition(records: any[]): { current: any[]; prev: any[]; label: string } {
  const dated = (records || []).filter((r) => sastMonthKey(r.reported_at || r.created_date));
  if (!dated.length) return { current: [], prev: [], label: 'Current month' };
  const keys = dated.map((r) => sastMonthKey(r.reported_at || r.created_date) as string).sort();
  const currentKey = keys[keys.length - 1];
  const [cy, cm] = currentKey.split('-').map(Number);
  const prevKey = cm === 1 ? `${cy - 1}-12` : `${cy}-${String(cm - 1).padStart(2, '0')}`;
  const monthLabel = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    current: dated.filter((r) => sastMonthKey(r.reported_at || r.created_date) === currentKey),
    prev: dated.filter((r) => sastMonthKey(r.reported_at || r.created_date) === prevKey),
    label: monthLabel(cy, cm),
  };
}

function brandPalette(brand: any) {
  return {
    header: hexToRgb(brand?.primary_color || '#1e293b') as number[],
    accent: hexToRgb(brand?.accent_color || '#dc2626') as number[],
    name: brand?.brand_name || 'UNIFIED SECURITY SOLUTIONS',
  };
}

function footerBand(doc: any, pageWidth: number, pageHeight: number, name: string) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const footerY = pageHeight - 20;
    doc.setFillColor(30, 41, 59);
    doc.rect(0, footerY, pageWidth, 20, 'F');
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.text(name, pageWidth / 2, footerY + 8, { align: 'center' });
    doc.text(`Report Generated: ${new Date().toLocaleString()} | Page ${i} of ${totalPages}`, pageWidth / 2, footerY + 14, { align: 'center' });
  }
}

// ── DAILY ACTIVITY REPORT ────────────────────────────────────────────────────
export function buildDailyActivityPdf(date: string, stats: any, brand: any): Uint8Array {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;
  const brandName = brand?.brand_name || 'Unified Security Solutions';
  const brandRgb = hexToRgb(brand?.primary_color);

  doc.setFillColor(...brandRgb);
  doc.rect(0, 0, pageW, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('DAILY ACTIVITY REPORT', pageW / 2, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(date, pageW / 2, 32, { align: 'center' });
  doc.setFontSize(10);
  doc.text(brandName, pageW / 2, 40, { align: 'center' });

  let y = 58;
  doc.setTextColor(26, 26, 26);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary Statistics', margin, y);
  y += 6;

  const statBoxes = [
    { label: 'Incidents', value: stats.incidents, color: brandRgb },
    { label: 'Maintenance', value: stats.maintenance, color: [14, 165, 233] },
    { label: 'Patrol Stops', value: stats.patrols, color: [16, 185, 129] },
    { label: 'Shifts', value: stats.shifts, color: [245, 158, 11] },
  ];
  const boxW = contentW / 4 - 3;
  statBoxes.forEach((box, i) => {
    const bx = margin + i * (boxW + 4);
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(bx, y, boxW, 22, 3, 3, 'F');
    doc.setFillColor(...box.color);
    doc.rect(bx, y, 3, 22, 'F');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(box.label, bx + 6, y + 8);
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(String(box.value), bx + 6, y + 18);
  });
  y += 30;

  doc.setTextColor(26, 26, 26);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Operational Summary', margin, y + 8);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  const summaryLines: string[] = doc.splitTextToSize(stats.summary, contentW);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 5 + 8;

  doc.setFillColor(240, 253, 244);
  doc.roundedRect(margin, y, contentW, 24, 3, 3, 'F');
  doc.setTextColor(22, 101, 52);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Pending Items', margin + 4, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Open Incidents: ${stats.openIncidents}`, margin + 4, y + 16);
  doc.text(`Pending Maintenance: ${stats.pendingMaintenance}`, margin + 60, y + 16);

  doc.setFillColor(...hexToRgb(brand?.accent_color || '#1a1a1a'));
  doc.rect(0, 285, pageW, 12, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Automated Daily Report — ${brandName}`, pageW / 2, 292, { align: 'center' });

  return new Uint8Array(doc.output('arraybuffer'));
}

// ── MONTHLY INCIDENT ANALYSIS ────────────────────────────────────────────────
export function buildMonthlyIncidentPdf(p: { records: any[]; brand: any }): { bytes: Uint8Array; stats: any; period: string } {
  const { current: currentIncidents, prev: prevIncidents, label } = monthPartition(p.records);
  const brand = brandPalette(p.brand);
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  let yPos = 20;

  // BRANDED HEADER (tenant brand; falls back to the original fixed palette)
  doc.setFillColor(...brand.header);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFillColor(...brand.accent);
  doc.rect(0, 40, pageWidth, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text(brand.name, pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Professional Security Management & Advisory', pageWidth / 2, 23, { align: 'center' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MONTHLY INCIDENT ANALYSIS REPORT', pageWidth / 2, 35, { align: 'center' });

  yPos = 55;
  doc.setFillColor(248, 250, 252);
  doc.rect(15, yPos, pageWidth - 30, 12, 'F');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Reporting Period: ${label}`, pageWidth / 2, yPos + 8, { align: 'center' });
  yPos += 20;

  const incidentsByCategory: Record<string, number> = currentIncidents.reduce((acc: any, i: any) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {});
  const prevIncidentsByCategory: Record<string, number> = prevIncidents.reduce((acc: any, i: any) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {});
  const incidentsByPriority: Record<string, number> = currentIncidents.reduce((acc: any, i: any) => { acc[i.priority] = (acc[i.priority] || 0) + 1; return acc; }, {});
  const incidentsByStatus: Record<string, number> = currentIncidents.reduce((acc: any, i: any) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; }, {});
  const incidentsBySite: Record<string, number> = currentIncidents.reduce((acc: any, i: any) => { const site = i.site_name || 'Unknown'; acc[site] = (acc[site] || 0) + 1; return acc; }, {});

  const cardWidth = (pageWidth - 40) / 4;
  const cardHeight = 30;
  const cardSpacing = 2;
  const criticalCount = currentIncidents.filter((i: any) => i.priority === 'critical').length;
  const highCount = currentIncidents.filter((i: any) => i.priority === 'high').length;
  const resolvedCount = currentIncidents.filter((i: any) => i.status === 'resolved' || i.status === 'closed').length;
  const resolutionRate = currentIncidents.length > 0 ? ((resolvedCount / currentIncidents.length) * 100).toFixed(1) : '0';

  const metrics = [
    { label: 'Total Incidents', current: currentIncidents.length, prev: prevIncidents.length, color: [220, 38, 38] },
    { label: 'Critical Priority', current: criticalCount, prev: prevIncidents.filter((i: any) => i.priority === 'critical').length, color: [239, 68, 68] },
    { label: 'High Priority', current: highCount, prev: prevIncidents.filter((i: any) => i.priority === 'high').length, color: [251, 146, 60] },
    { label: 'Resolution Rate', current: `${resolutionRate}%`, prev: 'N/A', color: [34, 197, 94] },
  ];
  metrics.forEach((metric, idx) => {
    const x = 15 + idx * (cardWidth + cardSpacing);
    doc.setFillColor(...metric.color);
    doc.rect(x, yPos, cardWidth, cardHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(metric.label.toUpperCase(), x + cardWidth / 2, yPos + 7, { align: 'center' });
    doc.setFontSize(20);
    doc.text(metric.current.toString(), x + cardWidth / 2, yPos + 18, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Prev: ${metric.prev}`, x + cardWidth / 2, yPos + 25, { align: 'center' });
  });
  yPos += cardHeight + 15;

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('INCIDENT CATEGORIES - MONTH COMPARISON', 15, yPos);
  yPos += 10;
  const allCategories = [...new Set([...Object.keys(incidentsByCategory), ...Object.keys(prevIncidentsByCategory)])];
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('Category', 15, yPos);
  doc.text('Current', 70, yPos);
  doc.text('Previous', 100, yPos);
  doc.text('Change', 130, yPos);
  doc.text('Trend', 160, yPos);
  yPos += 5;
  doc.setDrawColor(...brand.accent);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  allCategories.forEach((cat) => {
    const currentCount = incidentsByCategory[cat] || 0;
    const prevCount = prevIncidentsByCategory[cat] || 0;
    const change = calculateChange(currentCount, prevCount);
    const maxCount = Math.max(currentCount, prevCount, 1);
    doc.text(cat.replace(/_/g, ' ').substring(0, 18), 15, yPos);
    doc.text(currentCount.toString(), 75, yPos);
    doc.text(prevCount.toString(), 105, yPos);
    doc.text(`${Number(change) > 0 ? '+' : ''}${change}%`, 135, yPos);
    if (currentCount > prevCount) { doc.setTextColor(220, 38, 38); doc.text('\u2191', 165, yPos); }
    else if (currentCount < prevCount) { doc.setTextColor(34, 197, 94); doc.text('\u2193', 165, yPos); }
    else { doc.setTextColor(100, 100, 100); doc.text('\u2192', 165, yPos); }
    doc.setFillColor(...brand.accent);
    doc.rect(80, yPos - 3, (currentCount / maxCount) * 25, 4, 'F');
    doc.setFillColor(148, 163, 184);
    doc.rect(110, yPos - 3, (prevCount / maxCount) * 25, 4, 'F');
    doc.setTextColor(30, 41, 59);
    yPos += 7;
  });
  yPos += 10;

  doc.addPage();
  yPos = 20;
  doc.setFillColor(...brand.accent);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('INCIDENT PRIORITY DISTRIBUTION', 20, yPos);
  yPos += 20;

  const priorities = ['critical', 'high', 'medium', 'low'];
  const priorityColors: Record<string, number[]> = { critical: [220, 38, 38], high: [251, 146, 60], medium: [59, 130, 246], low: [34, 197, 94] };
  const chartHeight = 80;
  const maxPriorityCount = Math.max(...priorities.map((p) => incidentsByPriority[p] || 0), 1);
  priorities.forEach((priority, idx) => {
    const count = incidentsByPriority[priority] || 0;
    const barHeight = (count / maxPriorityCount) * chartHeight;
    const x = 30 + idx * 40;
    doc.setFillColor(...priorityColors[priority]);
    doc.rect(x, yPos + chartHeight - barHeight, 30, barHeight, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(count.toString(), x + 15, yPos + chartHeight - barHeight - 5, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(priority.toUpperCase(), x + 15, yPos + chartHeight + 8, { align: 'center' });
  });
  yPos += chartHeight + 20;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('INCIDENT STATUS OVERVIEW', 15, yPos);
  yPos += 10;
  const statuses = Object.entries(incidentsByStatus).sort((a: any, b: any) => b[1] - a[1]);
  const statusColors: Record<string, number[]> = { reported: [239, 68, 68], assigned: [251, 146, 60], in_progress: [59, 130, 246], resolved: [34, 197, 94], closed: [148, 163, 184] };
  statuses.forEach(([status, count]) => {
    const percentage = ((Number(count) / currentIncidents.length) * 100).toFixed(1);
    const barWidth = (Number(count) / currentIncidents.length) * (pageWidth - 100);
    doc.setFillColor(...(statusColors[status] || [100, 100, 100]));
    doc.rect(80, yPos - 4, barWidth, 8, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(String(status).replace(/_/g, ' '), 15, yPos);
    doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
    yPos += 12;
  });
  yPos += 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('TOP INCIDENT LOCATIONS', 15, yPos);
  yPos += 10;
  const topSites = Object.entries(incidentsBySite).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10);
  topSites.forEach(([site, count]: any) => {
    const percentage = ((Number(count) / currentIncidents.length) * 100).toFixed(1);
    const barWidth = (Number(count) / currentIncidents.length) * (pageWidth - 100);
    doc.setFillColor(...brand.accent);
    doc.rect(80, yPos - 4, barWidth, 8, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const siteName = site.length > 25 ? site.substring(0, 25) + '...' : site;
    doc.text(siteName, 15, yPos);
    doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
    yPos += 10;
  });

  doc.addPage();
  yPos = 20;
  doc.setFillColor(...brand.accent);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETAILED INCIDENT LOG', 20, yPos);
  yPos += 12;
  currentIncidents.forEach((incident: any, idx: number) => {
    if (yPos > pageHeight - 45) { doc.addPage(); yPos = 20; }
    const priorityColor = priorityColors[incident.priority] || [100, 100, 100];
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yPos - 5, pageWidth - 30, 38, 'F');
    doc.setFillColor(...priorityColor);
    doc.rect(15, yPos - 5, 3, 38, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${idx + 1}. ${String(incident.title).substring(0, 60)}`, 23, yPos);
    doc.setFillColor(...priorityColor);
    doc.roundedRect(pageWidth - 45, yPos - 4, 28, 6, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text(String(incident.priority).toUpperCase(), pageWidth - 31, yPos + 1, { align: 'center' });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    yPos += 6;
    doc.text(`Category: ${String(incident.category).replace(/_/g, ' ')} | Status: ${incident.status}`, 23, yPos);
    yPos += 5;
    doc.text(`Site: ${incident.site_name || 'N/A'} | Guard: ${incident.guard_name || 'N/A'}`, 23, yPos);
    yPos += 5;
    doc.text(`Reported: ${new Date(incident.reported_at || incident.created_date).toLocaleDateString()}`, 23, yPos);
    yPos += 5;
    const desc = incident.description || 'No description';
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(String(desc).substring(0, 110) + (desc.length > 110 ? '...' : ''), 23, yPos);
    yPos += 13;
  });

  doc.addPage();
  yPos = 20;
  doc.setFillColor(...brand.accent);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('STRATEGIC RECOMMENDATIONS', 20, yPos);
  yPos += 15;
  const recommendations = [
    { text: `Address ${criticalCount} critical incidents requiring immediate executive attention`, priority: 'high' },
    { text: `Review ${highCount} high-priority incidents for pattern identification`, priority: 'high' },
    { text: `Top incident category (${(Object.entries(incidentsByCategory).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'n/a').replace(/_/g, ' ')}) requires focused intervention`, priority: 'high' },
    { text: `Focus on site: ${Object.entries(incidentsBySite).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'n/a'} with highest incident rate`, priority: 'medium' },
    { text: `Resolution rate of ${resolutionRate}% - review response protocols`, priority: 'medium' },
    { text: `Implement preventive measures based on recurring incident patterns`, priority: 'medium' },
    { text: `Schedule quarterly board review of incident trends and mitigation strategies`, priority: 'low' },
  ];
  recommendations.forEach((rec, idx) => {
    const bgColor = rec.priority === 'high' ? [254, 226, 226] : rec.priority === 'medium' ? [255, 247, 237] : [240, 253, 244];
    const textColor = rec.priority === 'high' ? [153, 27, 27] : rec.priority === 'medium' ? [154, 52, 18] : [22, 101, 52];
    doc.setFillColor(...bgColor);
    doc.rect(15, yPos - 3, pageWidth - 30, 12, 'F');
    doc.setTextColor(...textColor);
    doc.text(`${idx + 1}.`, 20, yPos + 4);
    const lines: string[] = doc.splitTextToSize(rec.text, pageWidth - 50);
    doc.text(lines, 28, yPos + 4);
    yPos += Math.max(12, lines.length * 5 + 4);
  });

  footerBand(doc, pageWidth, pageHeight, brand.name);
  return {
    bytes: new Uint8Array(doc.output('arraybuffer')),
    stats: { totalIncidents: currentIncidents.length, criticalIncidents: criticalCount, highPriorityIncidents: highCount, resolutionRate },
    period: label,
  };
}

// ── MONTHLY MAINTENANCE ANALYSIS ─────────────────────────────────────────────
export function buildMonthlyMaintenancePdf(p: { records: any[]; brand: any }): { bytes: Uint8Array; stats: any; period: string } {
  const { current: currentMaintenance, prev: prevMaintenance, label } = monthPartition(p.records);
  const brand = brandPalette(p.brand);
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  let yPos = 20;

  doc.setFillColor(...brand.header);
  doc.rect(0, 0, pageWidth, 40, 'F');
  doc.setFillColor(...brand.accent);
  doc.rect(0, 40, pageWidth, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.text(brand.name, pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Professional Security Management & Advisory', pageWidth / 2, 23, { align: 'center' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MONTHLY MAINTENANCE ANALYSIS REPORT', pageWidth / 2, 35, { align: 'center' });

  yPos = 55;
  doc.setFillColor(248, 250, 252);
  doc.rect(15, yPos, pageWidth - 30, 12, 'F');
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`Reporting Period: ${label}`, pageWidth / 2, yPos + 8, { align: 'center' });
  yPos += 20;

  const maintenanceByCategory: Record<string, number> = currentMaintenance.reduce((acc: any, m: any) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {});
  const prevMaintenanceByCategory: Record<string, number> = prevMaintenance.reduce((acc: any, m: any) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {});
  const maintenanceByUrgency: Record<string, number> = currentMaintenance.reduce((acc: any, m: any) => { acc[m.urgency] = (acc[m.urgency] || 0) + 1; return acc; }, {});
  const maintenanceByStatus: Record<string, number> = currentMaintenance.reduce((acc: any, m: any) => { acc[m.status] = (acc[m.status] || 0) + 1; return acc; }, {});
  const maintenanceBySite: Record<string, number> = currentMaintenance.reduce((acc: any, m: any) => { const site = m.site_name || 'Unknown'; acc[site] = (acc[site] || 0) + 1; return acc; }, {});

  const cardWidth = (pageWidth - 40) / 4;
  const cardHeight = 30;
  const cardSpacing = 2;
  const criticalCount = currentMaintenance.filter((m: any) => m.urgency === 'critical').length;
  const highCount = currentMaintenance.filter((m: any) => m.urgency === 'high').length;
  const completedCount = currentMaintenance.filter((m: any) => m.status === 'completed').length;
  const completionRate = currentMaintenance.length > 0 ? ((completedCount / currentMaintenance.length) * 100).toFixed(1) : '0';

  const metrics = [
    { label: 'Total Requests', current: currentMaintenance.length, prev: prevMaintenance.length, color: [59, 130, 246] },
    { label: 'Critical Urgency', current: criticalCount, prev: prevMaintenance.filter((m: any) => m.urgency === 'critical').length, color: [220, 38, 38] },
    { label: 'High Urgency', current: highCount, prev: prevMaintenance.filter((m: any) => m.urgency === 'high').length, color: [251, 146, 60] },
    { label: 'Completion Rate', current: `${completionRate}%`, prev: 'N/A', color: [34, 197, 94] },
  ];
  metrics.forEach((metric, idx) => {
    const x = 15 + idx * (cardWidth + cardSpacing);
    doc.setFillColor(...metric.color);
    doc.rect(x, yPos, cardWidth, cardHeight, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text(metric.label.toUpperCase(), x + cardWidth / 2, yPos + 7, { align: 'center' });
    doc.setFontSize(20);
    doc.text(metric.current.toString(), x + cardWidth / 2, yPos + 18, { align: 'center' });
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`Prev: ${metric.prev}`, x + cardWidth / 2, yPos + 25, { align: 'center' });
  });
  yPos += cardHeight + 15;

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MAINTENANCE CATEGORIES - MONTH COMPARISON', 15, yPos);
  yPos += 10;
  const allCategories = [...new Set([...Object.keys(maintenanceByCategory), ...Object.keys(prevMaintenanceByCategory)])];
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('Category', 15, yPos);
  doc.text('Current', 70, yPos);
  doc.text('Previous', 100, yPos);
  doc.text('Change', 130, yPos);
  doc.text('Trend', 160, yPos);
  yPos += 5;
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.5);
  doc.line(15, yPos, pageWidth - 15, yPos);
  yPos += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  allCategories.forEach((cat) => {
    const currentCount = maintenanceByCategory[cat] || 0;
    const prevCount = prevMaintenanceByCategory[cat] || 0;
    const change = calculateChange(currentCount, prevCount);
    const maxCount = Math.max(currentCount, prevCount, 1);
    doc.text(cat.replace(/_/g, ' ').substring(0, 18), 15, yPos);
    doc.text(currentCount.toString(), 75, yPos);
    doc.text(prevCount.toString(), 105, yPos);
    doc.text(`${Number(change) > 0 ? '+' : ''}${change}%`, 135, yPos);
    if (currentCount > prevCount) { doc.setTextColor(220, 38, 38); doc.text('\u2191', 165, yPos); }
    else if (currentCount < prevCount) { doc.setTextColor(34, 197, 94); doc.text('\u2193', 165, yPos); }
    else { doc.setTextColor(100, 100, 100); doc.text('\u2192', 165, yPos); }
    doc.setFillColor(59, 130, 246);
    doc.rect(80, yPos - 3, (currentCount / maxCount) * 25, 4, 'F');
    doc.setFillColor(148, 163, 184);
    doc.rect(110, yPos - 3, (prevCount / maxCount) * 25, 4, 'F');
    doc.setTextColor(30, 41, 59);
    yPos += 7;
  });
  yPos += 10;

  doc.addPage();
  yPos = 20;
  doc.setFillColor(59, 130, 246);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MAINTENANCE URGENCY DISTRIBUTION', 20, yPos);
  yPos += 20;

  const urgencies = ['critical', 'high', 'medium', 'low'];
  const urgencyColors: Record<string, number[]> = { critical: [220, 38, 38], high: [251, 146, 60], medium: [59, 130, 246], low: [34, 197, 94] };
  const chartHeight = 80;
  const maxUrgencyCount = Math.max(...urgencies.map((u) => maintenanceByUrgency[u] || 0), 1);
  urgencies.forEach((urgency, idx) => {
    const count = maintenanceByUrgency[urgency] || 0;
    const barHeight = (count / maxUrgencyCount) * chartHeight;
    const x = 30 + idx * 40;
    doc.setFillColor(...urgencyColors[urgency]);
    doc.rect(x, yPos + chartHeight - barHeight, 30, barHeight, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(count.toString(), x + 15, yPos + chartHeight - barHeight - 5, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(urgency.toUpperCase(), x + 15, yPos + chartHeight + 8, { align: 'center' });
  });
  yPos += chartHeight + 20;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('MAINTENANCE STATUS OVERVIEW', 15, yPos);
  yPos += 10;
  const statuses = Object.entries(maintenanceByStatus).sort((a: any, b: any) => b[1] - a[1]);
  const statusColors: Record<string, number[]> = { reported: [239, 68, 68], assigned: [251, 146, 60], in_progress: [59, 130, 246], completed: [34, 197, 94], cancelled: [148, 163, 184] };
  statuses.forEach(([status, count]: any) => {
    const percentage = ((Number(count) / currentMaintenance.length) * 100).toFixed(1);
    const barWidth = (Number(count) / currentMaintenance.length) * (pageWidth - 100);
    doc.setFillColor(...(statusColors[status] || [100, 100, 100]));
    doc.rect(80, yPos - 4, barWidth, 8, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(String(status).replace(/_/g, ' '), 15, yPos);
    doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
    yPos += 12;
  });
  yPos += 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('TOP MAINTENANCE LOCATIONS', 15, yPos);
  yPos += 10;
  const topSites = Object.entries(maintenanceBySite).sort((a: any, b: any) => b[1] - a[1]).slice(0, 10);
  topSites.forEach(([site, count]: any) => {
    const percentage = ((Number(count) / currentMaintenance.length) * 100).toFixed(1);
    const barWidth = (Number(count) / currentMaintenance.length) * (pageWidth - 100);
    doc.setFillColor(59, 130, 246);
    doc.rect(80, yPos - 4, barWidth, 8, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const siteName = site.length > 25 ? site.substring(0, 25) + '...' : site;
    doc.text(siteName, 15, yPos);
    doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
    yPos += 10;
  });

  doc.addPage();
  yPos = 20;
  doc.setFillColor(59, 130, 246);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETAILED MAINTENANCE LOG', 20, yPos);
  yPos += 12;
  currentMaintenance.forEach((maint: any, idx: number) => {
    if (yPos > pageHeight - 45) { doc.addPage(); yPos = 20; }
    const urgencyColor = urgencyColors[maint.urgency] || [100, 100, 100];
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yPos - 5, pageWidth - 30, 38, 'F');
    doc.setFillColor(...urgencyColor);
    doc.rect(15, yPos - 5, 3, 38, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${idx + 1}. ${String(maint.title).substring(0, 60)}`, 23, yPos);
    doc.setFillColor(...urgencyColor);
    doc.roundedRect(pageWidth - 45, yPos - 4, 28, 6, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.text(String(maint.urgency).toUpperCase(), pageWidth - 31, yPos + 1, { align: 'center' });
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    yPos += 6;
    doc.text(`Category: ${String(maint.category).replace(/_/g, ' ')} | Status: ${maint.status}`, 23, yPos);
    yPos += 5;
    doc.text(`Site: ${maint.site_name || 'N/A'} | Guard: ${maint.guard_name || 'N/A'}`, 23, yPos);
    yPos += 5;
    doc.text(`Reported: ${new Date(maint.reported_at || maint.created_date).toLocaleDateString()}`, 23, yPos);
    yPos += 5;
    const desc = maint.description || 'No description';
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(String(desc).substring(0, 110) + (desc.length > 110 ? '...' : ''), 23, yPos);
    yPos += 13;
  });

  doc.addPage();
  yPos = 20;
  doc.setFillColor(59, 130, 246);
  doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('STRATEGIC RECOMMENDATIONS', 20, yPos);
  yPos += 15;
  const recommendations = [
    { text: `Address ${criticalCount} critical maintenance requests requiring immediate action`, priority: 'high' },
    { text: `Review ${highCount} high-urgency maintenance tasks for resource allocation`, priority: 'high' },
    { text: `Top maintenance category (${(Object.entries(maintenanceByCategory).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'n/a').replace(/_/g, ' ')}) requires focused planning`, priority: 'high' },
    { text: `Focus on site: ${Object.entries(maintenanceBySite).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] || 'n/a'} with highest maintenance needs`, priority: 'medium' },
    { text: `Completion rate of ${completionRate}% - evaluate maintenance response efficiency`, priority: 'medium' },
    { text: `Develop preventive maintenance schedules for recurring issues`, priority: 'medium' },
    { text: `Schedule quarterly asset condition reviews with maintenance team`, priority: 'low' },
  ];
  recommendations.forEach((rec, idx) => {
    const bgColor = rec.priority === 'high' ? [254, 226, 226] : rec.priority === 'medium' ? [255, 247, 237] : [240, 253, 244];
    const textColor = rec.priority === 'high' ? [153, 27, 27] : rec.priority === 'medium' ? [154, 52, 18] : [22, 101, 52];
    doc.setFillColor(...bgColor);
    doc.rect(15, yPos - 3, pageWidth - 30, 12, 'F');
    doc.setTextColor(...textColor);
    doc.text(`${idx + 1}.`, 20, yPos + 4);
    const lines: string[] = doc.splitTextToSize(rec.text, pageWidth - 50);
    doc.text(lines, 28, yPos + 4);
    yPos += Math.max(12, lines.length * 5 + 4);
  });

  footerBand(doc, pageWidth, pageHeight, brand.name);
  return {
    bytes: new Uint8Array(doc.output('arraybuffer')),
    stats: { totalMaintenance: currentMaintenance.length, criticalMaintenance: criticalCount, highUrgencyMaintenance: highCount, completionRate },
    period: label,
  };
}