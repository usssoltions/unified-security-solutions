import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import { MapPin, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in react-leaflet
import L from "leaflet";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png"
});

export default function LiveMap({ guards }) {
  const defaultCenter = guards.length > 0 && guards[0].clock_in?.location
    ? [guards[0].clock_in.location.lat, guards[0].clock_in.location.lng]
    : [40.7128, -74.0060]; // Default to NYC

  return (
    <Card className="bg-slate-800/50 border-slate-700 h-[600px]">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <MapPin className="w-5 h-5 text-sky-400" />
          Live Fleet Map
          <Badge className="ml-auto bg-emerald-500">{guards.length} Active</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[calc(100%-80px)]">
        <MapContainer
          center={defaultCenter}
          zoom={12}
          style={{ height: "100%", width: "100%", borderRadius: "8px" }}
          className="z-0"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {guards.map((guard) => {
            const location = guard.clock_in?.location;
            if (!location) return null;

            return (
              <React.Fragment key={guard.id}>
                <Marker position={[location.lat, location.lng]}>
                  <Popup>
                    <div className="text-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="w-4 h-4 text-sky-500" />
                        <strong>{guard.guard_name}</strong>
                      </div>
                      <p className="text-slate-600">{guard.site_name}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Clocked in: {new Date(guard.clock_in.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </Popup>
                </Marker>
                <Circle
                  center={[location.lat, location.lng]}
                  radius={100}
                  pathOptions={{ color: '#0ea5e9', fillColor: '#0ea5e9', fillOpacity: 0.1 }}
                />
              </React.Fragment>
            );
          })}
        </MapContainer>
      </CardContent>
    </Card>
  );
}