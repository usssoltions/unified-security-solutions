/**
 * Server-side tenant branding + module-aware customer-facing wording.
 *
 * Used by invitation / account emails (inviteTenantUser) and mirrored for the
 * frontend in src/lib/branding.js (resolveBrand) and src/lib/roleCatalog.js
 * (ROLE_DISPLAY_NAMES / MODULE_DESCRIPTIONS / getRoleDescription).
 *
 * BRANDING HIERARCHY (strict order):
 *   1. Customer branding, if configured (Customer.app_name / logo_url /
 *      primary_color / accent_color / email / website)
 *   2. Reseller branding, for any field the customer does not define
 *      (Reseller.app_name / logo_url / colors / support_* / website)
 *   3. Platform defaults as final fallback
 *
 * MODULE-SPECIFIC NAMING: customer-facing wording (what the invitee can access,
 * role display names, role descriptions) is derived from the customer's
 * ENABLED modules — never from generic "security guard management" wording.
 */

function escHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

/**
 * Resolves the effective brand for a customer context. Customer fields win;
 * reseller fields fill the gaps; safe defaults complete the theme.
 */
export function resolveTenantBrand(customer: any, reseller: any) {
  const c = customer || {};
  const r = reseller || {};
  return {
    app_name: c.app_name || r.app_name || null,
    logo_url: c.logo_url || r.logo_url || null,
    primary_color: c.primary_color || r.primary_color || '#0ea5e9',
    accent_color: c.accent_color || r.accent_color || '#2563eb',
    support_email: c.email || r.support_email || null,
    website: c.website || r.website || null,
  };
}

/** The customer-facing organisation display name, customer-first. */
export function tenantDisplayName(customer: any, reseller: any): string {
  const c = customer || {};
  const r = reseller || {};
  return c.app_name || c.name || r.app_name || r.name || 'your organisation';
}

/** Operational (user-facing) modules, in display order. Support/engine modules
 *  (SecureScan Engine, Notification Engine, Messaging, Reporting) are never
 *  used in customer-facing invitation wording — they are infrastructure. */
export const OPERATIONAL_MODULE_ORDER: string[] = [
  'ATTENDANCE_REGISTER', 'OCCUPATIONAL_THERAPY', 'ESTATE',
  'ACCESS', 'PATROL', 'OPERATIONS', 'COMPLETE_SECURITY',
];

export const MODULE_LABELS: Record<string, string> = {
  ATTENDANCE_REGISTER: 'Attendance Register',
  OCCUPATIONAL_THERAPY: 'Occupational Therapy',
  ESTATE: 'Estate Management',
  ACCESS: 'Access Control',
  PATROL: 'Patrol',
  OPERATIONS: 'Operations',
  COMPLETE_SECURITY: 'Security Operations',
};

/** Module-aware functional descriptions — what a user of that module does.
 *  MIRRORED in src/lib/roleCatalog.js (MODULE_DESCRIPTIONS). */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  ATTENDANCE_REGISTER: 'Manage attendance records, workers/patients, reports and authorised scanning functions.',
  OCCUPATIONAL_THERAPY: 'Manage patients, appointments, clinical sessions and reports.',
  ESTATE: 'Manage residents, venues, vendors and estate services.',
  ACCESS: 'Manage visitor access, QR scanning and access history.',
  PATROL: 'Manage patrols, checklists and route monitoring.',
  OPERATIONS: 'Manage control room operations, incidents, shifts and sites.',
  COMPLETE_SECURITY: 'Manage security operations, incidents, patrols and shifts.',
};

/** Friendly role display names — NEVER expose internal role keys like
 *  "user" or raw snake_case values in customer-facing text.
 *  MIRRORED in src/lib/roleCatalog.js (INVITE_ROLE_LABELS). */
export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  reseller_admin: 'Reseller Administrator',
  customer_admin: 'Customer Administrator',
  admin: 'Operations Administrator',
  dispatcher: 'Dispatcher',
  guard: 'Security Guard',
  estate_manager: 'Estate Manager',
  resident: 'Resident',
  vendor: 'Vendor',
  practice_admin: 'Practice Administrator',
  therapist: 'Therapist',
  reception: 'Reception',
  attendance_staff: 'Attendance Staff',
};

