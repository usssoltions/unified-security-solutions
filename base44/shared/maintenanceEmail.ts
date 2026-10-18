/**
 * maintenanceEmail — the maintenance-request alert EMAIL renderer.
 *
 * Clean, professional, mobile-safe presentation for the tenant-branded
 * maintenance-request alert: compact brand header (customer logo when
 * configured, professional text fallback), urgency severity chip, a labelled
 * detail table (request ID, category, urgency, site, location/checkpoint,
 * reporter, date/time), a clearly-separated human-entered description block,
 * and ONE prominent "Open Maintenance Request" button.
 *
 * The stored request record's internal report template (concatenated labels,
 * technical sections) is NEVER rendered — only the human-entered details pass
 * through humanMaintenanceDescription(); the full record stays in the app.
 * Branding resolves through the ONE shared brand (customer → reseller → USS
 * platform fallback), rendered by the central transactional shell.
 */
import { escHtml, renderTransactionalShell, detailRowsHtml, severityChip, friendlyLabel } from './transactionalEmail.ts';

const URGENCY_SEVERITY: Record<string, string> = {
  critical: 'critical', emergency: 'critical',
  high: 'high',
  medium: 'medium', routine: 'medium',
  low: 'low',
};

/**
 * Human-entered details only. Prefers the caller-provided details text;
 * otherwise extracts ONLY the "Details:" section from the stored structured
 * report — the record's internal section labels/headers never reach the email.
 */
export function humanMaintenanceDescription(
  rawDetails: string | null | undefined,
  storedDescription: string | null | undefined,
): string {
  const details = String(rawDetails ?? '').trim();
  if (details) return details;
  const stored = String(storedDescription ?? '');
  const m = /(?:^|\n)\s*Details:\s*([\s\S]*?)(?:\n\s*\n|\n\s*NOTIFICATION\b|$)/i.exec(stored);
  return m ? m[1].trim() : '';
}

export function buildMaintenanceRequestEmail(p: {
  brand: any;
  requestRef: string;
  category: string;
  urgency: string;
  site: string;
  checkpoint?: string | null;
  locationText?: string | null;
  reporter: string;
  reportedAt: string;
  description: string;
  ctaUrl?: string | null;
}): { html: string; text: string } {
  const brand = p.brand || {};
  const severity = URGENCY_SEVERITY[String(p.urgency || 'medium').toLowerCase()] || 'medium';
  const rows = [
    { label: 'Request ID', value: p.requestRef || '—' },
    { label: 'Category', value: p.category || '—' },
    { label: 'Urgency', value: String(p.urgency || 'medium').toUpperCase() },
    { label: 'Site', value: p.site || '—' },
    p.checkpoint ? { label: 'Location / Checkpoint', value: p.checkpoint } : null,
    p.locationText ? { label: 'GPS Location', value: p.locationText } : null,
    { label: 'Reporter', value: p.reporter || '—' },
    { label: 'Date / Time', value: p.reportedAt || '—' },
  ].filter(Boolean);

  const description = String(p.description || '').trim();
  const descHtml = description
    ? '<div style="margin:2px 0 4px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">' +
      '<div style="font-size:11px;font-weight:bold;letter-spacing:0.6px;color:#64748b;text-transform:uppercase;margin-bottom:6px">Description</div>' +
      description.split(/\r?\n/).map((line) =>
        '<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#0f172a;word-wrap:break-word;overflow-wrap:anywhere">' +
        (escHtml(line) || '&nbsp;') + '</p>').join('') +
      '</div>'
    : '';

  const html = renderTransactionalShell({
    brand,
    title: 'Maintenance Request',
    severity,
    preheader: 'New maintenance request' + (p.site ? ' at ' + p.site : '') + ' — review required',
    bodyHtml:
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">' +
      'A new maintenance request has been submitted and requires review.</p>' +
      detailRowsHtml(rows as any) +
      descHtml,
    cta: p.ctaUrl ? { label: 'Open Maintenance Request', url: p.ctaUrl } : null,
  });

  const textParts = [
    'Maintenance Request',
    '',
    ...rows.map((r: any) => r.label + ': ' + friendlyLabel(r.value)),
    description ? 'Description: ' + description : '',
    p.ctaUrl ? 'Open Maintenance Request: ' + p.ctaUrl : '',
    '',
    String(brand.brand_name || ''),
    [brand.support_email, brand.support_phone, brand.website].filter(Boolean).join(' | '),
    'This is an automated message - please do not reply directly.',
  ].filter((l) => l !== undefined && l !== null && l !== '');
  return { html, text: textParts.join('\n').replace(/\n{3,}/g, '\n\n') };
}