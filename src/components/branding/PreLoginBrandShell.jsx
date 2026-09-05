import React, { useEffect, useState } from "react";
import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PLATFORM_APP_NAME } from "@/lib/branding";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/**
 * PreLoginBrandShell — the login/install surface. When the URL carries a
 * valid ?brand=<pwa_slug>, the PUBLIC PWA manifest endpoint is fetched
 * (unauthenticated, public-safe data only: app name, icon, theme colour)
 * and the card shows that customer's branding.
 *
 * COSMETIC ONLY: the slug never grants tenant access. After login the
 * authenticated user's actual tenant branding and data scope win — the
 * brand parameter is ignored for anything data-related.
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
        setBrand({
          branded,
          name: branded ? m.name : PLATFORM_APP_NAME,
          icon: m.icons && m.icons.length ? m.icons[m.icons.length - 1].src : null,
          theme: m.theme_color,
          background: m.background_color,
        });
      })
      .catch(() => {});
    return () => { alive = false; };
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
  const themeColor = branded && brand.theme ? brand.theme : "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="text-center">
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
        <p className="text-slate-400 mb-8">Workforce &amp; Operations Management</p>
        <Button
          onClick={onSignIn}
          className="h-12 px-8 text-base shadow-lg"
          style={themeColor ? { backgroundColor: themeColor } : undefined}
        >
          Sign In
        </Button>
        {branded && (
          <p className="text-slate-600 text-xs mt-4 max-w-xs mx-auto">
            Installed app branding — your own account's data and permissions apply after sign-in.
          </p>
        )}
      </div>
    </div>
  );
}