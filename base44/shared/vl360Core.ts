/**
 * vl360Core — SHARED validation + role helpers for the USS VOICELINK 360
 * module. Used by the vl360Access gateway (server-side authority) and mirrors
 * nothing else: the old Voice Link implementation is deliberately untouched
 * and unread.
 *
 * DESTINATION LINK POLICY (agreed): internal communication happens in Telegram
 * via the exact configured conversation; external telephone calls use the
 * installed Grandstream Wave Lite app with the customer's SIP service. USS
 * never implements Telegram calling APIs, never stores SIP credentials and
 * never invents deep-link schemes — only the formats validated below.
 */

export const VL_MODULE_KEY = 'VOICELINK360';

export const VL_ROLES = ['guard', 'supervisor', 'armed_response', 'control_room_operator', 'customer_admin'];

export const VL_ROLE_LABELS = {
  guard: 'Guard',
  supervisor: 'Supervisor',
  armed_response: 'Armed Response Officer',
  control_room_operator: 'Control Room Operator',
  customer_admin: 'Customer Administrator',
};

export function isVlRole(r: string): boolean {
  return VL_ROLES.includes(r);
}

/** VoiceLink role a platform role maps to when a profile is first provisioned. */
export function vlRoleForPlatformRole(roleType: string | null | undefined): string | null {
  switch (roleType) {
    case 'guard': return 'guard';
    case 'control_room_operator': return 'control_room_operator';
    case 'customer_admin': return 'customer_admin';
    case 'admin': return 'customer_admin';
    case 'dispatcher': return 'supervisor';
    default: return null;
  }
}

/**
 * Telegram destination validation — STRICT ALLOWLIST.
 * Accepted (Telegram's own documented link forms only — no invented schemes):
 *   https://t.me/<username>            (public user or group)
 *   https://telegram.me/<username>
 *   https://t.me/+<invitehash>         (private group invite link)
 *   https://t.me/joinchat/<hash>       (legacy private group invite link)
 *   tg://resolve?domain=<username>     (Telegram's official resolve scheme)
 * Everything else is rejected: http:, other hosts, javascript:, data:,
 * whitespace/control characters, malformed slugs.
 */
export function validateTelegramDest(raw: string): { ok: boolean; link?: string; error?: string } {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'empty' };
  if (/\s/.test(s) || /[\u0000-\u001f\u007f]/.test(s)) return { ok: false, error: 'malformed' };
  if (s.length > 300) return { ok: false, error: 'malformed' };
  const https = /^https:\/\/(t\.me|telegram\.me)\/((?:joinchat\/)?[A-Za-z0-9_+-]+)\/?$/.exec(s);
  if (https) {
    const slug = https[2].replace(/^joinchat\//, '');
    if (/^\+/.test(slug)) return { ok: true, link: s };
    if (/^[A-Za-z][A-Za-z0-9_]{3,64}$/.test(slug)) return { ok: true, link: s };
    return { ok: false, error: 'malformed' };
  }
  const tg = /^tg:\/\/resolve\?domain=([A-Za-z][A-Za-z0-9_]{3,64})$/.exec(s);
  if (tg) return { ok: true, link: s };
  return { ok: false, error: 'unsupported_format' };
}

/**
 * Telephone number validation — stored as a STRING. Leading zeroes and
 * international formatting are preserved; only dialling-safe characters are
 * accepted, so a number can never become a URI injection vector (it is never
 * placed into a tel:/intent URI by USS anyway — the Wave Lite handoff is an
 * honest assisted flow).
 */
export function validatePhoneNumber(raw: string): { ok: boolean; number?: string; error?: string } {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'empty' };
  if (s.length < 3 || s.length > 24) return { ok: false, error: 'malformed' };
  if (!/^[0-9+()\- ]+$/.test(s)) return { ok: false, error: 'unsupported_characters' };
  if (!/\d/.test(s)) return { ok: false, error: 'malformed' };
  return { ok: true, number: s };
}

/** Safe, always-present actor display name. */
export function actorName(u: any): string {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}