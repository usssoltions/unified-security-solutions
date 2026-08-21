import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { saveOffline, isOnline } from '@/lib/offlineDB';
import { cacheLastKnownLocation } from '@/lib/panicService';

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
 * Adaptive GPS tracker — uploads only when the guard has moved >25m OR a
 * 5-minute heartbeat is due, so a guard sitting at a post doesn't generate
 * 60 location records/hour of the same coordinates (was: one per 60s
 * regardless of movement). The control room still confirms the device is
 * active via the heartbeat, and patrol trails remain accurate because a
 * walking guard moves well beyond 25m per minute.
 *
 * Tracking remains gated on an active shift + clocked-in guard, so off-shift
 * and logged-out guards transmit nothing.
 */
export default function LocationTracker({ user, shift, enabled }) {
  const watchIdRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const lastPosRef = useRef(null);
  const lastHeartbeatRef = useRef(0);

  useEffect(() => {
    if (!enabled || !user || !shift || !('geolocation' in navigator)) return;

    const handleSuccess = async (position) => {
      const now = Date.now();
      // Process at most once per 60s (the watcher fires more often)
      if (now - lastUpdateRef.current < 60000) return;
      lastUpdateRef.current = now;

      const coords = position.coords;
      const currentPos = { lat: coords.latitude, lng: coords.longitude };
      // Cache position for instant Panic activation (no extra GPS request needed)
      cacheLastKnownLocation({ lat: currentPos.lat, lng: currentPos.lng, accuracy: coords.accuracy });
      const moved = distanceMetres(lastPosRef.current, currentPos) > 25;
      const heartbeatDue = now - lastHeartbeatRef.current > 5 * 60 * 1000;

      // Skip upload if stationary AND heartbeat not due — eliminates redundant
      // data when a guard sits at a post. Control room still gets a 5-minute
      // heartbeat confirming the device is active.
      if (!moved && !heartbeatDue) return;

      lastPosRef.current = currentPos;
      if (heartbeatDue) lastHeartbeatRef.current = now;

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
        guard_name: user.full_name,
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
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, user, shift]);

  return null;
}