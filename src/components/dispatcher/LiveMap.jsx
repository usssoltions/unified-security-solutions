import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Shield, TrendingUp, MapPin } from "lucide-react";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const createGuardIcon = (workload, isHighPerformer) => {
  const color = workload === 0 ? '#10b981' : workload === 1 ? '#f59e0b' : '#ef4444';
  const size = isHighPerformer ? 36 : 32;
  
  return new L.Icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${size/2}" cy="${size/2}" r="${size/2 - 2}" fill="${color}" stroke="white" stroke-width="2"/>
        ${isHighPerformer ? `<polygon points="${size/2},${size/2 - 6} ${size/2 + 4},${size/2 + 2} ${size/2 - 4},${size/2 + 2}" fill="white"/>` : `<circle cx="${size/2}" cy="${size/2}" r="4" fill="white"/>`}
      </svg>
    `),
    iconSize: [size, size],
    iconAnchor: [size/2, size],
    popupAnchor: [0, -size]
  });
};

export default function LiveMap({ activeGuards }) {
  const [guardsWithData, setGuardsWithData] = useState([]);

  useEffect(() => {
    const fetchGuardData = async () => {
      const enrichedGuards = [];
      
      for (const shift of activeGuards) {
        try {
          const user = await base44.entities.User.get(shift.guard_id);
          if (user?.last_location?.lat && user?.last_location?.lng) {
            enrichedGuards.push({
              ...shift,
              location: user.last_location,
              workload: user.current_workload || 0,
              performance: user.performance_rating || 5,
              skills: user.skills || []
            });
          }
        } catch (error) {
          console.error('Failed to fetch guard data:', error);
        }
      }
      
      setGuardsWithData(enrichedGuards);
    };

    if (activeGuards?.length > 0) {
      fetchGuardData();
    }
  }, [activeGuards]);

  if (guardsWithData.length === 0) {
    return (
      <div className="h-[500px] bg-slate-900 rounded-lg flex items-center justify-center">
        <p className="text-slate-400">No active guards with location data</p>
      </div>
    );
  }

  const bounds = guardsWithData.map(g => [g.location.lat, g.location.lng]);
  const center = bounds.length > 0 
    ? [
        bounds.reduce((sum, coord) => sum + coord[0], 0) / bounds.length,
        bounds.reduce((sum, coord) => sum + coord[1], 0) / bounds.length
      ]
    : [-33.9249, 18.4241];

  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
          <span className="text-slate-400">Available (0 tasks)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-amber-500"></div>
          <span className="text-slate-400">Busy (1 task)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-rose-500"></div>
          <span className="text-slate-400">Overloaded (2+ tasks)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-sky-500 border-2 border-white"></div>
          <span className="text-slate-400">High Performer</span>
        </div>
      </div>

      <MapContainer
        center={center}
        zoom={11}
        style={{ height: "500px", width: "100%", borderRadius: "0.5rem" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />

        {guardsWithData.map((guard) => (
          <React.Fragment key={guard.guard_id}>
            <Marker
              position={[guard.location.lat, guard.location.lng]}
              icon={createGuardIcon(guard.workload, guard.performance >= 4.5)}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-bold text-slate-900">{guard.guard_name}</p>
                    {guard.performance >= 4.5 && <span className="text-amber-500 font-bold">★</span>}
                  </div>
                  
                  <div className="space-y-1 text-xs text-slate-600">
                    <p className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {guard.site_name}
                    </p>
                    <p className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Workload: {guard.workload} active tasks
                    </p>
                    <p className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      Performance: {guard.performance}/5
                    </p>
                    
                    {guard.skills.length > 0 && (
                      <div className="mt-2">
                        <p className="font-semibold text-slate-700 mb-1">Skills:</p>
                        <div className="flex flex-wrap gap-1">
                          {guard.skills.map((skill, i) => (
                            <span key={i} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">
                              {skill.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="mt-2 pt-2 border-t">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        guard.workload === 0 ? 'bg-emerald-100 text-emerald-700' :
                        guard.workload === 1 ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>
                        {guard.workload === 0 ? 'Available' : guard.workload === 1 ? 'Busy' : 'Overloaded'}
                      </span>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>

            <Circle
              center={[guard.location.lat, guard.location.lng]}
              radius={guard.workload === 0 ? 800 : guard.workload === 1 ? 500 : 300}
              pathOptions={{
                color: guard.workload === 0 ? '#10b981' : guard.workload === 1 ? '#f59e0b' : '#ef4444',
                fillColor: guard.workload === 0 ? '#10b981' : guard.workload === 1 ? '#f59e0b' : '#ef4444',
                fillOpacity: 0.05,
                weight: 1
              }}
            />
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}