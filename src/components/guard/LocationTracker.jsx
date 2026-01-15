import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export default function LocationTracker({ user, activeShift }) {
  const watchIdRef = useRef(null);
  const lastUpdateRef = useRef(null);

  useEffect(() => {
    if (!user || !activeShift || !('geolocation' in navigator)) {
      return;
    }

    const startTracking = () => {
      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      };

      const handleSuccess = async (position) => {
        const now = Date.now();
        
        // Rate limit: only update every 10 seconds
        if (lastUpdateRef.current && now - lastUpdateRef.current < 10000) {
          return;
        }

        try {
          await base44.entities.LocationTracking.create({
            guard_id: user.id,
            guard_name: user.full_name,
            badge_number: user.badge_number,
            shift_id: activeShift.id,
            location: {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            },
            accuracy: position.coords.accuracy,
            speed: position.coords.speed || 0,
            heading: position.coords.heading || 0,
            status: 'active',
            battery_level: navigator.getBattery ? 
              await navigator.getBattery().then(b => Math.round(b.level * 100)) : 
              null,
            timestamp: new Date().toISOString()
          });

          lastUpdateRef.current = now;
          console.log('Location updated:', position.coords);
        } catch (error) {
          console.error('Failed to save location:', error);
        }
      };

      const handleError = (error) => {
        console.warn('Location error:', error.message);
      };

      // Start watching position
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        handleError,
        options
      );

      console.log('Location tracking started for', user.full_name);
    };

    startTracking();

    // Cleanup
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        console.log('Location tracking stopped');
      }
    };
  }, [user, activeShift]);

  return null; // This is a background component
}