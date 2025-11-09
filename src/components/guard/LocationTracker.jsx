import React, { useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";

export default function LocationTracker({ user, shift, enabled = true }) {
  const trackingIntervalRef = useRef(null);
  const lastLocationRef = useRef(null);

  useEffect(() => {
    if (!enabled || !shift || !user) return;

    const startTracking = () => {
      // Initial tracking
      trackLocation();

      // Set up interval for continuous tracking (every 30 seconds)
      trackingIntervalRef.current = setInterval(() => {
        trackLocation();
      }, 30000);
    };

    const trackLocation = () => {
      if (!navigator.geolocation) {
        console.warn("Geolocation not supported");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const newLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };

          // Check if location has changed significantly (more than 10 meters)
          if (lastLocationRef.current) {
            const distance = calculateDistance(
              lastLocationRef.current.lat,
              lastLocationRef.current.lng,
              newLocation.lat,
              newLocation.lng
            );

            if (distance < 0.01) {
              // Less than 10 meters, skip update
              return;
            }
          }

          try {
            // Store location in tracking history
            await base44.entities.LocationTracking.create({
              guard_id: user.id,
              guard_name: user.full_name,
              badge_number: user.badge_number || user.id,
              shift_id: shift.id,
              location: newLocation,
              accuracy: position.coords.accuracy,
              speed: position.coords.speed || 0,
              heading: position.coords.heading || 0,
              status: "active",
              battery_level: await getBatteryLevel(),
              timestamp: new Date().toISOString()
            });

            // Update user's last known location
            await base44.auth.updateMe({
              last_location: {
                ...newLocation,
                timestamp: new Date().toISOString()
              }
            });

            lastLocationRef.current = newLocation;
          } catch (error) {
            console.error("Failed to update location:", error);
          }
        },
        (error) => {
          console.error("Geolocation error:", error);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    };

    const getBatteryLevel = async () => {
      try {
        if ('getBattery' in navigator) {
          const battery = await navigator.getBattery();
          return Math.round(battery.level * 100);
        }
      } catch (error) {
        console.error("Battery API error:", error);
      }
      return null;
    };

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Earth's radius in km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; // Distance in km
    };

    startTracking();

    // Cleanup on unmount
    return () => {
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
      }
    };
  }, [enabled, shift, user]);

  // This component doesn't render anything
  return null;
}