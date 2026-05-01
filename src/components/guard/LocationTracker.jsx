import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { saveOffline, isOnline } from '@/lib/offlineDB';

export default function LocationTracker({ user, shift, enabled }) {
  const watchIdRef = useRef(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!enabled || !user || !shift || !('geolocation' in navigator)) return;

    const handleSuccess = async (position) => {
      const now = Date.now();
      // Throttle to once per 60 seconds
      if (now - lastUpdateRef.current < 60000) return;
      lastUpdateRef.current = now;

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
        location: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        },
        accuracy: position.coords.accuracy,
        speed: position.coords.speed || 0,
        heading: position.coords.heading || 0,
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