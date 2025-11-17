
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle,
  Wrench,
  FileText, // New
  Download,
  Search,
  Calendar,
  Trash2,
  Edit, // New
  MapPin,
  User,
  Clock, // New
  Image, // New (for photo icon)
  Video,
  Mic,
  X,
  ChevronRight, // Existing, but used differently in outline
  CheckCircle2 // Existing, but less used in outline
} from "lucide-react";

export default function Reports() {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [selectedReport, setSelectedReport] = useState(null); // Holds the report object
  const [showStatusUpdate, setShowStatusUpdate] = useState(null); // Holds the report object to update
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // Holds the report object to delete
  // statusNotes and deleteReason are now managed locally within their respective modals
  const queryClient = useQueryClient();

  const { data: incidents = [] } = useQuery({
    queryKey: ["incidents"], // Changed key
    queryFn: async () => base44.entities.Incident.list("-reported_at", 100), // Changed limit
    initialData: [],
    refetchInterval: 5000, // Real-time sync
    staleTime: 0,
    cacheTime: 0
  });

  const { data: maintenance = [] } = useQuery({
    queryKey: ["maintenance"], // Changed key
    queryFn: async () => base44.entities.MaintenanceRequest.list("-reported_at", 100), // Changed limit
    initialData: [],
    refetchInterval: 5000, // Real-time sync
    staleTime: 0,
    cacheTime: 0
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, entityType, newStatus, notes }) => {
      const entity = entityType === 'incident'
        ? base44.entities.Incident
        : base44.entities.MaintenanceRequest;

      const updateData = { status: newStatus };

      if (notes) {
        if (newStatus === 'resolved' || newStatus === 'completed') {
          updateData[entityType === 'incident' ? 'resolution_notes' : 'completion_notes'] = notes;
          updateData[entityType === 'incident' ? 'resolved_at' : 'completed_at'] = new Date().toISOString();
        } else { // For other statuses like assigned, in_progress
          updateData.dispatcher_notes = notes;
        }
      }

      await entity.update(id, updateData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["incidents"]);
      queryClient.invalidateQueries(["maintenance"]);
      setShowStatusUpdate(null); // Reset the state, now it holds the object
      setSelectedReport(null); // Close detail modal if open
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, entityType, reason }) => {
      const entity = entityType === 'incident'
        ? base44.entities.Incident
        : base44.entities.MaintenanceRequest;

      await base44.entities.Alert.create({
        type: "system",
        priority: "medium", // Changed priority
        title: `${entityType === "incident" ? "Incident" : "Maintenance"} Report Deleted`, // Changed title
        message: `Report #${id} deleted. Reason: ${reason}`, // Changed message
        status: "acknowledged"
      });

      await entity.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["incidents"]);
      queryClient.invalidateQueries(["maintenance"]);
      setShowDeleteConfirm(null); // Reset the state, now it holds the object
      setSelectedReport(null); // Also clear selected report to close detail modal
    }
  });

  const filterByDate = (items) => {
    if (dateFilter === "all") return items;

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    return items.filter(item => {
      const reportDate = new Date(item.reported_at || item.created_date); // Handle different date fields
      const reportDay = new Date(reportDate.getFullYear(), reportDate.getMonth(), reportDate.getDate());

      if (dateFilter === "today") return reportDay.getTime() === today.getTime();
      if (dateFilter === "week") {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return reportDate >= weekAgo;
      }
      if (dateFilter === "month") {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return reportDate >= monthAgo;
      }
      return true;
    });
  };

  const filterBySearch = (items) => { // Simpler filter by search
    if (!searchTerm) return items;

    const term = searchTerm.toLowerCase();
    return items.filter(item =>
      item.title?.toLowerCase().includes(term) ||
      item.description?.toLowerCase().includes(term) ||
      item.guard_name?.toLowerCase().includes(term) ||
      item.site_name?.toLowerCase().includes(term)
    );
  };

  // Combine all reports and add a 'type' property for easier filtering and rendering
  const allReports = [
    ...incidents.map(i => ({ ...i, type: 'incident' })),
    ...maintenance.map(m => ({ ...m, type: 'maintenance' }))
  ].sort((a, b) => new Date(b.reported_at || b.created_date) - new Date(a.reported_at || a.created_date));


  const filteredIncidents = filterBySearch(filterByDate(incidents));
  const filteredMaintenance = filterBySearch(filterByDate(maintenance));
  const filteredAll = filterBySearch(filterByDate(allReports));


  const exportToCSV = (data, filename) => {
    if (!data || data.length === 0) {
      alert("No data to export.");
      return;
    }

    const headers = ["Date", "Type/Category", "Title", "Guard", "Site", "Status", "Priority/Urgency", "Description"];
    const rows = data.map(item => [
      new Date(item.reported_at || item.created_date).toLocaleString(),
      item.category || item.type || 'N/A', // Use item.type if category is not present
      item.title || 'N/A',
      item.guard_name || 'N/A',
      item.site_name || 'N/A',
      item.status || 'N/A',
      item.priority || item.urgency || 'N/A',
      item.description?.replace(/"/g, '""') || 'N/A' // Escape quotes in description
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell || ''}"`).join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url); // Clean up
  };

  // Define color mappings globally to avoid re-declaration
  const priorityColors = {
    critical: "bg-rose-600",
    high: "bg-orange-600",
    medium: "bg-amber-600",
    low: "bg-sky-600"
  };

  const statusColors = {
    reported: "bg-amber-500",
    assigned: "bg-sky-500",
    in_progress: "bg-purple-500",
    resolved: "bg-emerald-500",
    closed: "bg-slate-500",
    completed: "bg-emerald-500",
    cancelled: "bg-rose-500" // Added 'cancelled' status color
  };

  const ReportCard = ({ report, type }) => {
    const mediaCount = {
      photos: report.media?.filter(m => m.type === 'photo').length || 0,
      videos: report.media?.filter(m => m.type === 'video').length || 0,
      audio: report.media?.filter(m => m.type === 'audio').length || 0
    };

    return (
      <Card
        className="bg-slate-800/50 border-slate-700 cursor-pointer hover:border-sky-500/50 transition-colors"
        onClick={() => setSelectedReport({ ...report, type })} // Pass type with the report
      >
        <CardHeader className="pb-3"> {/* Added pb-3 for spacing */}
          <div className="flex items-start justify-between">
            <div className="flex-1 pr-4"> {/* Added pr-4 for spacing */}
              <div className="flex items-center gap-2 mb-1"> {/* Adjusted margin */}
                {type === 'incident' ? (
                  <AlertTriangle className="w-5 h-5 text-rose-400" />
                ) : (
                  <Wrench className="w-5 h-5 text-amber-400" />
                )}
                <CardTitle className="text-white text-base leading-tight">{report.title}</CardTitle> {/* Adjusted font size */}
              </div>
              <p className="text-sm text-slate-400 line-clamp-2">
                {report.description?.split('\n')[0]} {/* Show first line of description */}
              </p>
            </div>
            <Badge className={statusColors[report.status]}>
              {report.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0"> {/* Adjusted padding */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-400">
              <User className="w-4 h-4" />
              <span>{report.guard_name || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <MapPin className="w-4 h-4" />
              <span>{report.site_name || 'N/A'}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-400">
              <Clock className="w-4 h-4" />
              <span>{new Date(report.reported_at || report.created_date).toLocaleDateString()}</span>
            </div>
            {(report.priority || report.urgency) && (
              <Badge className={priorityColors[(report.priority || report.urgency)?.toLowerCase()]}> {/* Ensure lowercase for key */}
                {(report.priority || report.urgency)?.toUpperCase()}
              </Badge>
            )}
          </div>

          {(mediaCount.photos > 0 || mediaCount.videos > 0 || mediaCount.audio > 0) && (
            <div className="flex gap-3 mt-3 text-xs text-slate-500">
              {mediaCount.photos > 0 && (
                <span className="flex items-center gap-1">
                  <Image className="w-3 h-3" /> {mediaCount.photos}
                </span>
              )}
              {mediaCount.videos > 0 && (
                <span className="flex items-center gap-1">
                  <Video className="w-3 h-3" /> {mediaCount.videos}
                </span>
              )}
              {mediaCount.audio > 0 && (
                <span className="flex items-center gap-1">
                  <Mic className="w-3 h-3" /> {mediaCount.audio}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const StatusUpdateModal = ({ report, type, onClose }) => {
    const [newStatus, setNewStatus] = useState(report.status);
    const [notes, setNotes] = useState("");

    const incidentStatuses = ["reported", "assigned", "in_progress", "resolved", "closed", "cancelled"]; // Added cancelled
    const maintenanceStatuses = ["reported", "assigned", "in_progress", "completed", "cancelled"];
    const statuses = type === 'incident' ? incidentStatuses : maintenanceStatuses;

    return (
      <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"> {/* Increased z-index */}
        <Card className="w-full max-w-md bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Update Status for "{report.title}"</CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div>
              <label htmlFor="status-select" className="text-sm text-slate-300 block mb-2">New Status</label>
              <select
                id="status-select"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2.5 appearance-none focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {statuses.map(status => (
                  <option key={status} value={status} className="capitalize">
                    {status.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="status-notes" className="text-sm text-slate-300 block mb-2">Notes</label>
              <Textarea
                id="status-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white focus:ring-1 focus:ring-sky-500"
                placeholder="Add notes about this status change..."
                rows={4}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1 border-slate-600 hover:bg-slate-700">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  updateStatusMutation.mutate({
                    id: report.id,
                    entityType: type,
                    newStatus,
                    notes
                  });
                }}
                disabled={updateStatusMutation.isPending}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {updateStatusMutation.isPending ? "Updating..." : "Update Status"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const DeleteConfirmModal = ({ report, type, onClose }) => {
    const [reason, setReason] = useState("");

    return (
      <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4"> {/* Increased z-index */}
        <Card className="w-full max-w-md bg-slate-800 border-rose-500">
          <CardHeader className="border-b border-slate-700 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-400" />
                Confirm Deletion
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
              <p className="text-rose-400 text-sm">
                ⚠️ This action cannot be undone. The {type} report "{report.title}" will be permanently deleted.
              </p>
            </div>

            <div>
              <label htmlFor="delete-reason" className="text-sm text-slate-300 block mb-2">
                Reason for Deletion <span className="text-rose-400">*</span>
              </label>
              <Textarea
                id="delete-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this is being deleted (required)..."
                className="bg-slate-900 border-slate-700 text-white focus:ring-1 focus:ring-rose-500"
                rows={3}
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 hover:bg-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!reason.trim()) {
                    alert("Please provide a reason for deletion.");
                    return;
                  }
                  deleteMutation.mutate({
                    id: report.id,
                    entityType: type,
                    reason: reason
                  });
                }}
                disabled={deleteMutation.isPending || !reason.trim()}
                className="flex-1 bg-rose-600 hover:bg-rose-700"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const ReportDetailModal = ({ report, type, onClose }) => {
    // Media filtering
    const photos = report.media?.filter(m => m.type === "photo") || [];
    const videos = report.media?.filter(m => m.type === "video") || [];
    const audio = report.media?.filter(m => m.type === "audio") || [];

    return (
      <div className="fixed inset-0 bg-black/80 z-50 overflow-y-auto">
        <div className="min-h-screen p-4 flex items-center justify-center">
          <Card className="w-full max-w-3xl bg-slate-800 border-slate-700">
            <CardHeader className="border-b border-slate-700 pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-3 text-xl">
                  {type === 'incident' ? (
                    <AlertTriangle className="w-6 h-6 text-rose-400" />
                  ) : (
                    <Wrench className="w-6 h-6 text-amber-400" />
                  )}
                  {report.title}
                </CardTitle>
                <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Reported by {report.guard_name} from {report.site_name} on {new Date(report.reported_at || report.created_date).toLocaleString()}
              </p>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Status</p>
                  <Badge className={statusColors[report.status]}>
                    {report.status}
                  </Badge>
                </div>
                {(report.priority || report.urgency) && (
                  <div>
                    <p className="text-xs text-slate-400 mb-1">
                      {type === 'incident' ? 'Priority' : 'Urgency'}
                    </p>
                    <Badge className={priorityColors[(report.priority || report.urgency)?.toLowerCase()]}>
                      {(report.priority || report.urgency)?.toUpperCase()}
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

              <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                <h3 className="text-slate-300 font-semibold mb-3">Full Description</h3>
                <pre className="text-white text-sm whitespace-pre-wrap font-sans">
                  {report.description}
                </pre>
              </div>

              {report.dispatcher_notes && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <h3 className="text-slate-300 font-semibold mb-3">Dispatcher Notes</h3>
                  <pre className="text-white text-sm whitespace-pre-wrap font-sans">
                    {report.dispatcher_notes}
                  </pre>
                </div>
              )}
              {report.resolution_notes && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <h3 className="text-slate-300 font-semibold mb-3">Resolution Notes</h3>
                  <pre className="text-white text-sm whitespace-pre-wrap font-sans">
                    {report.resolution_notes}
                  </pre>
                </div>
              )}
              {report.completion_notes && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <h3 className="text-slate-300 font-semibold mb-3">Completion Notes</h3>
                  <pre className="text-white text-sm whitespace-pre-wrap font-sans">
                    {report.completion_notes}
                  </pre>
                </div>
              )}


              {(photos.length > 0 || videos.length > 0 || audio.length > 0) && (
                <div>
                  <h3 className="text-slate-300 font-semibold mb-3">Media Evidence</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {photos.map((item, idx) => (
                      <a key={`photo-${idx}`} href={item.url} target="_blank" rel="noopener noreferrer" className="relative group block">
                        <img src={item.url} alt="Evidence" className="w-full h-32 object-cover rounded-lg border border-slate-700 hover:border-sky-500 transition-colors" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Image className="w-6 h-6 text-white" />
                        </div>
                      </a>
                    ))}
                    {videos.map((item, idx) => (
                      <a key={`video-${idx}`} href={item.url} target="_blank" rel="noopener noreferrer" className="relative group block">
                        <video src={item.url} className="w-full h-32 object-cover rounded-lg border border-slate-700 hover:border-sky-500 transition-colors" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                          <Video className="w-6 h-6 text-white" />
                        </div>
                      </a>
                    ))}
                    {audio.map((item, idx) => (
                      <div key={`audio-${idx}`} className="bg-slate-900/50 border border-slate-700 rounded-lg p-3 flex items-center justify-center h-32">
                        <audio src={item.url} controls className="w-full" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.location && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <p className="text-xs text-slate-400 mb-1">GPS Location</p>
                  <p className="text-white font-mono text-sm">
                    {report.location.lat?.toFixed(6)}, {report.location.lng?.toFixed(6)}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <Button
                  onClick={() => setShowStatusUpdate({ ...report, type })} // Pass the report object to the state
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Update Status
                </Button>
                <Button
                  onClick={() => setShowDeleteConfirm({ ...report, type })} // Pass the report object to the state
                  variant="outline"
                  className="flex-1 border-rose-500 text-rose-400 hover:bg-rose-500/20 hover:text-white"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 lg:p-6 text-white">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Reports & Activity</h1>
            <p className="text-slate-400 mt-1">Manage incident and maintenance reports</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => exportToCSV(filteredAll, `all-reports-${new Date().toISOString()}.csv`)}
              variant="outline"
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Export All
            </Button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search reports by title, description, guard, site..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-md text-white appearance-none focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </div>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-3 bg-slate-800/50 border border-slate-700">
            <TabsTrigger value="all" className="data-[state=active]:bg-sky-600 data-[state=active]:text-white">
              <FileText className="w-4 h-4 mr-2" />
              All Reports ({filteredAll.length})
            </TabsTrigger>
            <TabsTrigger value="incidents" className="data-[state=active]:bg-rose-600 data-[state=active]:text-white">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Incidents ({filteredIncidents.length})
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="data-[state=active]:bg-amber-600 data-[state=active]:text-white">
              <Wrench className="w-4 h-4 mr-2" />
              Maintenance ({filteredMaintenance.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4 mt-6">
            {filteredAll.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No reports found matching your criteria</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredAll.map((report) => (
                  <ReportCard key={`${report.type}-${report.id}`} report={report} type={report.type} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="incidents" className="space-y-4 mt-6">
            {filteredIncidents.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No incident reports found matching your criteria</p>
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

          <TabsContent value="maintenance" className="space-y-4 mt-6">
            {filteredMaintenance.length === 0 ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-12 text-center">
                  <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <p className="text-slate-400">No maintenance requests found matching your criteria</p>
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
        </Tabs>

        {selectedReport && (
          <ReportDetailModal
            report={selectedReport}
            type={selectedReport.type} // Pass type from the object
            onClose={() => setSelectedReport(null)}
          />
        )}

        {showStatusUpdate && ( // Now showStatusUpdate holds the report object
          <StatusUpdateModal
            report={showStatusUpdate}
            type={showStatusUpdate.type} // Pass type from the object
            onClose={() => {
              setShowStatusUpdate(null);
              // Do not close selectedReport if status update is triggered from detail modal
              // setSelectedReport(null);
            }}
          />
        )}

        {showDeleteConfirm && ( // Now showDeleteConfirm holds the report object
          <DeleteConfirmModal
            report={showDeleteConfirm}
            type={showDeleteConfirm.type} // Pass type from the object
            onClose={() => {
              setShowDeleteConfirm(null);
              // When deleting, we also want to close the detail modal
              setSelectedReport(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
