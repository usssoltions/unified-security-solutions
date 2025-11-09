import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, Plus, Edit, Trash2, Navigation, QrCode } from "lucide-react";
import SiteForm from "../components/sites/SiteForm";

export default function SiteManagement() {
  const [showForm, setShowForm] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const queryClient = useQueryClient();

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list("-created_date");
    },
    initialData: []
  });

  const deleteSiteMutation = useMutation({
    mutationFn: async (siteId) => {
      await base44.entities.Site.delete(siteId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["sites"]);
    }
  });

  const handleEdit = (site) => {
    setEditingSite(site);
    setShowForm(true);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditingSite(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <MapPin className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Site Management</h1>
            <p className="text-slate-400">Manage security sites and checkpoints</p>
          </div>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Site
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Total Sites</p>
            <p className="text-2xl font-bold text-white">{sites.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-emerald-400 mb-1">Active</p>
            <p className="text-2xl font-bold text-white">
              {sites.filter(s => s.status === "active").length}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-sky-500/10 border-sky-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-sky-400 mb-1">Checkpoints</p>
            <p className="text-2xl font-bold text-white">
              {sites.reduce((sum, s) => sum + (s.checkpoints?.length || 0), 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-amber-400 mb-1">Inactive</p>
            <p className="text-2xl font-bold text-white">
              {sites.filter(s => s.status === "inactive").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Sites Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sites.length === 0 ? (
          <Card className="col-span-full bg-slate-800/50 border-slate-700">
            <CardContent className="p-12 text-center">
              <MapPin className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400 mb-4">No sites created yet</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Site
              </Button>
            </CardContent>
          </Card>
        ) : (
          sites.map((site) => (
            <Card key={site.id} className="bg-slate-800/50 border-slate-700 hover:border-sky-500/50 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-white text-lg">{site.name}</CardTitle>
                    <p className="text-sm text-slate-400 mt-1">{site.client_name}</p>
                  </div>
                  <Badge className={site.status === "active" ? "bg-emerald-500" : "bg-amber-500"}>
                    {site.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                    <p className="text-slate-300">{site.address}</p>
                  </div>
                  {site.location && (
                    <div className="flex items-center gap-2">
                      <Navigation className="w-4 h-4 text-sky-400" />
                      <p className="text-xs text-slate-400">
                        {site.location.lat.toFixed(6)}, {site.location.lng.toFixed(6)}
                      </p>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    </div>
                    <p className="text-xs text-slate-400">
                      Geofence: {site.geofence_radius || 100}m
                    </p>
                  </div>
                </div>

                {site.checkpoints && site.checkpoints.length > 0 && (
                  <div className="pt-3 border-t border-slate-700">
                    <div className="flex items-center gap-2 mb-2">
                      <QrCode className="w-4 h-4 text-purple-400" />
                      <p className="text-xs text-slate-400">
                        {site.checkpoints.length} Checkpoint{site.checkpoints.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="space-y-1">
                      {site.checkpoints.slice(0, 3).map((cp) => (
                        <p key={cp.id} className="text-xs text-slate-500">
                          • {cp.name} ({cp.qr_code})
                        </p>
                      ))}
                      {site.checkpoints.length > 3 && (
                        <p className="text-xs text-slate-500">
                          +{site.checkpoints.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    onClick={() => handleEdit(site)}
                    className="flex-1 bg-sky-600 hover:bg-sky-700"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (confirm(`Delete ${site.name}?`)) {
                        deleteSiteMutation.mutate(site.id);
                      }
                    }}
                    className="border-rose-500 text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Site Form Modal */}
      {showForm && (
        <SiteForm
          site={editingSite}
          onClose={handleCloseForm}
          onSuccess={() => {
            handleCloseForm();
            queryClient.invalidateQueries(["sites"]);
          }}
        />
      )}
    </div>
  );
}