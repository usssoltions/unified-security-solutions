import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Plus, Trash2, MapPin, QrCode, Loader2, Sparkles, AlertCircle, Save } from "lucide-react";
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
  const [error, setError] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");

  // Auto-save draft to localStorage
  useEffect(() => {
    if (hasUnsavedChanges && !site) {
      try {
        localStorage.setItem('siteFormDraft', JSON.stringify(formData));
        setAutoSaveStatus("Draft saved");
        setTimeout(() => setAutoSaveStatus(""), 2000);
      } catch (err) {
        console.error("Failed to save draft:", err);
      }
    }
  }, [formData, hasUnsavedChanges, site]);

  // Load draft on mount
  useEffect(() => {
    if (!site) {
      try {
        const draft = localStorage.getItem('siteFormDraft');
        if (draft) {
          const parsed = JSON.parse(draft);
          if (parsed.name || parsed.address || parsed.checkpoints.length > 0) {
            if (confirm("Found unsaved changes. Restore draft?")) {
              setFormData(parsed);
              setHasUnsavedChanges(true);
            } else {
              localStorage.removeItem('siteFormDraft');
            }
          }
        }
      } catch (err) {
        console.error("Failed to load draft:", err);
      }
    }
  }, [site]);

  // Prevent accidental close with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const updateFormData = (updates) => {
    setFormData(prev => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
    setError(null);
  };

  const geocodeAddress = async () => {
    if (!formData.address || formData.address.trim().length < 5) {
      setError("Please enter a valid address first");
      return;
    }

    setGeocoding(true);
    setError(null);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(formData.address)}&limit=1`,
        { timeout: 10000 }
      );
      
      if (!response.ok) {
        throw new Error("Geocoding service unavailable");
      }

      const data = await response.json();
      
      if (data && data.length > 0) {
        const result = data[0];
        updateFormData({
          location: {
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon)
          }
        });
        setError(null);
        alert(`✅ Location found: ${result.display_name.substring(0, 100)}...`);
      } else {
        setError("Address not found. Please check spelling or enter coordinates manually.");
      }
    } catch (error) {
      console.error("Geocoding error:", error);
      setError("Failed to find address. Please enter GPS coordinates manually.");
    } finally {
      setGeocoding(false);
    }
  };

  const generateQRCode = (checkpointName) => {
    const sitePart = formData.name.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '') || 'SITE';
    const checkpointPart = checkpointName.substring(0, 4).toUpperCase().replace(/[^A-Z]/g, '') || 'CHCK';
    const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${sitePart}_${checkpointPart}_${randomPart}`;
  };

  const handleAddCheckpoint = () => {
    const newCheckpoint = {
      id: `cp${Date.now()}`,
      name: "",
      qr_code: "",
      location: { 
        lat: formData.location.lat || 0, 
        lng: formData.location.lng || 0 
      }
    };
    
    updateFormData({
      checkpoints: [...formData.checkpoints, newCheckpoint]
    });
  };

  const handleUpdateCheckpoint = (index, field, value) => {
    const updated = [...formData.checkpoints];
    if (field === "lat" || field === "lng") {
      updated[index].location[field] = parseFloat(value) || 0;
    } else if (field === "name") {
      updated[index][field] = value;
      if (value && !updated[index].qr_code) {
        updated[index].qr_code = generateQRCode(value);
      }
    } else {
      updated[index][field] = value;
    }
    updateFormData({ checkpoints: updated });
  };

  const handleRemoveCheckpoint = (index) => {
    if (confirm("Remove this checkpoint?")) {
      updateFormData({
        checkpoints: formData.checkpoints.filter((_, i) => i !== index)
      });
    }
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError("Site name is required");
      return false;
    }
    if (!formData.address.trim()) {
      setError("Address is required");
      return false;
    }
    if (!formData.client_name.trim()) {
      setError("Client name is required");
      return false;
    }
    if (formData.location.lat === 0 && formData.location.lng === 0) {
      setError("Please set GPS location using 'Generate GPS Coordinates' or enter manually");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
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

        // Clear draft on successful save
        localStorage.removeItem('siteFormDraft');
        setHasUnsavedChanges(false);
        
        onSuccess();
        return;
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        
        if (retryCount < maxRetries) {
          setError(`Save failed. Retrying... (${retryCount}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        } else {
          setError(`Failed to save site: ${error.message}. Your data is auto-saved. Please try again or check your internet connection.`);
        }
      } finally {
        if (retryCount >= maxRetries) {
          setLoading(false);
        }
      }
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (confirm("You have unsaved changes. Are you sure you want to close?")) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-5xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-white">
                {site ? "Edit Site" : "Add New Site"}
              </CardTitle>
              {autoSaveStatus && (
                <div className="flex items-center gap-1 text-xs text-emerald-400">
                  <Save className="w-3 h-3" />
                  {autoSaveStatus}
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-rose-400 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Site Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => updateFormData({ name: e.target.value })}
                  className="bg-slate-900/50 border-slate-700 text-white"
                  required
                  placeholder="e.g., Downtown Office Building"
                />
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Address *</label>
                <div className="space-y-2">
                  <Textarea
                    value={formData.address}
                    onChange={(e) => updateFormData({ address: e.target.value })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                    rows={2}
                    required
                    placeholder="123 Main Street, Cape Town, South Africa"
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
                  onChange={(e) => updateFormData({ client_name: e.target.value })}
                  className="bg-slate-900/50 border-slate-700 text-white"
                  required
                  placeholder="e.g., ABC Corporation"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Status</label>
                  <Select value={formData.status} onValueChange={(value) => updateFormData({ status: value })}>
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
                    onChange={(e) => updateFormData({ geofence_radius: e.target.value })}
                    className="bg-slate-900/50 border-slate-700 text-white"
                    min="10"
                    max="1000"
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
                    onChange={(e) => updateFormData({
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
                    onChange={(e) => updateFormData({
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
                  <span>Checkpoints (Optional)</span>
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
                onClick={handleClose}
                className="flex-1 border-slate-600"
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  site ? "Update Site" : "Create Site"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}