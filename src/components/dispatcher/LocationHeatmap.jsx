import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Circle } from "react-leaflet";

export default function LocationHeatmap({ guards }) {
  const { data: historicalLocations } = useQuery({
    queryKey: ["historicalLocations"],
    queryFn: async () => {
      try {
        // Get last 500 location records from past 24 hours
        return await base44.entities.LocationTracking.list("-timestamp", 500);
      } catch (error) {
        console.error("Failed to load historical locations:", error);
        return [];
      }
    },
    refetchInterval: 60000, // Refresh every minute
    initialData: []
  });

  // Group locations by proximity to create clusters
  const locationClusters = React.useMemo(() => {
    if (!historicalLocations.length) return [];

    const clusters = new Map();
    const gridSize = 0.001; // ~100 meters

    historicalLocations.forEach(loc => {
      const gridX = Math.floor(loc.location.lat / gridSize);
      const gridY = Math.floor(loc.location.lng / gridSize);
      const key = `${gridX},${gridY}`;

      if (!clusters.has(key)) {
        clusters.set(key, {
          lat: loc.location.lat,
          lng: loc.location.lng,
          count: 0
        });
      }
      clusters.get(key).count++;
    });

    return Array.from(clusters.values());
  }, [historicalLocations]);

  // Add current guard positions
  const allPoints = React.useMemo(() => {
    const points = [...locationClusters];
    
    guards.forEach(guard => {
      if (guard.clock_in?.location) {
        points.push({
          lat: guard.clock_in.location.lat,
          lng: guard.clock_in.location.lng,
          count: 10 // Higher weight for current positions
        });
      }
    });

    return points;
  }, [locationClusters, guards]);

  if (!allPoints.length) return null;

  // Determine color and size based on activity count
  const getCircleProps = (count) => {
    const maxCount = Math.max(...allPoints.map(p => p.count));
    const intensity = count / maxCount;

    let color;
    if (intensity < 0.2) color = '#3b82f6'; // Blue
    else if (intensity < 0.4) color = '#10b981'; // Green
    else if (intensity < 0.6) color = '#fbbf24'; // Yellow
    else if (intensity < 0.8) color = '#f59e0b'; // Orange
    else color = '#ef4444'; // Red

    const radius = 30 + (intensity * 70); // 30-100 meters

    return { color, radius, opacity: 0.3 + (intensity * 0.5) };
  };

  return (
    <>
      {allPoints.map((point, idx) => {
        const props = getCircleProps(point.count);
        return (
          <Circle
            key={idx}
            center={[point.lat, point.lng]}
            radius={props.radius}
            pathOptions={{
              color: props.color,
              fillColor: props.color,
              fillOpacity: props.opacity,
              weight: 0
            }}
          />
        );
      })}
    </>
  );
}