import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { createSite, updateSite, listCustomersForSites } from "@/lib/siteApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Plus, Trash2, MapPin, QrCode, Loader2, Sparkles, AlertCircle, Save, Lock, Crosshair } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CheckpointQRGenerator from "./CheckpointQRGenerator";
import PatrolSiteConfig from "@/components/patrol/PatrolSiteConfig";
import SiteLocationSection from "./SiteLocationSection";

export default function SiteForm({ site, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    name: site?.name || "",
    address: site?.address || "",
    client_name: site?.client_name || "",
    customer_id: site?.customer_id || "",
    location: site?.location || { lat: 0, lng: 0 },
    geofence_radius: site?.geofence_radius || 100,
    status: site?.status || "active",
    checkpoints: site?.checkpoints || [],
    patrol_config: site?.patrol_config || { enabled: false, schedules: [] }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  // AUTHORITATIVE CUSTOMER LINKING — options come live from the server-side
  // scoped list (platform: all; reseller admin: own reseller's customers;
  // tenant manage roles: own customer, locked). Never a hardcoded list.
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customerLocked, setCustomerLocked] = useState(false);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [capturingIndex, setCapturingIndex] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await listCustomersForSites();
        if (!active) return;
        setCustomerOptions(d.customers || []);
        setCustomerLocked(!!d.locked);
        setFormData(prev => prev.customer_id ? prev : { ...prev, customer_id: site?.customer_id || d.locked_customer_id || "" });
      } catch (e) {
        if (active) setError(e?.message || "Could not load customers");
      } finally {
        if (active) setCustomersLoading(false);
      }
    })();
    return () => { active = false; };
  }, [site]);

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
      // CHECKPOINT GPS is its OWN physical position — NEVER inherited from
      // the Site GPS. Empty = not captured yet; the admin captures the real
      // device position at the checkpoint or enters manual coordinates.
      location: { lat: "", lng: "" },
      location_source: null
    };
    
    updateFormData({
      checkpoints: [...formData.checkpoints, newCheckpoint]
    });
  };

  const handleUpdateCheckpoint = (index, field, value) => {
    const updated = [...formData.checkpoints];
    if (field === "lat" || field === "lng") {
      // MANUAL coordinate entry — kept distinct from device capture; raw
      // text is stored while typing and parsed on save (0/0 never persists).
      updated[index].location[field] = value;
      updated[index].location_source = "manual";
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

  // DEVICE LOCATION CAPTURE — the authoritative way to record a checkpoint's
  // physical position: real high-accuracy device GPS while standing at the
  // checkpoint. Never substitutes the Site coordinates, never writes 0/0.
  const captureCheckpointLocation = (index) => {
    if (!navigator.geolocation) {
      setError("This device/browser does not support location capture. Enter manual coordinates instead.");
      return;
    }
    setCapturingIndex(index);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const updated = [...formData.checkpoints];
        updated[index] = {
          ...updated[index],
          location: {
            lat: Number(pos.coords.latitude.toFixed(7)),
            lng: Number(pos.coords.longitude.toFixed(7)),
          },
          location_source: "device",
          location_accuracy_m: pos.coords.accuracy != null ? Math.round(pos.coords.accuracy) : null,
        };
        updateFormData({ checkpoints: updated });
        setCapturingIndex(null);
        setError(null);
      },
      (err) => {
        setCapturingIndex(null);
        if (err && err.code === 1) {
          setError("Location permission denied — allow location access for this app, then press Capture Current Location again. Site coordinates are never used as a substitute.");
        } else {
          setError("Could not obtain a GPS fix at this checkpoint. Check that location services are on, then retry. Site coordinates are never used as a substitute.");
        }
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  };

  // A checkpoint location is only "captured" when a real non-0/0 position exists.
  const checkpointLocationCaptured = (cp) => {
    const lat = parseFloat(cp.location?.lat);
    const lng = parseFloat(cp.location?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
      ? { lat, lng }
      : null;
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
    if (!formData.customer_id) {
      setError("Please select the customer this site belongs to");
      return false;
    }
    // (0,0) and non-numeric values are NEVER a valid configured location —
    // a site without real coordinates must not save (and can therefore never
    // activate geofence validation).
    const lat = parseFloat(formData.location.lat);
    const lng = parseFloat(formData.location.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      setError("Please set a valid GPS location — select an address suggestion, use 'Generate GPS Coordinates' / 'Use Current Location', or enter coordinates manually");
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
          geofence_radius: parseInt(formData.geofence_radius),
          checkpoints: formData.checkpoints.map(cp => {
            // Persist ONLY a genuinely captured/entered position — form-only
            // metadata (capture source/accuracy) is stripped, and a checkpoint
            // with no location is saved WITHOUT GPS: never 0/0, never the
            // Site's coordinates.
            const { location_source, location_accuracy_m, location, ...checkpointData } = cp;
            const captured = checkpointLocationCaptured(cp);
            return captured
              ? { ...checkpointData, location: { lat: captured.lat, lng: captured.lng } }
              : { ...checkpointData };
          })
        };

        if (site) {
          await updateSite(site.id, data);
        } else {
          await createSite(data);
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

  const selectedCustomerName = customerOptions.find(c => c.id === formData.customer_id)?.name
    || site?.client_name
    || "";

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

              {/* Address + GPS location: autocomplete, generate, current
                  location and manual entry — see SiteLocationSection. */}
              <SiteLocationSection
                address={formData.address}
                location={formData.location}
                onChange={(updates) => updateFormData(updates)}
              />

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Customer *</label>
                {customersLoading ? (
                  <div className="h-10 flex items-center gap-2 text-sm text-slate-400 bg-slate-900/50 border border-slate-700 rounded-lg px-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading customers...
                  </div>
                ) : customerLocked ? (
                  <div className="h-10 flex items-center gap-2 text-sm text-slate-300 bg-slate-900/50 border border-slate-700 rounded-lg px-3">
                    <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                    <span className="truncate">{selectedCustomerName || "Your customer"}</span>
                  </div>
                ) : (
                  <Select
                    value={formData.customer_id || ""}
                    onValueChange={(value) => {
                      const c = customerOptions.find(x => x.id === value);
                      updateFormData({ customer_id: value, client_name: c?.name || "" });
                    }}
                  >
                    <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customerOptions.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  Sites are linked to the authoritative customer record — this cannot be typed manually.
                </p>
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
                          placeholder="Latitude (manual)"
                          value={checkpoint.location.lat}
                          onChange={(e) => handleUpdateCheckpoint(index, "lat", e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white text-sm"
                        />
                        <Input
                          type="number"
                          step="any"
                          placeholder="Longitude (manual)"
                          value={checkpoint.location.lng}
                          onChange={(e) => handleUpdateCheckpoint(index, "lng", e.target.value)}
                          className="bg-slate-800 border-slate-700 text-white text-sm"
                        />
                      </div>

                      {/* Checkpoint GPS — the checkpoint's OWN physical position.
                          Device capture is the authoritative path; manual entry
                          is explicitly labelled. Site coordinates are NEVER
                          copied here. */}
                      <div className="space-y-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => captureCheckpointLocation(index)}
                          disabled={capturingIndex === index}
                          className="w-full border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10"
                        >
                          {capturingIndex === index ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Capturing device location...
                            </>
                          ) : (
                            <>
                              <Crosshair className="w-4 h-4 mr-2" />
                              Capture Current Location
                            </>
                          )}
                        </Button>
                        {checkpointLocationCaptured(checkpoint) ? (
                          <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">
                              Checkpoint GPS: {checkpointLocationCaptured(checkpoint).lat}, {checkpointLocationCaptured(checkpoint).lng}
                              {checkpoint.location_source === "device" ? " (device capture)" : " (manual entry)"}
                              {checkpoint.location_accuracy_m ? ` (±${checkpoint.location_accuracy_m}m)` : ""}
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-amber-400 flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            Checkpoint location not captured — stand at the checkpoint and press "Capture Current Location".
                          </p>
                        )}
                      </div>
                    </div>

                    {checkpoint.qr_code && (
                      <CheckpointQRGenerator checkpoint={checkpoint} siteName={formData.name} siteId={formData.id} />
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

            {/* Patrol Config */}
            <PatrolSiteConfig
              patrolConfig={formData.patrol_config}
              onChange={(patrol_config) => updateFormData({ patrol_config })}
            />

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
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    {site ? "Save Changes" : "Create Site"}
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}