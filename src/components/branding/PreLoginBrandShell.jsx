import React, { useEffect, useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import { PLATFORM_APP_NAME } from "@/lib/branding";
import BrandedLoginForm from "@/components/branding/BrandedLoginForm";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * PreLoginBrandShell — the login/install surface. When the URL carries a
 * valid ?brand=<pwa_slug>, the PUBLIC PWA manifest endpoint is fetched
 * (unauthenticated, public-safe data only: app name, icon, theme colour,
 * accent, tagline, secondary logo) and the card shows that customer's
 * branding, including a customer-branded email/password login form powered
 * by the OFFICIAL Base44 auth SDK.
 *
 * COSMETIC ONLY: the slug never grants tenant access. After login the
 * authenticated user's actual tenant scope, branding and data win — the
 * brand parameter is ignored for anything data-related.
 *
 * PRESENTATION: a branded URL renders a light, hospitality-grade card
 * (soft off-white page, white form container, navy/brand headings, teal
 * accents). The PWA splash background colour is deliberately NOT used as
 * the page or text theme — a white splash with white text was unreadable.
 * The generic (no-slug) shell keeps its existing dark presentation.
 */
export default function PreLoginBrandShell({ onSignIn }) {
  const slugMatch = /[?&]brand=([a-z0-9-]+)/i.exec(window.location.search);
  const rawSlug = slugMatch ? slugMatch[1].toLowerCase() : "";
  const slug = SLUG_RE.test(rawSlug) ? rawSlug : "";

  const [brand, setBrand] = useState(null); // null = loading (branded) or generic

  useEffect(() => {
    if (!slug) return undefined;
    let alive = true;
    fetch(`/functions/getPwaManifest?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((m) => {
        if (!alive || !m || !m.name) return;
        // Only treat as branded when the endpoint actually resolved this
        // slug (unknown/inactive slugs return the generic platform manifest).
        const branded = m.start_url === `/?brand=${slug}`;
        if (branded) document.title = m.name;
        setBrand({
          branded,
          name: branded ? m.name : PLATFORM_APP_NAME,
          icon: m.icons && m.icons.length ? m.icons[m.icons.length - 1].src : null,
          theme: m.theme_color,
          background: m.background_color,
          // Cosmetic extras (public-safe): resolved from the customer record.
          accent: m.accent_color || null,
          secondaryLogo: m.secondary_logo_url || null,
          tagline: m.tagline || null,
        });
      })
      .catch(() => {
        // A fetch failure must never trap the visitor on the spinner — fall
        // back to the generic platform shell so sign-in still works.
        if (alive) setBrand({ branded: false });
      });
    // Safety net: a hung/never-resolving request must never trap the visitor
    // on the loader — fall back to the generic shell so sign-in still works.
    const timeout = setTimeout(() => {
      if (alive) setBrand((b) => b || { branded: false });
    }, 8000);
    return () => { alive = false; clearTimeout(timeout); };
  }, [slug]);

  // Branded URL still resolving — brief loader so the card doesn't flash
  // the generic name first.
  if (slug && !brand) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <Loader2 className="w-8 h-8 text-slate-600 animate-spin" />
      </div>
    );
  }

  const branded = !!brand?.branded;
  const appName = branded ? brand.name : PLATFORM_APP_NAME;

  // ── BRANDED: light hospitality-grade login card ────────────────────────
  if (branded) {
    const navy = brand.theme || "#0f172a";
    const accent = brand.accent || "#00A6B5";
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-4 py-6" style={{ backgroundColor: "#f6f8fb" }}>
        {/* Focused keyboard feedback in the brand accent for this surface */}
        <style>{`.uss-login-form input:focus-visible{border-color:${accent};box-shadow:0 0 0 3px rgba(0,166,181,0.22);outline:none}.uss-login-form a:focus-visible,.uss-login-form button:focus-visible{outline:2px solid ${accent};outline-offset:2px}`}</style>
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl shadow-sm px-6 py-8 sm:px-8 text-center">
          {brand.icon ? (
            <img
              src={brand.icon}
              alt={appName}
              className="h-20 w-auto object-contain mx-auto mb-3"
            />
          ) : (
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: navy }}>
              <Shield className="w-8 h-8 text-white" />
            </div>
          )}
          <h1 className="text-2xl font-bold mb-1" style={{ color: navy }}>{appName}</h1>
          <p className="text-sm text-slate-600 mb-6">
            {brand.tagline || "Workforce & Operations Management"}
          </p>
          <BrandedLoginForm brand={brand} onPlatformSignIn={onSignIn} />
          {brand.secondaryLogo && (
            <img
              src={brand.secondaryLogo}
              alt="Secondary company logo"
              className="h-9 w-auto object-contain mx-auto mt-7"
            />
          )}
        </div>
      </div>
    );
  }

  // ── GENERIC (no brand slug): existing dark platform shell ──────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-sm text-center">
        {branded && brand.icon ? (
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl overflow-hidden"
            style={{ backgroundColor: "#ffffff" }}
          >
            <img src={brand.icon} alt={appName} className="max-w-full max-h-full object-contain p-1.5" />
          </div>
        ) : (
          <div className="w-20 h-20 bg-gradient-to-br from-sky-400 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-sky-500/30">
            <Shield className="w-10 h-10 text-white" />
          </div>
        )}
        <h1 className="text-3xl font-bold text-white mb-2">{appName}</h1>
        <p className="text-slate-400 mb-6">Workforce &amp; Operations Management</p>
        <BrandedLoginForm brand={brand} onPlatformSignIn={onSignIn} />
      </div>
    </div>
  );
}