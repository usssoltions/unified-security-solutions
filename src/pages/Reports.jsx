import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Wrench, Calendar, MapPin, User, Download, Search, Filter, Camera, Video, Mic } from "lucide-react";

export default function Reports() {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [selectedReport, setSelectedReport] = useState(null);

  const { data: incidents = [] } = useQuery({
    queryKey: ["allIncidents"],
    queryFn: async () => base44.entities.Incident.list("-reported_at", 200),
    initialData: []
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ["allMaintenance"],
    queryFn: async () => base44.entities.MaintenanceRequest.list("-reported_at", 200),
    initialData: []
  });

  const filterByDate = (items) => {
    if (dateFilter === "all") return items;
    
    const now = new Date();
    return items.filter(item => {
      const reportDate = new Date(item.reported_at);
      const diffDays = (now - reportDate) / (1000 * 60 * 60 * 24);
      
      if (dateFilter === "today") return diffDays < 1;
      if (dateFilter === "week") return diffDays < 7;
      if (dateFilter === "month") return diffDays < 30;
      return true;
    });
  };

  const filterBySearch = (items, searchFields) => {
    if (!searchTerm) return items;
    
    const term = searchTerm.toLowerCase();
    return items.filter(item => 
      searchFields.some(field => 
        item[field]?.toLowerCase().includes(term)
      )
    );
  };

  const filteredIncidents = filterBySearch(
    filterByDate(incidents),
    ["title", "description", "guard_name", "site_name", "category"]
  );

  const filteredMaintenance = filterBySearch(
    filterByDate(maintenance),
    ["title", "description", "guard_name", "site_name", "category"]
  );

  const exportToCSV = (data, filename) => {
    const headers = ["Date", "Type", "Site", "Guard", "Status", "Priority/Urgency", "Description"];
    const rows = data.map(item => [
      new Date(item.reported_at).toLocaleString(),
      item.category || item.title,
      item.site_name,
      item.guard_name,
      item.status,
      item.priority || item.urgency,
      item.description?.substring(0, 100)
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell || ''}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };

  const priorityColors = {
    critical: "bg-red-600",
    high: "bg-rose-500",
    medium: "bg-amber-500",
    low: "bg-emerald-500"
  };

  const statusColors = {
    reported: "bg-amber-500",
    assigned: "bg-sky-500",
    in_progress: "bg-purple-500",
    resolved: "bg-emerald-500",
    closed: "bg-slate-500",
    completed: "bg-emerald-500",
    cancelled: "bg-red-500"
  };

  const ReportCard = ({ report, type }) => {
    const isIncident = type === "incident";
    const media = report.media || [];
    const photos = media.filter(m => m.type === "photo");
    const videos = media.filter(m => m.type === "video");
    const audio = media.filter(m => m.type === "audio");

    return (
      <Card
        className="bg-slate-800/50 border-slate-700 hover:border-slate-600 cursor-pointer transition-all"
        onClick={() => setSelectedReport({ ...report, reportType: type })}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-start gap-3 flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isIncident ? 'bg-rose-500/20' : 'bg-amber-500/20'}`}>
                {isIncident ? <AlertTriangle className="w-5 h-5 text-rose-400" /> : <Wrench className="w-5 h-5 text-amber-400" />}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">{report.title}</h3>
                <p className="text-sm text-slate-400 line-clamp-2">{report.description}</p>
              </div>
            </div>
            <Badge className={statusColors[report.status]}>
              {report.status}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1 text-slate-400">
              <User className="w-3 h-3" />
              {report.guard_name}
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <MapPin className="w-3 h-3" />
              {report.site_name}
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <Calendar className="w-3 h-3" />
              {new Date(report.reported_at).toLocaleDateString()}
            </div>
            {(isIncident ? report.priority : report.urgency) && (
              <Badge className={priorityColors[(isIncident ? report.priority : report.urgency)?.toLowerCase()]}>
                {isIncident ? report.priority : report.urgency}
              </Badge>
            )}
          </div>

          {media.length > 0 && (
            <div className="flex gap-2 mt-3 text-xs text-slate-400">
              {photos.length > 0 && (
                <span className="flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  {photos.length}
                </span>
              )}
              {videos.length > 0 && (
                <span className="flex items-center gap-1">
                  <Video className="w-3 h-3" />
                  {videos.length}
                </span>
              )}
              {audio.length > 0 && (
                <span className="flex items-center gap-1">
                  <Mic className="w-3 h-3" />
                  {audio.length}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const ReportDetailModal = ({ report, onClose }) => {
    if (!report) return null;

    const isIncident = report.reportType === "incident";
    const media = report.media || [];

    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <Card className="w-full max-w-4xl bg-slate-800 border-slate-700 my-8">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isIncident ? 'bg-rose-500/20' : 'bg-amber-500/20'}`}>
                  {isIncident ? <AlertTriangle className="w-6 h-6 text-rose-400" /> : <Wrench className="w-6 h-6 text-amber-400" />}
                </div>
                <div>
                  <CardTitle className="text-white">{report.title}</CardTitle>
                  <p className="text-sm text-slate-400">
                    {isIncident ? "Incident Report" : "Maintenance Request"}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <span className="text-white text-2xl">×</span>
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-400 block mb-1">Reported By</label>
                <p className="text-white">{report.guard_name}</p>
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Site</label>
                <p className="text-white">{report.site_name}</p>
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Date & Time</label>
                <p className="text-white">{new Date(report.reported_at).toLocaleString()}</p>
              </div>
              <div>
                <label className="text-sm text-slate-400 block mb-1">Status</label>
                <Badge className={statusColors[report.status]}>
                  {report.status}
                </Badge>
              </div>
              {(isIncident ? report.priority : report.urgency) && (
                <div>
                  <label className="text-sm text-slate-400 block mb-1">
                    {isIncident ? "Priority" : "Urgency"}
                  </label>
                  <Badge className={priorityColors[(isIncident ? report.priority : report.urgency)?.toLowerCase()]}>
                    {isIncident ? report.priority : report.urgency}
                  </Badge>
                </div>
              )}
              {report.category && (
                <div>
                  <label className="text-sm text-slate-400 block mb-1">Category</label>
                  <p className="text-white capitalize">{report.category.replace(/_/g, " ")}</p>
                </div>
              )}
            </div>

            {report.location && (
              <div>
                <label className="text-sm text-slate-400 block mb-1">GPS Location</label>
                <p className="text-white font-mono text-sm">
                  {report.location.lat.toFixed(6)}, {report.location.lng.toFixed(6)}
                </p>
              </div>
            )}

            <div>
              <label className="text-sm text-slate-400 block mb-2">Full Report</label>
              <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                <pre className="text-white text-sm whitespace-pre-wrap font-sans">
                  {report.description}
                </pre>
              </div>
            </div>

            {media.length > 0 && (
              <div>
                <label className="text-sm text-slate-400 block mb-2">Evidence Attached</label>
                <div className="grid grid-cols-3 gap-3">
                  {media.map((item, idx) => (
                    <div key={idx} className="relative group">
                      {item.type === "photo" && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={item.url}
                            alt="Evidence"
                            className="w-full h-32 object-cover rounded-lg border border-slate-700 hover:border-sky-500 transition-all"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                            <Camera className="w-6 h-6 text-white" />
                          </div>
                        </a>
                      )}
                      {item.type === "video" && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <video
                            src={item.url}
                            className="w-full h-32 object-cover rounded-lg border border-slate-700 hover:border-sky-500 transition-all"
                          />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                            <Video className="w-6 h-6 text-white" />
                          </div>
                        </a>
                      )}
                      {item.type === "audio" && (
                        <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3 flex items-center justify-center h-32">
                          <audio src={item.url} controls className="w-full" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {report.dispatcher_notes && (
              <div>
                <label className="text-sm text-slate-400 block mb-1">Dispatcher Notes</label>
                <p className="text-white">{report.dispatcher_notes}</p>
              </div>
            )}

            {report.resolution_notes && (
              <div>
                <label className="text-sm text-slate-400 block mb-1">Resolution Notes</label>
                <p className="text-white">{report.resolution_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Reports & Documentation</h1>
            <p className="text-slate-400 mt-1">Comprehensive incident and maintenance reports</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search reports by title, description, guard, site..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-800 border-slate-700 text-white"
              icon={<Search className="w-4 h-4" />}
            />
          </div>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-md text-white"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>

        <Tabs defaultValue="incidents" className="space-y-6">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="incidents" className="data-[state=active]:bg-rose-600">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Incidents ({filteredIncidents.length})
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="data-[state=active]:bg-amber-600">
              <Wrench className="w-4 h-4 mr-2" />
              Maintenance ({filteredMaintenance.length})
            </TabsTrigger>
            <TabsTrigger value="all" className="data-[state=active]:bg-sky-600">
              All Reports ({filteredIncidents.length + filteredMaintenance.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="incidents" className="space-y-4">
            <div className="flex justify-end">
              <Button
                onClick={() => exportToCSV(filteredIncidents, "incidents_report.csv")}
                variant="outline"
                className="border-slate-600 text-slate-300"
              >
                <Download className="w-4 h-4 mr-2" />
                Export to CSV
              </Button>
            </div>

            {filteredIncidents.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No incident reports found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredIncidents.map((incident) => (
                  <ReportCard key={incident.id} report={incident} type="incident" />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-4">
            <div className="flex justify-end">
              <Button
                onClick={() => exportToCSV(filteredMaintenance, "maintenance_report.csv")}
                variant="outline"
                className="border-slate-600 text-slate-300"
              >
                <Download className="w-4 h-4 mr-2" />
                Export to CSV
              </Button>
            </div>

            {filteredMaintenance.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No maintenance reports found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredMaintenance.map((request) => (
                  <ReportCard key={request.id} report={request} type="maintenance" />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-4">
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  const allReports = [
                    ...filteredIncidents.map(i => ({ ...i, reportType: "Incident" })),
                    ...filteredMaintenance.map(m => ({ ...m, reportType: "Maintenance" }))
                  ].sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at));
                  exportToCSV(allReports, "all_reports.csv");
                }}
                variant="outline"
                className="border-slate-600 text-slate-300"
              >
                <Download className="w-4 h-4 mr-2" />
                Export All to CSV
              </Button>
            </div>

            {filteredIncidents.length === 0 && filteredMaintenance.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <Filter className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No reports found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...filteredIncidents, ...filteredMaintenance]
                  .sort((a, b) => new Date(b.reported_at) - new Date(a.reported_at))
                  .map((report) => (
                    <ReportCard
                      key={report.id}
                      report={report}
                      type={filteredIncidents.includes(report) ? "incident" : "maintenance"}
                    />
                  ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {selectedReport && (
          <ReportDetailModal
            report={selectedReport}
            onClose={() => setSelectedReport(null)}
          />
        )}
      </div>
    </div>
  );
}