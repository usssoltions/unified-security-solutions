import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Users, AlertTriangle, Navigation, Activity, Layers } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import GuardLocationMarker from "./GuardLocationMarker";
import LocationHeatmap from "./LocationHeatmap";

// Fix Leaflet default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

function MapUpdater({ guards, incidents, alarms }) {
  const map = useMap();
  
  useEffect(() => {
    if (guards.length > 0) {
      const bounds = guards
        .filter(g => g.clock_in?.location)
        .map(g => [g.clock_in.location.lat, g.clock_in.location.lng]);
      
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      }
    }
  }, [guards, map]);
  
  return null;
}

export default function LiveMap({ guards, incidents, alarms }) {
  const [selectedGuard, setSelectedGuard] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [mapView, setMapView] = useState("satellite"); // satellite, street, terrain
  const mapRef = useRef();

  const activeGuards = guards.filter(g => g.clock_in?.location);
  
  // Default center (Yzerfontein)
  const defaultCenter = [-33.3482, 18.1615];
  const mapCenter = activeGuards.length > 0 
    ? [activeGuards[0].clock_in.location.lat, activeGuards[0].clock_in.location.lng]
    : defaultCenter;

  const getTileLayer = () => {
    switch(mapView) {
      case "satellite":
        return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
      case "terrain":
        return "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";
      default:
        return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    }
  };

  const incidentIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  const alarmIcon = new L.Icon({
    iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png",
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <MapPin className="w-5 h-5 text-sky-400" />
            Live Fleet Map
            <Badge variant="outline" className="ml-2 border-emerald-500 text-emerald-400">
              {activeGuards.length} Active
            </Badge>
          </CardTitle>
          
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={showHeatmap ? "default" : "outline"}
              onClick={() => setShowHeatmap(!showHeatmap)}
              className={showHeatmap ? "bg-purple-600" : "border-slate-600"}
            >
              <Activity className="w-4 h-4 mr-2" />
              Heatmap
            </Button>
            
            <select
              value={mapView}
              onChange={(e) => setMapView(e.target.value)}
              className="px-3 py-1 bg-slate-900 border border-slate-700 rounded text-white text-sm"
            >
              <option value="street">Street</option>
              <option value="satellite">Satellite</option>
              <option value="terrain">Terrain</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative h-[500px] rounded-lg overflow-hidden border border-slate-700">
          <MapContainer
            center={mapCenter}
            zoom={13}
            style={{ height: "100%", width: "100%" }}
            ref={mapRef}
          >
            <TileLayer
              url={getTileLayer()}
              attribution='&copy; Map data'
            />
            
            <MapUpdater guards={guards} incidents={incidents} alarms={alarms} />

            {/* Guard Markers with Real-time Tracking */}
            {activeGuards.map((guard) => (
              <GuardLocationMarker
                key={guard.id}
                guard={guard}
                isSelected={selectedGuard?.id === guard.id}
                onClick={() => setSelectedGuard(guard)}
              />
            ))}

            {/* Incident Markers */}
            {incidents.filter(i => i.location).map((incident) => (
              <Marker
                key={incident.id}
                position={[incident.location.lat, incident.location.lng]}
                icon={incidentIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold text-rose-600">{incident.title}</p>
                    <p className="text-xs text-gray-600">{incident.category}</p>
                    <Badge className={
                      incident.priority === 'critical' ? 'bg-rose-500' :
                      incident.priority === 'high' ? 'bg-orange-500' : 'bg-amber-500'
                    }>
                      {incident.priority}
                    </Badge>
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Alarm Response Markers */}
            {alarms.filter(a => a.location).map((alarm) => (
              <Marker
                key={alarm.id}
                position={[alarm.location.lat, alarm.location.lng]}
                icon={alarmIcon}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-bold text-orange-600">{alarm.alarm_type}</p>
                    <p className="text-xs">{alarm.address}</p>
                    <Badge className="bg-orange-500">{alarm.status}</Badge>
                    {alarm.assigned_to_name && (
                      <p className="text-xs mt-1">Assigned: {alarm.assigned_to_name}</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Location Heatmap Overlay */}
            {showHeatmap && <LocationHeatmap guards={activeGuards} />}
          </MapContainer>

          {/* Guard Info Overlay */}
          {selectedGuard && (
            <div className="absolute top-4 right-4 w-64 bg-slate-800/95 backdrop-blur-sm border border-slate-700 rounded-lg p-4 z-[1000]">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-white font-semibold">{selectedGuard.guard_name}</h3>
                  <p className="text-xs text-slate-400">Badge: {selectedGuard.guard_id}</p>
                </div>
                <Badge className="bg-emerald-500">On Duty</Badge>
              </div>
              
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Site:</span>
                  <span className="text-white">{selectedGuard.site_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status:</span>
                  <span className="text-emerald-400">Active</span>
                </div>
                {selectedGuard.clock_in && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Clocked In:</span>
                    <span className="text-white">
                      {new Date(selectedGuard.clock_in.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full mt-3 border-slate-600"
                onClick={() => setSelectedGuard(null)}
              >
                Close
              </Button>
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-slate-400">Active Guards ({activeGuards.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-rose-500 rounded" />
            <span className="text-slate-400">Incidents ({incidents.filter(i => i.location).length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-orange-500 rounded" />
            <span className="text-slate-400">Alarm Responses ({alarms.filter(a => a.location).length})</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}