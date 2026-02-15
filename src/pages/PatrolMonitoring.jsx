import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MapPin, Clock, CheckCircle2, AlertCircle, Search, BarChart3 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

export default function PatrolMonitoring() {
  const [searchGuard, setSearchGuard] = useState("");
  const [selectedGuard, setSelectedGuard] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSite, setSelectedSite] = useState("");
  const [viewType, setViewType] = useState("logs"); // logs or checklists

  // Fetch all patrol logs for the selected date
  const { data: patrolLogs = [] } = useQuery({
    queryKey: ["patrolLogs", selectedDate],
    queryFn: async () => {
      const allLogs = await base44.entities.PatrolLog.list("-timestamp", 1000);
      
      const startDate = new Date(selectedDate).setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate).setHours(23, 59, 59, 999);
      
      return allLogs.filter(log => {
        const logDate = new Date(log.timestamp).getTime();
        return logDate >= startDate && logDate <= endDate;
      });
    }
  });

  // Fetch all checklist completions for the selected date
  const { data: checklistCompletions = [] } = useQuery({
    queryKey: ["checklistCompletions", selectedDate],
    queryFn: async () => {
      const allChecklists = await base44.entities.ChecklistCompletion.list("-completed_at", 1000);
      
      const startDate = new Date(selectedDate).setHours(0, 0, 0, 0);
      const endDate = new Date(selectedDate).setHours(23, 59, 59, 999);
      
      return allChecklists.filter(c => {
        const completedDate = c.completed_at ? new Date(c.completed_at).getTime() : null;
        return completedDate && completedDate >= startDate && completedDate <= endDate;
      });
    }
  });

  // Fetch all sites and guards for filters
  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => base44.entities.Site.list()
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === 'guard');
    }
  });

  // Filter data based on selections
  let filteredData = viewType === "logs" ? patrolLogs : checklistCompletions;

  if (selectedGuard) {
    filteredData = filteredData.filter(item => item.guard_id === selectedGuard);
  }

  if (selectedSite) {
    filteredData = filteredData.filter(item => item.site_id === selectedSite);
  }

  if (searchGuard) {
    filteredData = filteredData.filter(item => 
      item.guard_name?.toLowerCase().includes(searchGuard.toLowerCase())
    );
  }

  // Stats
  const totalPatrols = patrolLogs.length;
  const completedChecklists = checklistCompletions.filter(c => c.status === 'completed').length;
  const incompleteChecklists = checklistCompletions.filter(c => c.status === 'incomplete').length;
  const verifiedLocations = patrolLogs.filter(l => l.verified).length;

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-white">Patrol Monitoring</h1>
            <p className="text-slate-400 mt-1">Track all patrol scans and checklist completions</p>
          </div>
          <BarChart3 className="w-10 h-10 text-sky-400" />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-slate-400 text-sm mb-2">Total Patrols</p>
                <p className="text-3xl font-bold text-sky-400">{totalPatrols}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-slate-400 text-sm mb-2">Completed Checklists</p>
                <p className="text-3xl font-bold text-emerald-400">{completedChecklists}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-slate-400 text-sm mb-2">Incomplete Checklists</p>
                <p className="text-3xl font-bold text-amber-400">{incompleteChecklists}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-slate-400 text-sm mb-2">Location Verified</p>
                <p className="text-3xl font-bold text-emerald-400">{verifiedLocations}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="bg-slate-800 border-slate-700 mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm text-slate-400 block mb-2">Date</label>
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Site</label>
                <Select value={selectedSite} onValueChange={setSelectedSite}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="All Sites" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>All Sites</SelectItem>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">Guard</label>
                <Select value={selectedGuard} onValueChange={setSelectedGuard}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="All Guards" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>All Guards</SelectItem>
                    {guards.map(guard => (
                      <SelectItem key={guard.id} value={guard.id}>{guard.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-400 block mb-2">View Type</label>
                <Select value={viewType} onValueChange={setViewType}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="logs">Patrol Logs</SelectItem>
                    <SelectItem value="checklists">Checklist Completions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <div className="space-y-3">
          {filteredData.length === 0 ? (
            <Card className="bg-slate-800 border-slate-700">
              <CardContent className="py-12 text-center">
                <AlertCircle className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-400">No records found for selected filters</p>
              </CardContent>
            </Card>
          ) : viewType === "logs" ? (
            // Patrol Logs View
            filteredData.map((log) => (
              <Card key={log.id} className="bg-slate-800 border-slate-700 hover:border-sky-500/50 transition-colors">
                <CardContent className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold text-white mb-1">{log.guard_name}</h4>
                          <p className="text-sm text-slate-400">{log.checkpoint_name}</p>
                        </div>
                        <Badge className={log.verified ? "bg-emerald-500" : "bg-amber-500"}>
                          {log.verified ? "✓ Verified" : "⚠ Unverified"}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                          <Clock className="w-4 h-4 text-sky-400" />
                          {new Date(log.timestamp).toLocaleString()}
                        </div>
                        {log.location && (
                          <div className="flex items-center gap-2 text-sm text-slate-300">
                            <MapPin className="w-4 h-4 text-rose-400" />
                            {log.location.lat.toFixed(6)}, {log.location.lng.toFixed(6)}
                          </div>
                        )}
                      </div>

                      {log.notes && (
                        <div className="mt-3 p-2 bg-slate-900/50 rounded text-sm text-slate-300 border-l-2 border-sky-500">
                          {log.notes}
                        </div>
                      )}
                    </div>

                    {log.location && (
                      <div className="h-48 rounded-lg overflow-hidden border border-slate-700">
                        <MapContainer
                          center={[log.location.lat, log.location.lng]}
                          zoom={15}
                          style={{ height: "100%", width: "100%" }}
                          scrollWheelZoom={false}
                        >
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          <Marker position={[log.location.lat, log.location.lng]}>
                            <Popup>{log.checkpoint_name}</Popup>
                          </Marker>
                        </MapContainer>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            // Checklist Completions View
            filteredData.map((checklist) => (
              <Card key={checklist.id} className="bg-slate-800 border-slate-700 hover:border-sky-500/50 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-white mb-1">{checklist.guard_name}</h4>
                      <p className="text-sm text-slate-400">{checklist.template_name}</p>
                    </div>
                    <Badge className={
                      checklist.status === 'completed' ? "bg-emerald-500" :
                      checklist.status === 'incomplete' ? "bg-amber-500" :
                      "bg-slate-600"
                    }>
                      {checklist.status === 'completed' && <CheckCircle2 className="w-3 h-3 mr-1 inline" />}
                      {checklist.status}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-sm">
                    <div>
                      <p className="text-slate-400">Completed At</p>
                      <p className="text-white font-medium">{checklist.completed_at ? new Date(checklist.completed_at).toLocaleString() : "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Site</p>
                      <p className="text-white font-medium">{checklist.site_id}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Items Checked</p>
                      <p className="text-white font-medium">{checklist.completed_items?.filter(i => i.checked).length || 0}/{checklist.completed_items?.length || 0}</p>
                    </div>
                    {checklist.location && (
                      <div>
                        <p className="text-slate-400">Location</p>
                        <p className="text-sky-400 text-xs">{checklist.location.lat.toFixed(4)}, {checklist.location.lng.toFixed(4)}</p>
                      </div>
                    )}
                  </div>

                  {checklist.notes && (
                    <div className="p-2 bg-slate-900/50 rounded text-sm text-slate-300 border-l-2 border-sky-500">
                      {checklist.notes}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}