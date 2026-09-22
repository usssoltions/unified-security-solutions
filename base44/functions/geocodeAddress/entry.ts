import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';

/**
 * geocodeAddress — server-side forward geocoding for Site Management.
 *
 * WHY THIS EXISTS: the previous implementation fetched
 * nominatim.openstreetmap.org DIRECTLY from the browser. That request was
 * actually sent and returned HTTP 200 — but Nominatim's strict matching
 * returned [] for real South African street addresses (verified live
 * 2026-09-22: "546 Main Rd, Northern Paarl, Paarl, 7646" → [], while the
 * SAME OSM data via Photon matched "BP, 546 Main Road, Noorder-Paarl,
 * Paarl, Western Cape"). Server-side we can query Photon FIRST (fuzzy
 * matching, designed for autocomplete) with Nominatim as fallback, avoid
 * browser CORS/rate-limit issues, and return DISTINCT statuses so the UI
 * can tell "provider failed" from "no match for this address".
 *
 * No API key required — both providers are free/open (usage-policy compliant).
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body: any = await req.json().catch(() => ({}));
    const query: string = String(body?.query || '').trim();
    if (query.length < 3) {
      return Response.json(
        { results: [], status: 'INVALID_QUERY', message: 'Enter at least 3 characters to search.' },
        { status: 400 }
      );
    }

    const results: any[] = [];
    const providerErrors: string[] = [];

    // ── Query variants ──────────────────────────────────────────────────
    // VERIFIED 2026-09-22: "546 Main Rd, Northern Paarl, Paarl, 7646" fails
    // even on Photon, because the typed postcode (7646) and locality name
    // ("Northern Paarl") don't match OSM's tags ("Noorder-Paarl", 7320).
    // Simplifying the query — dropping the postcode and appending the
    // country — resolves the exact address. Variants are tried in order.
    const stripPostcodes = (s: string): string =>
      s.replace(/\b\d{4}\b/g, '').replace(/\s*,\s*(?=,|$)/g, '').replace(/\s{2,}/g, ' ').trim().replace(/,\s*$/, '');
    const stripped = stripPostcodes(query);
    const variants: string[] = [query];
    if (stripped && stripped.toLowerCase() !== query.toLowerCase()) variants.push(stripped);
    if (!query.toLowerCase().includes('south africa')) {
      const withCountry = `${stripped || query}, South Africa`;
      if (!variants.some((v: string) => v.toLowerCase() === withCountry.toLowerCase())) {
        variants.push(withCountry);
      }
    }

    // ── Provider 1: Photon (komoot) — fuzzy search over OSM data; resolves
    //    street/housenumber matches Nominatim misses. Biased to South Africa.
    for (const v of variants) {
      if (results.length > 0) break;
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(v)}&limit=8&lang=en&lat=-29&lon=25`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data: any = await res.json();
          for (const f of data?.features || []) {
            const p = f?.properties || {};
            const lat = parseFloat(f?.geometry?.coordinates?.[1]);
            const lng = parseFloat(f?.geometry?.coordinates?.[0]);
            // (0,0) is NEVER a valid configured location.
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
            const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ');
            const label = [
              p.name,
              streetLine,
              p.city || p.locality || p.district || p.county,
              p.state,
              p.country
            ].filter(Boolean).join(', ');
            if (!label) continue;
            results.push({ label, lat, lng, source: 'photon', countrycode: p.countrycode || null });
          }
        } else {
          providerErrors.push(`photon:${res.status}`);
        }
      } catch (e: any) {
        providerErrors.push(`photon:${String(e?.message || e)}`);
      }
    }

    // RANK SOUTH AFRICA FIRST: Photon's location bias is weak — with an
    // ambiguous partial address it can rank foreign matches (e.g. India)
    // above the correct ZA one. This is a South African platform, so ZA
    // results always sort to the top (stable for equal countrycode).
    results.sort((a: any, b: any) => ((b?.countrycode === 'ZA') ? 1 : 0) - ((a?.countrycode === 'ZA') ? 1 : 0));

    // ── Provider 2: Nominatim fallback — only when Photon found nothing,
    //    so a Photon outage still yields results when Nominatim works.
    if (results.length === 0) {
      for (const v of variants.slice(0, 2)) {
        if (results.length > 0) break;
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(v)}&limit=8&countrycodes=za`;
          const res = await fetch(url, {
            signal: AbortSignal.timeout(8000),
            // Nominatim usage policy requires an identifying User-Agent.
            headers: { 'User-Agent': 'USS-SiteManagement/1.0 (site setup geocoding)' }
          });
          if (res.ok) {
            const data: any = await res.json();
            for (const r of data || []) {
              const lat = parseFloat(r.lat);
              const lng = parseFloat(r.lon);
              if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
              if (!r.display_name) continue;
              results.push({ label: r.display_name, lat, lng, source: 'nominatim' });
            }
          } else {
            providerErrors.push(`nominatim:${res.status}`);
          }
        } catch (e: any) {
          providerErrors.push(`nominatim:${String(e?.message || e)}`);
        }
      }
    }

    if (results.length === 0) {
      if (providerErrors.length > 0) {
        // Provider failure — DISTINCT from "no match": the UI must not claim
        // "Address not found" when the geocoding service itself errored.
        return Response.json({
          results: [],
          status: 'PROVIDER_ERROR',
          provider_errors: providerErrors,
          message: 'Geocoding service is currently unavailable. Try again, use "Use Current Location", or enter coordinates manually.'
        });
      }
      return Response.json({
        results: [],
        status: 'NO_MATCH',
        message: 'No matching address found. Try a nearby street or landmark, or set coordinates manually.'
      });
    }

    return Response.json({ results, status: 'OK' });
  } catch (error: any) {
    return Response.json(
      { results: [], status: 'PROVIDER_ERROR', error: String(error?.message || error) },
      { status: 500 }
    );
  }
}