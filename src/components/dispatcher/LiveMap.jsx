import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, TrendingUp, MapPin, Navigation, Clock, Activity, History, RefreshCw } from "lucide-react";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const createGuardIcon = (status, isSelected) => {
  const colors = {
    active: 'rgb(var(--emerald-500-rgb, 16 185 129))',
    on_patrol: 'rgb(var(--sky-500-rgb, 14 165 233))',
    responding: 'rgb(var(--rose-500-rgb, 244 63 94))',
    idle: 'rgb(var(--amber-500-rgb, 245 158 11))',
    offline: 'rgb(var(--slate-500-rgb, 100 116 139))'
  };
  const color = colors[status] || colors.active;
  const size = isSelected ? 44 : 36;
  
  return L.divIcon({
    className: 'custom-guard-icon',
    html: `
      <div style="position: relative; animation: ${isSelected ? 'pulse 2s infinite' : 'none'};">
        <div style="
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M12 2C10.3431 2 9 3.34315 9 5C9 6.65685 10.3431 8 12 8C13.6569 8 15 6.65685 15 5C15 3.34315 13.6569 2 12 2Z"/>
            <path d="M12 10C8.68629 10 6 12.6863 6 16V22H18V16C18 12.6863 15.3137 10 12 10Z"/>
          </svg>
        </div>
        ${isSelected ? `
          <div style="
            position: absolute;
            top: -6px;
            left: -6px;
            width: ${size + 12}px;
            height: ${size + 12}px;
            border: 2px solid ${color};
            border-radius: 50%;
            animation: ping 1.5s infinite;
          "></div>
        ` : ''}
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        @keyframes ping {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(1.4); opacity: 0; }
        }
      </style>
    `,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
  });
};

