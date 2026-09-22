import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Loader2, Crosshair, AlertCircle, CheckCircle2, Search } from "lucide-react";

/**
 * SiteLocationSection — the Site form's address + GPS block.
 *
 * Four ways to set a site's GPS location (most reliable first):
 *  A) Address autocomplete — suggestions appear as the admin types; picking
 *     one populates the formatted address AND latitude/longitude.
 *  B) "Generate GPS Coordinates from Address" — server-side geocoding
 *     (Photon → Nominatim fallback) with meaningful, distinct error messages.
 *  C) "Use Current Location" — device GPS while physically on site.
 *  D) Manual latitude/longitude entry — always available as fallback.
 *
 * VALIDATION: (0,0) is NEVER a valid configured location — a site with
 * lat=0 and lng=0 is treated as having NO GPS location, so geofencing can
 * never be accidentally activated by a placeholder coordinate.
 */
export default function SiteLocationSection({ address, location, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [usingGps, setUsingGps] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [geoSuccess, setGeoSuccess] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const lastSelectedRef = useRef(null);
  const debounceRef = useRef(null);

  const parsedLat = parseFloat(location?.lat);
  const parsedLng = parseFloat(location?.lng);
  const hasValidLocation =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    !(parsedLat === 0 && parsedLng === 0);

  const invokeGeocoder = async (query) => {
    const res = await base44.functions.invoke("geocodeAddress", { query });
    return res?.data ?? res;
  };

  // ── A) Debounced address autocomplete ─────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = (address || "").trim();
    if (q.length < 4 || q === lastSelectedRef.current) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const payload = await invokeGeocoder(q);
        setSuggestions(payload?.results || []);
        setShowSuggestions(true);
      } catch (e) {
        // Autocomplete stays silent — the explicit Generate button surfaces errors.
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [address]);

  const selectSuggestion = (s) => {
    lastSelectedRef.current = s.label;
    onChange({ address: s.label, location: { lat: s.lat, lng: s.lng } });
    setSuggestions([]);
    setShowSuggestions(false);
    setGeoError(null);
    setGeoSuccess(`Location set: ${s.lat}, ${s.lng}`);
  };

  // ── B) Generate from the typed address ────────────────────────────────
  const generateCoordinates = async () => {
    const q = (address || "").trim();
    if (q.length < 4) {
      setGeoError("Enter a full street address first.");
      return;
    }
    setGenerating(true);
    setGeoError(null);
    setGeoSuccess(null);
    try {
      const payload = await invokeGeocoder(q);
      const results = payload?.results || [];
      if (results.length === 0) {
        if (payload?.status === "PROVIDER_ERROR") {
          setGeoError(payload?.message || "Geocoding service is currently unavailable. Use 'Use Current Location' or enter coordinates manually.");
        } else {
          setGeoError("No matching address found. Try one of the suggestions as you type, a nearby landmark, or enter coordinates manually.");
        }
        return;
      }
      const best = results[0];
      onChange({ location: { lat: best.lat, lng: best.lng } });
      setGeoSuccess(`Matched: ${best.label} (${best.lat}, ${best.lng})`);
      setSuggestions([]);
      setShowSuggestions(false);
    } catch (e) {
      setGeoError("Geocoding request failed. Check your connection, or use 'Use Current Location' / manual coordinates.");
    } finally {
      setGenerating(false);
    }
  };

  // ── C) Use the admin's current (on-site) GPS position ─────────────────
  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("This device/browser does not support location capture. Enter coordinates manually instead.");
      return;
    }
    setUsingGps(true);
    setGeoError(null);
    setGeoSuccess(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(7));
        const lng = Number(pos.coords.longitude.toFixed(7));
        onChange({ location: { lat, lng } });
        setUsingGps(false);
        setGeoSuccess(`Location set from device GPS: ${lat}, ${lng}${pos.coords.accuracy != null ? ` (±${Math.round(pos.coords.accuracy)}m)` : ""}`);
      },
      (err) => {
        setUsingGps(false);
        if (err?.code === 1) {
          setGeoError("Location permission denied — allow location access for this app, then press 'Use Current Location' again.");
        } else {
          setGeoError("Could not obtain a GPS fix. Check that location services are on, then retry.");
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  return (
    <div className="space-y-3">
      <label className="text-sm text-slate-400 mb-2 block">Address *</label>

      {/* A) Address input with autocomplete suggestions */}
      <div className="relative">
        <Textarea
          value={address || ""}
          onChange={(e) => onChange({ address: e.target.value })}
          className="bg-slate-900/50 border-slate-700 text-white"
          rows={2}
          required
          placeholder="Start typing the street address, e.g. 546 Main Rd, Paarl…"
        />
        {searching && (
          <div className="absolute right-3 top-2.5 flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowSuggestions(false)} />
            <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto bg-slate-900 border border-slate-600 rounded-lg shadow-xl">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.lat}-${s.lng}-${i}`}
                  type="button"
                  onClick={() => selectSuggestion(s)}
                  className="w-full text-left px-3 py-2.5 hover:bg-slate-800 border-b border-slate-800 last:border-b-0 flex items-start gap-2"
                >
                  <MapPin className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <span className="text-sm text-slate-200">{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* B + C) One-tap coordinate generation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Button
          type="button"
          onClick={generateCoordinates}
          disabled={generating || usingGps || !address}
          variant="outline"
          className="border-sky-500/50 text-sky-400 hover:bg-sky-500/10"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Finding Location...
            </>
          ) : (
            <>
              <Search className="w-4 h-4 mr-2" />
              Generate GPS Coordinates from Address
            </>
          )}
        </Button>
        <Button
          type="button"
          onClick={useCurrentLocation}
          disabled={generating || usingGps}
          variant="outline"
          className="border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
        >
          {usingGps ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Getting GPS...
            </>
          ) : (
            <>
              <Crosshair className="w-4 h-4 mr-2" />
              Use Current Location
            </>
          )}
        </Button>
      </div>

      {/* D) Manual coordinate entry + status */}
      <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg space-y-3">
        <div className="flex items-center gap-2 text-sky-400 font-semibold">
          <MapPin className="w-5 h-5" />
          <span>GPS Location</span>
        </div>
        <p className="text-xs text-slate-400">
          Select an address suggestion, use the buttons above, or enter coordinates manually
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Latitude</label>
            <Input
              type="number"
              step="any"
              value={location?.lat ?? ""}
              onChange={(e) => onChange({ location: { ...location, lat: e.target.value } })}
              className="bg-slate-900/50 border-slate-700 text-white"
              placeholder="-33.7046"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Longitude</label>
            <Input
              type="number"
              step="any"
              value={location?.lng ?? ""}
              onChange={(e) => onChange({ location: { ...location, lng: e.target.value } })}
              className="bg-slate-900/50 border-slate-700 text-white"
              placeholder="18.9608"
            />
          </div>
        </div>
        {hasValidLocation ? (
          <p className="text-emerald-400 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Location set: {parsedLat}, {parsedLng}
          </p>
        ) : (
          <p className="text-amber-400 text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            No GPS location set — geofence validation will be unavailable for this site
          </p>
        )}
      </div>

      {/* Geocoding feedback */}
      {geoError && (
        <p className="text-rose-400 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {geoError}
        </p>
      )}
      {geoSuccess && !geoError && (
        <p className="text-emerald-400 text-sm flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          {geoSuccess}
        </p>
      )}
    </div>
  );
}