import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wrench, Search, Filter, Eye, MapPin, Clock, User, Download } from "lucide-react";
import moment from "moment";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AdminMaintenance() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState(moment().subtract(30, 'days').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(moment().format('YYYY-MM-DD'));
  const [selectedSite, setSelectedSite] = useState("all");
  const [selectedGuard, setSelectedGuard] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedRequest, setSelectedRequest] = useState(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => base44.entities.MaintenanceRequest.list()
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

  const filteredRequests = useMemo(() => {
    return requests.filter(request => {
      const requestDate = moment(request.reported_at || request.created_date);
      const dateMatch = requestDate.isBetween(dateFrom, dateTo, 'day', '[]');
      
      const siteMatch = selectedSite === "all" || request.site_id === selectedSite;
      const guardMatch = selectedGuard === "all" || request.guard_id === selectedGuard;
      const categoryMatch = selectedCategory === "all" || request.category === selectedCategory;
      const statusMatch = selectedStatus === "all" || request.status === selectedStatus;
      
      const searchMatch = searchQuery === "" || 
        request.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        request.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        request.guard_name?.toLowerCase().includes(searchQuery.toLowerCase());

      return dateMatch && siteMatch && guardMatch && categoryMatch && statusMatch && searchMatch;
    });
  }, [requests, dateFrom, dateTo, selectedSite, selectedGuard, selectedCategory, selectedStatus, searchQuery]);

  const exportToCSV = () => {
    const headers = ['Date', 'Title', 'Category', 'Status', 'Urgency', 'Site', 'Guard', 'Description'];
    const rows = filteredRequests.map(request => [
      moment(request.reported_at || request.created_date).format('YYYY-MM-DD HH:mm'),
      request.title,
      request.category,
      request.status,
      request.urgency,
      request.site_name,
      request.guard_name,
      (request.description || '').replace(/\n/g, ' ').substring(0, 200)
    ]);
    
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance-report-${dateFrom}-to-${dateTo}.csv`;
    a.click();
  };

  const urgencyColors = {
    critical: "bg-rose-600",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  const statusColors = {
    reported: "bg-blue-500",
    assigned: "bg-purple-500",
    in_progress: "bg-amber-500",
    completed: "bg-emerald-500",
    cancelled: "bg-slate-500"
  };

  const categories = ["lighting", "locks", "fencing", "gate", "alarm_system", "camera", "plumbing", "electrical", "structural", "other"];

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white flex items-center gap-3">
            <Wrench className="w-8 h-8 text-amber-400" />
            Maintenance Requests
          </h1>
          <p className="text-slate-400 mt-1">View and manage all maintenance requests</p>
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
                  <SelectItem value="completed" className="text-white">Completed</SelectItem>
                  <SelectItem value="cancelled" className="text-white">Cancelled</SelectItem>
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
            Results ({filteredRequests.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400 mx-auto" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-center py-12">
              <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No maintenance requests found matching your filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredRequests.map((request) => (
                <div key={request.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-amber-500/50 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-lg mb-2">{request.title}</h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge className={urgencyColors[request.urgency]}>
                          {request.urgency}
                        </Badge>
                        <Badge className={statusColors[request.status]}>
                          {request.status}
                        </Badge>
                        <Badge variant="outline" className="border-slate-600 text-slate-300 capitalize">
                          {request.category?.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => setSelectedRequest(request)}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      View Details
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock className="w-4 h-4" />
                      {moment(request.reported_at || request.created_date).format('MMM D, YYYY HH:mm')}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <MapPin className="w-4 h-4" />
                      {request.site_name}
                    </div>
                    <div className="flex items-center gap-2 text-slate-400">
                      <User className="w-4 h-4" />
                      {request.guard_name}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedRequest?.title}</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={urgencyColors[selectedRequest.urgency]}>
                  {selectedRequest.urgency}
                </Badge>
                <Badge className={statusColors[selectedRequest.status]}>
                  {selectedRequest.status}
                </Badge>
                <Badge variant="outline" className="border-slate-600 text-slate-300 capitalize">
                  {selectedRequest.category?.replace(/_/g, ' ')}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-900/50 rounded-lg">
                <div>
                  <p className="text-slate-400 text-sm">Reported At</p>
                  <p className="text-white">{moment(selectedRequest.reported_at || selectedRequest.created_date).format('MMMM D, YYYY HH:mm')}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Site</p>
                  <p className="text-white">{selectedRequest.site_name}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Guard</p>
                  <p className="text-white">{selectedRequest.guard_name}</p>
                </div>
                {selectedRequest.location && (
                  <div>
                    <p className="text-slate-400 text-sm">Location</p>
                    <a
                      href={`https://www.google.com/maps?q=${selectedRequest.location.lat},${selectedRequest.location.lng}`}
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
                  <pre className="text-slate-300 text-sm whitespace-pre-wrap font-sans">{selectedRequest.description}</pre>
                </div>
              </div>

              {selectedRequest.media && selectedRequest.media.length > 0 && (
                <div>
                  <h4 className="text-white font-semibold mb-2">Media ({selectedRequest.media.length})</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedRequest.media.map((item, idx) => (
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
  );
}