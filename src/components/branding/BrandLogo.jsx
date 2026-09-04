import React from "react";

/**
 * BrandLogo — the ONE shared rule for rendering a white-label logo.
 *
 * Controls the CONTAINER behind the logo only (logo_background branding
 * field, resolved customer → reseller → platform default "auto"):
 *   - "auto"        → the surface's existing default treatment (autoBackgroundClass)
 *   - "white"       → clean white container with internal padding (whitePaddingClass)
 *   - "transparent" → no forced background colour
 *
 * The uploaded logo image itself is NEVER modified — no recolouring,
 * tinting, filtering, inverting or blending. The <img> renders the file
 * as-is with object-contain: aspect ratio preserved, no stretching,
 * no cropping. Any other/unset logo_background value normalises to "auto".
 *
 * The container keeps its outer size (caller-supplied containerClassName),
 * so switching modes causes no layout shift.
 */
export default function BrandLogo({
  logoUrl,
  logoBackground = "auto",
  alt = "",
  containerClassName = "",
  imgClassName = "max-w-full max-h-full object-contain",
  autoBackgroundClass = "bg-slate-900/60",
  whitePaddingClass = "p-1",
  onError,
}) {
  if (!logoUrl) return null;
  const mode =
    logoBackground === "white" || logoBackground === "transparent"
      ? logoBackground
      : "auto";
  const bg =
    mode === "white" ? "bg-white" : mode === "transparent" ? "" : autoBackgroundClass;
  const pad = mode === "white" ? whitePaddingClass : "";
  return (
    <div
      className={`flex items-center justify-center overflow-hidden shrink-0 ${bg} ${pad} ${containerClassName}`}
    >
      <img src={logoUrl} alt={alt} className={imgClassName} onError={onError} draggable={false} />
    </div>
  );
}