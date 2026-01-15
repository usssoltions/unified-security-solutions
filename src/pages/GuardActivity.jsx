import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapContainer, TileLayer, Polyline, Marker, Circle } from "react-leaflet";
import { Activity, MapPin, Clock, Navigation, Download, Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export default function GuardActivity() {
  const [selectedGuard, setSelectedGuard] = useState(null);
  const [dateRange, setDateRange] = useState("today");

  const { data: guards } = useQuery({
    queryKey: ["allGuards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const { data: locationHistory } = useQuery({
    queryKey: ["guardLocationHistory", selectedGuard, dateRange],
    queryFn: async () => {
      if (!selectedGuard) return [];

      const now = new Date();
      let startDate;

      switch (dateRange) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "week":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "month":
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
        default:
          startDate = new Date(now.setHours(0, 0, 0, 0));
      }

      const locations = await base44.entities.LocationTracking.filter(
        { guard_id: selectedGuard },
        "-timestamp",
        1000
      );

      return locations.filter(loc => new Date(loc.timestamp) >= startDate);
    },
    enabled: !!selectedGuard,
    initialData: []
  });

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Calculate statistics
  const stats = React.useMemo(() => {
    if (!locationHistory.length) return null;

    const totalDistance = locationHistory.reduce((acc, loc, idx) => {
      if (idx === 0) return 0;
      const prev = locationHistory[idx - 1];
      return acc + calculateDistance(
        prev.location.lat, prev.location.lng,
        loc.location.lat, loc.location.lng
      );
    }, 0);

    const avgSpeed = locationHistory.reduce((acc, loc) => acc + (loc.speed || 0), 0) / locationHistory.length;

    const activeTime = locationHistory.length * 30 / 60; // 30 second intervals

    return {
      totalDistance: totalDistance.toFixed(2),
      avgSpeed: (avgSpeed * 3.6).toFixed(2), // Convert m/s to km/h
      activeTime: activeTime.toFixed(0),
      dataPoints: locationHistory.length
    };
  }, [locationHistory]);

  // Prepare chart data
  const chartData = React.useMemo(() => {
    if (!locationHistory.length) return [];

    return locationHistory.map((loc, idx) => ({
      time: new Date(loc.timestamp).toLocaleTimeString(),
      speed: (loc.speed || 0) * 3.6, // Convert to km/h
      battery: loc.battery_level || 0
    })).reverse();
  }, [locationHistory]);

  const exportData = () => {
    if (!locationHistory.length) return;

    const csv = [
      "Timestamp,Latitude,Longitude,Speed (km/h),Battery Level,Status",
      ...locationHistory.map(loc =>
        `${loc.timestamp},${loc.location.lat},${loc.location.lng},${(loc.speed || 0) * 3.6},${loc.battery_level || 'N/A'},${loc.status}`
      )
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `guard-activity-${selectedGuard}-${dateRange}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Guard Activity Review</h1>
            <p className="text-slate-400">Historical location tracking and analytics</p>
          </div>
        </div>

        {selectedGuard && (
          <Button onClick={exportData} variant="outline" className="border-slate-600">
            <Download className="w-4 h-4 mr-2" />
            Export Data
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Select Guard</label>
              <Select value={selectedGuard} onValueChange={setSelectedGuard}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Choose a guard..." />
                </SelectTrigger>
                <SelectContent>
                  {guards.map(guard => (
                    <SelectItem key={guard.id} value={guard.id}>
                      {guard.full_name} - {guard.badge_number || guard.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Date Range</label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 Days</SelectItem>
                  <SelectItem value="month">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedGuard && stats && (
        <>
          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Distance Traveled</p>
                    <p className="text-2xl font-bold text-white">{stats.totalDistance} km</p>
                  </div>
                  <Navigation className="w-8 h-8 text-sky-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Avg Speed</p>
                    <p className="text-2xl font-bold text-white">{stats.avgSpeed} km/h</p>
                  </div>
                  <Activity className="w-8 h-8 text-emerald-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Active Time</p>
                    <p className="text-2xl font-bold text-white">{stats.activeTime} min</p>
                  </div>
                  <Clock className="w-8 h-8 text-purple-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Data Points</p>
                    <p className="text-2xl font-bold text-white">{stats.dataPoints}</p>
                  </div>
                  <MapPin className="w-8 h-8 text-amber-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Movement Map */}
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-purple-400" />
                Movement Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px] rounded-lg overflow-hidden border border-slate-700">
                {locationHistory.length > 0 && (
                  <MapContainer
                    center={[locationHistory[0].location.lat, locationHistory[0].location.lng]}
                    zoom={14}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap contributors'
                    />

                    {/* Movement path */}
                    <Polyline
                      positions={locationHistory.map(loc => [loc.location.lat, loc.location.lng])}
                      pathOptions={{
                        color: '#8b5cf6',
                        weight: 4,
                        opacity: 0.7
                      }}
                    />

                    {/* Start marker */}
                    <Marker
                      position={[
                        locationHistory[locationHistory.length - 1].location.lat,
                        locationHistory[locationHistory.length - 1].location.lng
                      ]}
                    />

                    {/* End marker */}
                    <Circle
                      center={[locationHistory[0].location.lat, locationHistory[0].location.lng]}
                      radius={50}
                      pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.3 }}
                    />
                  </MapContainer>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Speed Chart */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-sm">Speed Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line type="monotone" dataKey="speed" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Battery Chart */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-sm">Battery Level</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} />
                    <YAxis stroke="#94a3b8" fontSize={10} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#94a3b8' }}
                    />
                    <Line type="monotone" dataKey="battery" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {!selectedGuard && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="py-12 text-center">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">Select a guard to view their activity history</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}