export function roleDisplay(roleType: string): string {
  return ROLE_DISPLAY_NAMES[roleType] || String(roleType || '').replace(/_/g, ' ');
}

export function operationalModuleKeys(enabledKeys: string[] = []): string[] {
  return OPERATIONAL_MODULE_ORDER.filter((k) => (enabledKeys || []).includes(k));
}

/**
 * Module-aware role description. For Customer Administrator the description
 * covers ALL enabled operational modules (for an attendance-only customer this
 * is exactly the attendance description — no security/estate/medical wording).
 */
export function roleDescriptionForModules(roleType: string, enabledKeys: string[] = []): string {
  if (roleType === 'reseller_admin') {
    return 'Administer the reseller organisation, its customers, licences and users.';
  }
  const descs = operationalModuleKeys(enabledKeys)
    .map((k) => MODULE_DESCRIPTIONS[k])
    .filter(Boolean);
  if (!descs.length) {
    return 'Administrative access to the modules enabled for your organisation.';
  }
  if (roleType === 'customer_admin') return descs.join(' ');
  return descs[0];
}

/**
 * Builds the branded, module-aware invitation / access-update email.
 * kind: 'invite' | 'resent' | 'updated'.
 */
export function buildInvitationEmail(p: {
  brand: any; displayName: string; role_type: string; enabledModuleKeys?: string[];
  inviteeName?: string | null; inviterName?: string | null; kind?: string;
}): { subject: string; body: string } {
  const brand = p.brand || {};
  const displayName = p.displayName || 'your organisation';
  const role = roleDisplay(p.role_type);
  const desc = roleDescriptionForModules(p.role_type, p.enabledModuleKeys || []);
  const moduleNames = operationalModuleKeys(p.enabledModuleKeys || [])
    .map((k) => MODULE_LABELS[k]).filter(Boolean);
  const updated = p.kind === 'updated';
  const subject = updated
    ? `Your access to ${displayName} has been updated`
    : `You've been invited to ${displayName}`;
  const accessLine = moduleNames.length
    ? `${displayName} has invited you to access its ${moduleNames[0]}${moduleNames.length > 1 ? ` and ${moduleNames.slice(1).join(' and ')}` : ''}.`
    : `${displayName} has invited you to join.`;
  const greeting = p.inviteeName ? `Hi ${escHtml(String(p.inviteeName).trim().split(/\s+/)[0])},` : 'Hello,';

  const body = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
  ${brand.logo_url ? `<div style="padding:20px;text-align:center;background:#f8fafc"><img src="${escHtml(brand.logo_url)}" alt="${escHtml(displayName)}" style="max-height:56px;max-width:180px;object-fit:contain"/></div>` : ''}
  <div style="padding:24px 28px">
    <h2 style="color:${escHtml(brand.primary_color)};margin:0 0 12px">${escHtml(subject)}</h2>
    <p style="color:#334155;margin:0 0 8px">${greeting}</p>
    ${updated
      ? `<p style="color:#334155;margin:0 0 8px">Your access to <b>${escHtml(displayName)}</b> has been updated to <b>${escHtml(role)}</b>.</p>`
      : `<p style="color:#334155;margin:0 0 8px">${escHtml(accessLine)}</p>
    <p style="color:#334155;margin:0 0 8px">Your role: <b>${escHtml(role)}</b></p>`}
    <p style="color:#64748b;font-size:14px;margin:0 0 12px">${escHtml(desc)}</p>
    ${p.inviterName ? `<p style="color:#334155;margin:0 0 12px">${updated ? 'Updated' : 'Invited'} by ${escHtml(p.inviterName)}.</p>` : ''}
    ${updated
      ? '<p style="color:#334155;margin:0">Sign in to the app to see your updated workspace.</p>'
      : '<p style="color:#94a3b8;font-size:12px;margin:0">Use the invitation link sent to this email address to set up your account and sign in.</p>'}
  </div>
  <div style="padding:14px 28px;background:#f8fafc;color:#94a3b8;font-size:11px">
    ${brand.support_email ? `Questions? Contact ${escHtml(brand.support_email)}.` : ''}
    ${brand.website ? `&nbsp;&bull;&nbsp; ${escHtml(brand.website)}` : ''}
  </div>
</div>`;
  return { subject, body };
}