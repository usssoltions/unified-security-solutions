/**
 * THE authoritative application/deployment URL resolver — the only place a
 * deployment URL is defined. Every function that needs to link back into the
 * app imports from here; no function hard-codes a base44 URL.
 *
 * Resolution order:
 *   1. APP_DEPLOYMENT_URL secret — the administrator's configured deployment
 *      URL / custom domain (validated http(s) + hostname; set it once and
 *      every future email/link follows the custom domain).
 *   2. The request's own origin — but ONLY when the host is a platform
 *      *.base44.app deployment (browser-supplied origins are never trusted
 *      blindly: an origin that is not in the platform zone is rejected, so
 *      no open redirect through attacker-chosen Host headers).
 *   3. The default platform deployment (the single fallback constant).
 *
 * appUrlFor(base, path) joins a path safely and only allows in-app paths
 * (starting with '/') — external/absolute URLs are never injected.
 */

export const DEFAULT_DEPLOYMENT_URL = 'https://guard-track-pro-26cedab8.base44.app';

function validUrl(u: any): string | null {
  const s = String(u || '').trim();
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s)) return null;
  return s.replace(/\/+$/, '');
}

export function resolveAppUrl(
  secrets: Record<string, any> | null | undefined,
  req?: Request | null,
): string {
  const configured = validUrl(secrets?.APP_DEPLOYMENT_URL);
  if (configured) return configured;

  if (req) {
    try {
      const origin = new URL(req.url).origin;
      if (/^https?:\/\/[a-z0-9-]+\.base44\.app$/i.test(origin)) return origin;
    } catch (_) { /* fall through */ }
  }

  return DEFAULT_DEPLOYMENT_URL;
}

export function appUrlFor(base: string, path: string): string {
  const b = String(base || DEFAULT_DEPLOYMENT_URL).replace(/\/+$/, '');
  const p = String(path || '/');
  if (!p.startsWith('/')) return b; // only in-app paths — never injected absolute URLs
  return b + p;
}