import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { saveOffline, isOnline } from '@/lib/offlineDB';
import { cacheLastKnownLocation } from '@/lib/panicService';
import { getUserDisplayName } from '@/lib/userDisplayName';

/**
 * Haversine distance in metres between two {lat,lng} points.
 */
function distanceMetres(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Adaptive GPS tracker — uploads only when the guard has moved >40m OR a
 * 10-minute heartbeat is due, so a guard sitting at a post doesn't generate
 * 60 location records/hour of the same coordinates. The control room still
 * confirms the device is active via the heartbeat, and patrol trails remain
 * accurate because a walking guard moves well beyond 40m per minute.
 *
 * EMERGENCY OVERRIDE: when `emergency` is true (an active Panic belongs to this
 * guard), the throttle drops to ~10s and every fix is uploaded regardless of
 * movement — giving the control room a live, high-frequency trail during an
 * emergency. Normal low-data throttling never blocks useful live location
 * during a panic.
 *
 * Tracking remains gated on an active shift + clocked-in guard, so off-shift
 * and logged-out guards transmit nothing.
 */
export default function LocationTracker({ user, shift, enabled, emergency = false }) {
  const watchIdRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const lastPosRef = useRef(null);
  const lastHeartbeatRef = useRef(0);

  useEffect(() => {
    if (!enabled || !user || !shift || !('geolocation' in navigator)) return;

    const handleSuccess = async (position) => {
      const now = Date.now();
      // Emergency (panic / live tracking) → upload every ~10s regardless of
      // movement. Normal → 90s throttle.
      const throttleMs = emergency ? 10000 : 90000;
      if (now - lastUpdateRef.current < throttleMs) return;
      lastUpdateRef.current = now;

      const coords = position.coords;
      const currentPos = { lat: coords.latitude, lng: coords.longitude };
      // Cache position for instant Panic activation (no extra GPS request needed)
      cacheLastKnownLocation({ lat: currentPos.lat, lng: currentPos.lng, accuracy: coords.accuracy });
      const moved = distanceMetres(lastPosRef.current, currentPos) > 40;
      const heartbeatDue = now - lastHeartbeatRef.current > 10 * 60 * 1000;

      // Skip upload if stationary AND heartbeat not due — UNLESS this is an
      // emergency, where every fix is uploaded for live tracking.
      if (!emergency && !moved && !heartbeatDue) return;

      lastPosRef.current = currentPos;
      if (heartbeatDue || emergency) lastHeartbeatRef.current = now;

      const getBattery = async () => {
        try {
          if (navigator.getBattery) {
            const b = await navigator.getBattery();
            return Math.round(b.level * 100);
          }
        } catch {}
        return null;
      };

      const record = {
        guard_id: user.id,
        guard_name: getUserDisplayName(user),
        badge_number: user.badge_number,
        shift_id: shift.id,
        location: currentPos,
        accuracy: coords.accuracy,
        speed: coords.speed || 0,
        heading: coords.heading || 0,
        status: 'active',
        battery_level: await getBattery(),
        timestamp: new Date().toISOString(),
      };

      if (!isOnline()) {
        await saveOffline('pending_location', record);
        return;
      }

      try {
        await base44.entities.LocationTracking.create(record);
      } catch (e) {
        // Save locally on any failure (rate limit, network error, etc.)
        await saveOffline('pending_location', record);
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      handleSuccess,
      () => {},
      { enableHighAccuracy: true, maximumAge: emergency ? 5000 : 30000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, user, shift, emergency]);

  return null;
}