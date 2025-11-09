import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

export default function LocationHeatmap({ guards }) {
  const map = useMap();
  const [heatLayer, setHeatLayer] = useState(null);

  const { data: historicalLocations } = useQuery({
    queryKey: ["historicalLocations"],
    queryFn: async () => {
      try {
        // Get last 1000 location records from past 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        return await base44.entities.LocationTracking.list("-timestamp", 1000);
      } catch (error) {
        console.error("Failed to load historical locations:", error);
        return [];
      }
    },
    refetchInterval: 60000, // Refresh every minute
    initialData: []
  });

  useEffect(() => {
    if (!map || !historicalLocations.length) return;

    // Remove existing heat layer
    if (heatLayer) {
      map.removeLayer(heatLayer);
    }

    // Prepare data for heatmap: [lat, lng, intensity]
    const heatData = historicalLocations.map(loc => {
      return [
        loc.location.lat,
        loc.location.lng,
        0.5 // Intensity - can be adjusted based on activity
      ];
    });

    // Add current guard positions with higher intensity
    guards.forEach(guard => {
      if (guard.clock_in?.location) {
        heatData.push([
          guard.clock_in.location.lat,
          guard.clock_in.location.lng,
          1.0 // Higher intensity for current positions
        ]);
      }
    });

    // Create heat layer
    const heat = L.heatLayer(heatData, {
      radius: 25,
      blur: 35,
      maxZoom: 17,
      max: 1.0,
      gradient: {
        0.0: '#3b82f6',
        0.3: '#10b981',
        0.5: '#fbbf24',
        0.7: '#f59e0b',
        1.0: '#ef4444'
      }
    });

    heat.addTo(map);
    setHeatLayer(heat);

    return () => {
      if (heat) {
        map.removeLayer(heat);
      }
    };
  }, [map, historicalLocations, guards]);

  return null;
}