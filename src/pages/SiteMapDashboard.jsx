import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, MapPin, Activity, Users, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Fix leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const createColoredIcon = (color) => L.divIcon({
  html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px ${color}88;"></div>`,
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const siteIcon = (hasActivePatrol) => L.divIcon({
  html: `<div style="
    width:32px;height:32px;
    background:${hasActivePatrol ? '#10b981' : '#0ea5e9'};
    border:3px solid white;
    border-radius:50% 50% 50% 0;
    transform:rotate(-45deg);
    box-shadow:0 2px 8px rgba(0,0,0,0.4);
  "></div>`,
  className: "",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32],
});

export default function SiteMapDashboard() {
  const [mapCenter, setMapCenter] = useState([-26.2041, 28.0473]); // Johannesburg default

  const { data: sites = [], refetch: refetchSites } = useQuery({
    queryKey: ["mapSites"],
    queryFn: () => base44.entities.Site.filter({ status: "active" }),
    refetchInterval: 60000,
  });

  const { data: activePatrols = [], refetch: refetchPatrols } = useQuery({
    queryKey: ["mapActivePatrols"],
    queryFn: () => base44.entities.ScheduledPatrol.filter({ status: "active" }),
    refetchInterval: 30000,
  });

  const { data: activeShifts = [] } = useQuery({
    queryKey: ["mapActiveShifts"],
    queryFn: () => base44.entities.Shift.filter({ status: "active" }),
    refetchInterval: 60000,
  });

  const { data: recentIncidents = [] } = useQuery({
    queryKey: ["mapIncidents"],
    queryFn: async () => {
      const all = await base44.entities.Incident.filter({ status: "reported" });
      return all.filter(i => i.location?.lat);
    },
    refetchInterval: 30000,
  });

  // Auto-center on first site with location
  useEffect(() => {
    const withLoc = sites.find(s => s.location?.lat);
    if (withLoc) setMapCenter([withLoc.location.lat, withLoc.location.lng]);
  }, [sites]);

  const sitesWithLocation = sites.filter(s => s.location?.lat);
  const activePatrolSiteIds = new Set(activePatrols.map(p => p.site_id));

  const stats = [
    { label: "Active Sites", value: sites.length, icon: MapPin, color: "text-sky-400" },
    { label: "Active Patrols", value: activePatrols.length, icon: Shield, color: "text-emerald-400" },
    { label: "Guards on Duty", value: activeShifts.length, icon: Users, color: "text-purple-400" },
    { label: "Open Incidents", value: recentIncidents.length, icon: AlertTriangle, color: "text-rose-400" },
  ];

  const handleRefresh = () => { refetchSites(); refetchPatrols(); };

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-sky-400" /> Live Site Map
          </h1>
          <p className="text-slate-400 mt-1">Real-time sites, patrols & incidents</p>
        </div>
        <Button onClick={handleRefresh} variant="outline" className="border-slate-600 text-slate-300">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={`w-6 h-6 ${color} shrink-0`} />
              <div>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-slate-400">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Map */}
        <Card className="lg:col-span-3 bg-slate-800/50 border-slate-700 overflow-hidden">
          <CardContent className="p-0">
            {sitesWithLocation.length === 0 ? (
              <div className="h-[500px] flex flex-col items-center justify-center">
                <MapPin className="w-12 h-12 text-slate-600 mb-3" />
                <p className="text-slate-400">No sites with location data found.</p>
                <p className="text-slate-500 text-sm mt-1">Add GPS coordinates to sites in Site Management.</p>
              </div>
            ) : (
              <MapContainer
                center={mapCenter}
                zoom={12}
                style={{ height: "500px", width: "100%" }}
                className="z-0"
              >
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; OpenStreetMap contributors'
                />

                {/* Site markers */}
                {sitesWithLocation.map(site => {
                  const hasActivePatrol = activePatrolSiteIds.has(site.id);
                  const sitePatrols = activePatrols.filter(p => p.site_id === site.id);
                  const siteShifts = activeShifts.filter(s => s.site_id === site.id);
                  return (
                    <React.Fragment key={site.id}>
                      <Marker
                        position={[site.location.lat, site.location.lng]}
                        icon={siteIcon(hasActivePatrol)}
                      >
                        <Popup>
                          <div className="min-w-[180px]">
                            <p className="font-bold text-slate-800 mb-1">{site.name}</p>
                            <p className="text-xs text-slate-500 mb-2">{site.address}</p>
                            <div className="space-y-1 text-xs">
                              <div className="flex justify-between">
                                <span>Client:</span>
                                <span className="font-medium">{site.client_name}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Active Patrols:</span>
                                <span className={`font-bold ${hasActivePatrol ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {sitePatrols.length}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Guards on duty:</span>
                                <span className="font-medium">{siteShifts.length}</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Checkpoints:</span>
                                <span className="font-medium">{site.checkpoints?.length || 0}</span>
                              </div>
                            </div>
                          </div>
                        </Popup>
                      </Marker>
                      {/* Geofence circle */}
                      {site.geofence_radius && (
                        <Circle
                          center={[site.location.lat, site.location.lng]}
                          radius={site.geofence_radius}
                          pathOptions={{ color: hasActivePatrol ? '#10b981' : '#0ea5e9', fillOpacity: 0.05, weight: 1 }}
                        />
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Active patrol guard positions (last GPS point) */}
                {activePatrols.map(patrol => {
                  const lastGps = patrol.gps_track?.[patrol.gps_track.length - 1];
                  if (!lastGps?.lat) return null;
                  return (
                    <Marker
                      key={`patrol-${patrol.id}`}
                      position={[lastGps.lat, lastGps.lng]}
                      icon={createColoredIcon('#10b981')}
                    >
                      <Popup>
                        <div className="min-w-[160px]">
                          <p className="font-bold text-emerald-700 mb-1">🛡️ On Patrol</p>
                          <p className="text-xs font-medium">{patrol.guard_name}</p>
                          <p className="text-xs text-slate-500">{patrol.site_name}</p>
                          <p className="text-xs mt-1">
                            {patrol.checkpoints_completed}/{patrol.checkpoints_total} checkpoints
                          </p>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {/* Incident markers */}
                {recentIncidents.map(inc => (
                  <Marker
                    key={`inc-${inc.id}`}
                    position={[inc.location.lat, inc.location.lng]}
                    icon={createColoredIcon('#f43f5e')}
                  >
                    <Popup>
                      <div className="min-w-[160px]">
                        <p className="font-bold text-rose-600 mb-1">⚠️ {inc.title}</p>
                        <p className="text-xs text-slate-500">{inc.category} · {inc.priority}</p>
                        <p className="text-xs">{inc.site_name}</p>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            )}
          </CardContent>
        </Card>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Legend */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm">Legend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {[
                { color: "bg-emerald-500", label: "Site with active patrol" },
                { color: "bg-sky-500", label: "Site (no active patrol)" },
                { color: "bg-emerald-400 rounded-full", label: "Guard on patrol (GPS)" },
                { color: "bg-rose-500 rounded-full", label: "Open incident" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`w-3 h-3 ${color} shrink-0`} />
                  <span className="text-slate-300">{label}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Active Patrols list */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" /> Active Patrols
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activePatrols.length === 0 ? (
                <p className="text-slate-500 text-xs text-center py-3">No active patrols</p>
              ) : activePatrols.map(p => (
                <div key={p.id} className="p-2 bg-emerald-900/20 border border-emerald-800/40 rounded-lg">
                  <p className="text-white text-xs font-semibold">{p.guard_name}</p>
                  <p className="text-slate-400 text-xs">{p.site_name}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: p.checkpoints_total > 0 ? `${(p.checkpoints_completed / p.checkpoints_total) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-emerald-400 text-xs">{p.checkpoints_completed}/{p.checkpoints_total}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Sites without location */}
          {sites.filter(s => !s.location?.lat).length > 0 && (
            <Card className="bg-amber-900/20 border-amber-800/40">
              <CardContent className="p-3">
                <p className="text-amber-400 text-xs font-semibold flex items-center gap-1 mb-1">
                  <AlertTriangle className="w-3 h-3" /> Missing GPS
                </p>
                {sites.filter(s => !s.location?.lat).map(s => (
                  <p key={s.id} className="text-slate-400 text-xs">• {s.name}</p>
                ))}
                <p className="text-slate-500 text-xs mt-1">Add coordinates in Site Management.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}