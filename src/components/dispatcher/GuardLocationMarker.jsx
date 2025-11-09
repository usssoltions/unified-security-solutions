import React, { useState, useEffect } from "react";
import { Marker, Popup, Circle, Polyline } from "react-leaflet";
import { Badge } from "@/components/ui/badge";
import { Navigation, Activity, Clock } from "lucide-react";
import L from "leaflet";

export default function GuardLocationMarker({ guard, isSelected, onClick }) {
  const [lastPositions, setLastPositions] = useState([]);
  
  const position = guard.clock_in?.location 
    ? [guard.clock_in.location.lat, guard.clock_in.location.lng]
    : null;

  useEffect(() => {
    if (position) {
      setLastPositions(prev => {
        const newPositions = [...prev, position];
        // Keep only last 10 positions for trail
        return newPositions.slice(-10);
      });
    }
  }, [position]);

  if (!position) return null;

  // Custom guard marker icon based on status
  const guardIcon = L.divIcon({
    className: 'custom-guard-marker',
    html: `
      <div style="position: relative;">
        <div style="
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
          ${isSelected ? 'animation: pulse 2s infinite;' : ''}
        ">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M12 2C10.3431 2 9 3.34315 9 5C9 6.65685 10.3431 8 12 8C13.6569 8 15 6.65685 15 5C15 3.34315 13.6569 2 12 2Z"/>
            <path d="M12 10C8.68629 10 6 12.6863 6 16V22H18V16C18 12.6863 15.3137 10 12 10Z"/>
          </svg>
        </div>
        ${isSelected ? `
          <div style="
            position: absolute;
            top: -8px;
            left: -8px;
            width: 56px;
            height: 56px;
            border: 2px solid #10b981;
            border-radius: 50%;
            animation: ping 1s infinite;
          "></div>
        ` : ''}
      </div>
      <style>
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
        @keyframes ping {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      </style>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20]
  });

  const duration = guard.clock_in?.timestamp 
    ? Math.floor((Date.now() - new Date(guard.clock_in.timestamp).getTime()) / 60000)
    : 0;

  return (
    <>
      {/* Movement trail */}
      {lastPositions.length > 1 && (
        <Polyline
          positions={lastPositions}
          pathOptions={{
            color: '#10b981',
            weight: 3,
            opacity: 0.6,
            dashArray: '5, 10'
          }}
        />
      )}

      {/* Accuracy circle */}
      <Circle
        center={position}
        radius={50}
        pathOptions={{
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: 0.1,
          weight: 1
        }}
      />

      {/* Guard marker */}
      <Marker
        position={position}
        icon={guardIcon}
        eventHandlers={{
          click: onClick,
          mouseover: (e) => {
            e.target.openPopup();
          }
        }}
      >
        <Popup>
          <div className="min-w-[200px]">
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-bold text-slate-800">{guard.guard_name}</p>
                <p className="text-xs text-slate-600">Badge: {guard.guard_id}</p>
              </div>
              <Badge className="bg-emerald-500 text-white">On Duty</Badge>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Navigation className="w-3 h-3 text-slate-500" />
                <span className="text-slate-700">{guard.site_name}</span>
              </div>
              
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-slate-500" />
                <span className="text-slate-700">
                  Active for {duration} minutes
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Activity className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 font-semibold">Live Tracking</span>
              </div>
            </div>

            <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-500">
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </Popup>
      </Marker>
    </>
  );
}