import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Trash2, MapPin, QrCode, Loader2, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CheckpointQRGenerator from "./CheckpointQRGenerator";

export default function SiteForm({ site, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: site?.name || "",
    address: site?.address || "",
    client_name: site?.client_name || "",
    location: site?.location || { lat: 0, lng: 0 },
    geofence_radius: site?.geofence_radius || 100,
    status: site?.status || "active",
    checkpoints: site?.checkpoints || []
  });
  const [loading, setLoading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  const geocodeAddress = async () => {
    if (!formData.address || formData.address.trim().length < 5) {
      alert("Please enter a valid address first");
      return;
    }

    setGeocoding(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(formData.address)}&limit=1`
      );
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        const result = data[0];
        setFormData({
          ...formData,
          location: {
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon)
          }
        });
        alert(`✅ Location found: ${result.display_name}`);
      } else {
        alert("❌ Address not found. Please check the address or enter coordinates manually.");
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      alert("Failed to geocode address. Please enter coordinates manually.");
    } finally {
      setGeocoding(false);
    }
  };

  const generateQRCode = (checkpointName) => {
    const sitePart = formData.name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
    const checkpointPart = checkpointName.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '');
    const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${sitePart}_${checkpointPart}_${randomPart}`;
  };

  const handleAddCheckpoint = () => {
    const newCheckpoint = {
      id: `cp${Date.now()}`,
      name: "",
      qr_code: "",
      location: { lat: formData.location.lat, lng: formData.location.lng }
    };
    
    setFormData({
      ...formData,
      checkpoints: [...formData.checkpoints, newCheckpoint]
    });
  };

  const handleUpdateCheckpoint = (index, field, value) => {
    const updated = [...formData.checkpoints];
    if (field === "lat" || field === "lng") {
      updated[index].location[field] = parseFloat(value) || 0;
    } else if (field === "name") {
      updated[index][field] = value;
      // Auto-generate QR code when name is entered
      if (value && !updated[index].qr_code) {
        updated[index].qr_code = generateQRCode(value);
      }
    } else {
      updated[index][field] = value;
    }
    setFormData({ ...formData, checkpoints: updated });
  };

  const handleRemoveCheckpoint = (index) => {
    setFormData({
      ...formData,
      checkpoints: formData.checkpoints.filter((_, i) => i !== index)
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const data = {
        ...formData,
        location: {
          lat: parseFloat(formData.location.lat),
          lng: parseFloat(formData.location.lng)
        },
        geofence_radius: parseInt(formData.geofence_radius)
      };

      if (site) {
        await base44.entities.Site.update(site.id, data);
      } else {
        await base44.entities.Site.create(data);
      }

      onSuccess();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-5xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">
              {site ? "Edit Site" : "Add New Site"}
            </CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Site Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-slate-900/50 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Address *</label>
                <div className="space-y-2">
                  <Textarea
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                    rows={2}
                    required
                    placeholder="Enter full address (e.g., 123 Main Street, Cape Town, South Africa)"
                  />
                  <Button
                    type="button"
                    onClick={geocodeAddress}
                    disabled={geocoding || !formData.address}
                    variant="outline"
                    className="w-full border-sky-500/50 text-sky-400 hover:bg-sky-500/10"
                  >
                    {geocoding ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Finding Location...
                      </>
                    ) : (
                      <>
                        <MapPin className="w-4 h-4 mr-2" />
                        Generate GPS Coordinates from Address
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Client Name *</label>
                <Input
                  value={formData.client_name}
                  onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                  className="bg-slate-900/50 border-slate-700 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Status</label>
                  <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                    <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Geofence Radius (meters)</label>
                  <Input
                    type="number"
                    value={formData.geofence_radius}
                    onChange={(e) => setFormData({ ...formData, geofence_radius: e.target.value })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-sky-400 font-semibold">
                <MapPin className="w-5 h-5" />
                <span>GPS Location</span>
              </div>
              <p className="text-xs text-slate-400">
                Use "Generate GPS Coordinates" button above or enter manually
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Latitude</label>
                  <Input
                    type="number"
                    step="any"
                    value={formData.location.lat}
                    onChange={(e) => setFormData({
                      ...formData,
                      location: { ...formData.location, lat: e.target.value }
                    })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                    placeholder="-33.3482"
                  />
                </div>
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Longitude</label>
                  <Input
                    type="number"
                    step="any"
                    value={formData.location.lng}
                    onChange={(e) => setFormData({
                      ...formData,
                      location: { ...formData.location, lng: e.target.value }
                    })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                    placeholder="18.1615"
                  />
                </div>
              </div>
              {formData.location.lat !== 0 && formData.location.lng !== 0 && (
                <div className="flex items-center gap-2 text-emerald-400 text-sm">
                  <MapPin className="w-4 h-4" />
                  <span>Location set: {formData.location.lat}, {formData.location.lng}</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-white font-semibold">
                  <QrCode className="w-5 h-5 text-purple-400" />
                  <span>Checkpoints</span>
                </div>
                <Button
                  type="button"
                  onClick={handleAddCheckpoint}
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Checkpoint
                </Button>
              </div>

              {formData.checkpoints.map((checkpoint, index) => (
                <div key={checkpoint.id} className="p-4 bg-slate-900/50 border border-slate-700 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Checkpoint {index + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveCheckpoint(index)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          placeholder="Checkpoint Name"
                          value={checkpoint.name}
                          onChange={(e) => handleUpdateCheckpoint(index, "name", e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white"
                        />
                        <div className="relative">
                          <Input
                            placeholder="QR Code (auto-generated)"
                            value={checkpoint.qr_code}
                            onChange={(e) => handleUpdateCheckpoint(index, "qr_code", e.target.value)}
                            className="bg-slate-800 border-slate-700 text-white pr-10"
                          />
                          {checkpoint.qr_code && (
                            <Sparkles className="w-4 h-4 text-emerald-400 absolute right-3 top-1/2 -translate-y-1/2" />
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          type="number"
                          step="any"
                          placeholder="Latitude"
                          value={checkpoint.location.lat}
                          onChange={(e) => handleUpdateCheckpoint(index, "lat", e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white text-sm"
                        />
                        <Input
                          type="number"
                          step="any"
                          placeholder="Longitude"
                          value={checkpoint.location.lng}
                          onChange={(e) => handleUpdateCheckpoint(index, "lng", e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white text-sm"
                        />
                      </div>
                    </div>

                    {checkpoint.qr_code && (
                      <CheckpointQRGenerator checkpoint={checkpoint} siteName={formData.name} />
                    )}
                  </div>
                </div>
              ))}

              {formData.checkpoints.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">
                  No checkpoints added yet
                </p>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-700">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {loading ? "Saving..." : site ? "Update Site" : "Create Site"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}