export default function LiveMap({ activeGuards }) {
  const [guardsWithLocation, setGuardsWithLocation] = useState([]);
  const [selectedGuard, setSelectedGuard] = useState(null);
  const [showHistoricalRoute, setShowHistoricalRoute] = useState(false);
  const [historicalRoute, setHistoricalRoute] = useState([]);
  const queryClient = useQueryClient();

  // Real-time location tracking
  useEffect(() => {
    const fetchLocations = async () => {
      const guardsArray = Array.isArray(activeGuards) ? activeGuards : [];
      const enriched = [];
      
      for (const shift of guardsArray) {
        try {
          // Get latest location from LocationTracking
          const locations = await base44.entities.LocationTracking.filter(
            { guard_id: shift.guard_id, status: 'active' },
            '-timestamp',
            1
          );
          
          if (locations.length > 0) {
            const latest = locations[0];
            enriched.push({
              ...shift,
              location: latest.location,
              accuracy: latest.accuracy,
              speed: latest.speed,
              heading: latest.heading,
              battery_level: latest.battery_level,
              last_update: latest.timestamp,
              tracking_status: getTrackingStatus(shift, latest)
            });
          }
        } catch (error) {
          console.error('Failed to fetch location:', error);
        }
      }
      
      setGuardsWithLocation(enriched);
    };

    fetchLocations();
    const interval = setInterval(fetchLocations, 5000); // Update every 5 seconds
    
    return () => clearInterval(interval);
  }, [activeGuards]);

  // Real-time subscription for location updates
  useEffect(() => {
    const unsubscribe = base44.entities.LocationTracking.subscribe((event) => {
      if (event.type === 'create' || event.type === 'update') {
        queryClient.invalidateQueries(['locations']);
        // Trigger immediate refresh
        setGuardsWithLocation(prev => {
          const updated = [...prev];
          const index = updated.findIndex(g => g.guard_id === event.data.guard_id);
          if (index !== -1 && event.data.location) {
            updated[index] = {
              ...updated[index],
              location: event.data.location,
              accuracy: event.data.accuracy,
              speed: event.data.speed,
              heading: event.data.heading,
              last_update: event.data.timestamp,
              tracking_status: getTrackingStatus(updated[index], event.data)
            };
          }
          return updated;
        });
      }
    });

    return () => unsubscribe();
  }, [queryClient]);

  const getTrackingStatus = (shift, locationData) => {
    const timeSinceUpdate = Date.now() - new Date(locationData.timestamp).getTime();
    
    if (timeSinceUpdate > 300000) return 'offline'; // 5 min
    if (locationData.speed > 1) return 'on_patrol';
    if (timeSinceUpdate < 30000) return 'active'; // 30 sec
    return 'idle';
  };

  const loadHistoricalRoute = async (guardId, shiftId) => {
    try {
      setShowHistoricalRoute(true);
      const locations = await base44.entities.LocationTracking.filter(
        { guard_id: guardId, shift_id: shiftId },
        'timestamp',
        500
      );
      
      const route = locations
        .filter(l => l.location?.lat && l.location?.lng)
        .map(l => [l.location.lat, l.location.lng]);
      
      setHistoricalRoute(route);
    } catch (error) {
      console.error('Failed to load historical route:', error);
    }
  };

  if (guardsWithLocation.length === 0) {
    return (
      <div className="h-[600px] bg-slate-900 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <MapPin className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No active guards with location data</p>
          <p className="text-slate-500 text-sm mt-2">Guards will appear here when they clock in</p>
        </div>
      </div>
    );
  }

  const bounds = guardsWithLocation.map(g => [g.location.lat, g.location.lng]);
  const center = bounds.length > 0 
    ? [
        bounds.reduce((sum, coord) => sum + coord[0], 0) / bounds.length,
        bounds.reduce((sum, coord) => sum + coord[1], 0) / bounds.length
      ]
    : [-33.9249, 18.4241];

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-emerald-500',
      on_patrol: 'bg-blue-500',
      responding: 'bg-rose-500',
      idle: 'bg-amber-500',
      offline: 'bg-slate-500'
    };
    return colors[status] || colors.active;
  };

  const getStatusLabel = (status) => {
    const labels = {
      active: 'Active',
      on_patrol: 'On Patrol',
      responding: 'Responding',
      idle: 'Idle',
      offline: 'Offline'
    };
    return labels[status] || 'Unknown';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
            <span className="text-slate-300">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
            <span className="text-slate-300">On Patrol</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500"></div>
            <span className="text-slate-300">Responding</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
            <span className="text-slate-300">Idle</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-500"></div>
            <span className="text-slate-300">Offline</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-semibold">Live Tracking</span>
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={12}
        style={{ height: "600px", width: "100%", borderRadius: "0.5rem" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {/* Historical route */}
        {showHistoricalRoute && historicalRoute.length > 0 && (
          <Polyline
            positions={historicalRoute}
            pathOptions={{
              color: 'rgb(var(--sky-500-rgb, 59 130 246))',
              weight: 4,
              opacity: 0.7,
              dashArray: '10, 10'
            }}
          />
        )}

        {guardsWithLocation.map((guard) => {
          const isSelected = selectedGuard?.guard_id === guard.guard_id;
          
          return (
            <React.Fragment key={guard.guard_id}>
              {/* Accuracy circle */}
              <Circle
                center={[guard.location.lat, guard.location.lng]}
                radius={guard.accuracy || 50}
                pathOptions={{
                  color: getStatusColor(guard.tracking_status).replace('bg-', '#'),
                  fillColor: getStatusColor(guard.tracking_status).replace('bg-', '#'),
                  fillOpacity: 0.1,
                  weight: 1
                }}
              />

              {/* Guard marker */}
              <Marker
                position={[guard.location.lat, guard.location.lng]}
                icon={createGuardIcon(guard.tracking_status, isSelected)}
                eventHandlers={{
                  click: () => setSelectedGuard(guard)
                }}
              >
                <Popup>
                  <div className="min-w-[240px]">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-bold text-slate-900 text-base">{guard.guard_name}</p>
                        <p className="text-xs text-slate-600">{guard.badge_number || guard.guard_id}</p>
                      </div>
                      <Badge className={`${getStatusColor(guard.tracking_status)} text-white`}>
                        {getStatusLabel(guard.tracking_status)}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2 text-xs mb-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3 h-3 text-slate-500" />
                        <span className="text-slate-700">{guard.site_name}</span>
                      </div>
                      
                      {guard.speed !== undefined && (
                        <div className="flex items-center gap-2">
                          <Navigation className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-700">Speed: {(guard.speed * 3.6).toFixed(1)} km/h</span>
                        </div>
                      )}

                      {guard.battery_level !== undefined && (
                        <div className="flex items-center gap-2">
                          <Activity className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-700">Battery: {guard.battery_level}%</span>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span className="text-slate-700">
                          Updated: {new Date(guard.last_update).toLocaleTimeString()}
                        </span>
                      </div>

                      {guard.accuracy && (
                        <div className="text-xs text-slate-500">
                          Accuracy: ±{guard.accuracy.toFixed(0)}m
                        </div>
                      )}
                    </div>

                    <Button
                      size="sm"
                      onClick={() => loadHistoricalRoute(guard.guard_id, guard.id)}
                      className="w-full bg-blue-500 hover:bg-blue-600"
                    >
                      <History className="w-3 h-3 mr-2" />
                      View Patrol Route
                    </Button>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
      </MapContainer>

      {showHistoricalRoute && (
        <div className="flex items-center justify-between bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-blue-300">
              Showing historical route ({historicalRoute.length} points)
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowHistoricalRoute(false);
              setHistoricalRoute([]);
            }}
            className="border-blue-600 text-blue-400"
          >
            Clear Route
          </Button>
        </div>
      )}
    </div>
  );
}