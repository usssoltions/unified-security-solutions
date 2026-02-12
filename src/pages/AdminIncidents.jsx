import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Search, Filter, Eye, MapPin, Clock, User, Download } from "lucide-react";
import moment from "moment";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PullToRefresh from "../components/PullToRefresh";

export default function AdminIncidents() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState(moment().subtract(30, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(moment().format('YYYY-MM-DD'));
  const [selectedSite, setSelectedSite] = useState("all");
  const [selectedGuard, setSelectedGuard] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedIncident, setSelectedIncident] = useState(null);

  const { data: incidents = [], isLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => base44.entities.Incident.list()
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list()
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === 'guard');
    }
  });

  const filteredIncidents = useMemo(() => {
    return incidents.filter(incident => {
      const incidentDate = moment(incident.reported_at || incident.created_date);
      const dateMatch = incidentDate.isBetween(dateFrom, dateTo, 'day', '[]');
      
      const siteMatch = selectedSite === "all" || incident.site_id === selectedSite;
      const guardMatch = selectedGuard === "all" || incident.guard_id === selectedGuard;
      const categoryMatch = selectedCategory === "all" || incident.category === selectedCategory;
      const statusMatch = selectedStatus === "all" || incident.status === selectedStatus;
      
      const searchMatch = searchQuery === "" || 
        incident.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        incident.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        incident.guard_name?.toLowerCase().includes(searchQuery.toLowerCase());

      return dateMatch && siteMatch && guardMatch && categoryMatch && statusMatch && searchMatch;
    });
  }, [incidents, dateFrom, dateTo, selectedSite, selectedGuard, selectedCategory, selectedStatus, searchQuery]);

  const exportToCSV = () => {
    const headers = ['Date', 'Title', 'Category', 'Status', 'Priority', 'Site', 'Guard', 'Description'];
    const rows = filteredIncidents.map(incident => [
      moment(incident.reported_at || incident.created_date).format('YYYY-MM-DD HH:mm'),
      incident.title,
      incident.category,
      incident.status,
      incident.priority,
      incident.site_name,
      incident.guard_name,
      (incident.description || '').replace(/\n/g, ' ').substring(0, 200)
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `incidents-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  };

  const priorityColors = {
    critical: "bg-rose-600",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  const statusColors = {
    reported: "bg-blue-500",
    assigned: "bg-purple-500",
    in_progress: "bg-amber-500",
    resolved: "bg-emerald-500",
    closed: "bg-slate-500"
  };

  const categories = ["fire", "theft", "vandalism", "medical", "trespassing", "suspicious_activity", "equipment_failure", "safety_hazard", "other"];

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries(["incidents"]);
    }}>
      <div className="min-h-screen p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-rose-400" />
            Incident Reports
          </h1>
          <p className="text-slate-400 mt-1">View and manage all incident reports</p>
        </div>
        <Button onClick={exportToCSV} className="bg-emerald-600 hover:bg-emerald-700">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Search and Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Search & Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search by title, description, or guard name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-900 border-slate-700 text-white"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Site</label>
              <Select value={selectedSite} onValueChange={setSelectedSite}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Sites</SelectItem>
                  {sites.map(site => (
                    <SelectItem key={site.id} value={site.id} className="text-white">{site.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Guard</label>
              <Select value={selectedGuard} onValueChange={setSelectedGuard}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Guards</SelectItem>
                  {guards.map(guard => (
                    <SelectItem key={guard.id} value={guard.id} className="text-white">{guard.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Category</label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Categories</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-white capitalize">{cat.replace(/_/g, ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Status</label>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Statuses</SelectItem>
                  <SelectItem value="reported" className="text-white">Reported</SelectItem>
                  <SelectItem value="assigned" className="text-white">Assigned</SelectItem>
                  <SelectItem value="in_progress" className="text-white">In Progress</SelectItem>
                  <SelectItem value="resolved" className="text-white">Resolved</SelectItem>
                  <SelectItem value="closed" className="text-white">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">
            Results ({filteredIncidents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto" />
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No incidents found matching your filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIncidents.map((incident) => (
                <div key={incident.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-lg mb-2">{incident.title}</h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge className={priorityColors[incident.priority]}>
                          {incident.priority}
                        </Badge>
                        <Badge className={statusColors[incident.status]}>
                          {incident.status}
                        </Badge>
                        <Badge variant="outline" className="border-slate-600 text-slate-300 capitalize">
                          {incident.category?.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setSelectedIncident(incident)}
                      className="bg-sky-600 hover:bg-sky-700"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock className="w-4 h-4" />
                      {moment(incident.reported_at || incident.created_date).format('MMM D, YYYY HH:mm')}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <MapPin className="w-4 h-4" />
                      {incident.site_name}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <User className="w-4 h-4" />
                      {incident.guard_name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedIncident} onOpenChange={() => setSelectedIncident(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedIncident?.title}</DialogTitle>
          </DialogHeader>
          {selectedIncident && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={priorityColors[selectedIncident.priority]}>
                  {selectedIncident.priority}
                </Badge>
                <Badge className={statusColors[selectedIncident.status]}>
                  {selectedIncident.status}
                </Badge>
                <Badge variant="outline" className="border-slate-600 text-slate-300 capitalize">
                  {selectedIncident.category?.replace(/_/g, ' ')}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-900/50 rounded-lg">
                <div>
                  <p className="text-slate-400 text-sm">Reported At</p>
                  <p className="text-white">{moment(selectedIncident.reported_at || selectedIncident.created_date).format('MMMM D, YYYY HH:mm')}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Site</p>
                  <p className="text-white">{selectedIncident.site_name}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Guard</p>
                  <p className="text-white">{selectedIncident.guard_name}</p>
                </div>
                {selectedIncident.location && (
                  <div>
                    <p className="text-slate-400 text-sm">Location</p>
                    <a
                      href={`https://www.google.com/maps?q=${selectedIncident.location.lat},${selectedIncident.location.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-400 hover:underline text-sm"
                    >
                      View on Map
                    </a>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-white font-semibold mb-2">Description</h4>
                <div className="p-4 bg-slate-900/50 rounded-lg">
                  <pre className="text-slate-300 text-sm whitespace-pre-wrap font-sans">{selectedIncident.description}</pre>
                </div>
              </div>

              {selectedIncident.media && selectedIncident.media.length > 0 && (
                <div>
                  <h4 className="text-white font-semibold mb-2">Media ({selectedIncident.media.length})</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedIncident.media.map((item, idx) => (
                      <div key={idx}>
                        {item.type === 'photo' ? (
                          <img src={item.url} alt={`Evidence ${idx + 1}`} className="w-full h-auto rounded border border-slate-700" />
                        ) : item.type === 'video' ? (
                          <video src={item.url} controls className="w-full h-auto rounded border border-slate-700" />
                        ) : (
                          <audio src={item.url} controls className="w-full" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </div>
    </PullToRefresh>
  );
}