/**
 * Shared Panic activation logic — used by both the big GuardShift PanicButton
 * and the global header PanicButton (available to ALL authenticated users).
 *
 * Core principle: the UI responds IMMEDIATELY on press. The backend call fires
 * without waiting for GPS. A fresh GPS fix updates the record in parallel.
 * An activation lock (useRef) prevents duplicate Panic records from repeated
 * taps.
 */
import { base44 } from "@/api/base44Client";

const LAST_LOCATION_KEY = "uss_last_known_location";

/** Store the latest GPS position in localStorage for instant Panic access. */
export function cacheLastKnownLocation(position) {
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify({
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy || null,
      captured_at: new Date().toISOString()
    }));
  } catch (_) {}
}

/** Return the most recent cached location, or null. */
export function getLastKnownLocation() {
  try {
    const raw = localStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.lat !== "number" || typeof parsed.lng !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Request a fresh high-accuracy GPS position (returns a Promise). */
export function requestFreshLocation() {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          captured_at: new Date().toISOString()
        };
        cacheLastKnownLocation(loc);
        resolve(loc);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  });
}

/** Vibrate the device for haptic feedback (no-op if unsupported). */
export function hapticFeedback(pattern = [200, 100, 200, 100, 200]) {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern);
  } catch (_) {}
}

/**
 * Activate a Panic alert immediately.
 * Returns { panicId, panicNumber } on success.
 * Does NOT block on GPS — uses cached location if available, sends null
 * location if not. The caller should call requestFreshLocation() in
 * parallel and then call updatePanicLocation with the result.
 */
export async function activatePanic({ shiftId, siteId, siteName, notes }) {
  const cached = getLastKnownLocation();

  const payload = {
    location: cached ? { lat: cached.lat, lng: cached.lng } : null,
    gps_accuracy: cached?.accuracy || null,
    location_captured_at: cached?.captured_at || null,
    location_source: cached ? "cached" : "unavailable",
    notes: notes || "",
    shiftId: shiftId || "",
    siteId: siteId || "",
    siteName: siteName || ""
  };

  const res = await base44.functions.invoke("activatePanic", payload);
  return res;
}

/** Update a Panic alert with a fresh GPS fix. */
export async function updatePanicLocation(panicId, location) {
  try {
    await base44.functions.invoke("updatePanicLocation", {
      panicId,
      location: { lat: location.lat, lng: location.lng },
      gps_accuracy: location.accuracy || null
    });
  } catch (e) {
    console.error("updatePanicLocation failed:", e);
  }
}

/**
 * Manage a Panic alert (acknowledge, assign, accept, resolve, cancel, escalate).
 */
export async function managePanic(panicId, action, extra = {}) {
  return await base44.functions.invoke("managePanic", { panicId, action, ...extra });
}

/**
 * Trigger backend escalation for a specific panic (if still unacknowledged).
 * Called by the activator's client-side 2-minute timer — a SECONDARY
 * optimization that escalates instantly at the 2-minute mark when the app is
 * open, at zero credit cost. It is NOT relied upon: the server-side scheduled
 * sweep (escalateUnacknowledgedPanics, deadline-driven via next_escalation_at)
 * is the PRIMARY mechanism and escalates regardless of app/browser state.
 * No polling — a single setTimeout.
 */
export async function escalatePanic(panicId) {
  try {
    return await base44.functions.invoke("escalateUnacknowledgedPanics", { panicId });
  } catch (e) {
    console.error("escalatePanic failed:", e);
  }
}