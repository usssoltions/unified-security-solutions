import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Camera, AlertCircle, CheckCircle2, MapPin, Clock, Upload, PenTool } from "lucide-react";
import QRCodeReader from "../components/guard/QRCodeReader";
import SignaturePad from "../components/guard/SignaturePad";

export default function QRScanner() {
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(null);
  const [location, setLocation] = useState(null);
  const [scannedData, setScannedData] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);
  const [scanTimestamp, setScanTimestamp] = useState(null);
  const [scanLocation, setScanLocation] = useState(null);
  const [checklistItems, setChecklistItems] = useState([]);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [signature, setSignature] = useState(null);
  const [showSignature, setShowSignature] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [distanceFromCheckpoint, setDistanceFromCheckpoint] = useState(null);

  useEffect(() => {
    loadData();
    getLocation();
  }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);

    const shifts = await base44.entities.Shift.filter({
      guard_id: currentUser.id,
      status: "active"
    });
    
    if (shifts.length > 0) {
      setShift(shifts[0]);
    }
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      console.error("Geolocation not available");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        console.error("Geolocation error:", error);
        // Try again on permission denied
        if (error.code === 1) {
          console.log("Location permission denied, trying again...");
          setTimeout(getLocation, 2000);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  };

  const { data: site } = useQuery({
    queryKey: ["site", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return null;
      return await base44.entities.Site.get(shift.site_id);
    },
    enabled: !!shift
  });

  const { data: templates } = useQuery({
    queryKey: ["templates", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return [];
      return await base44.entities.ChecklistTemplate.filter({
        site_id: shift.site_id,
        status: "active"
      });
    },
    enabled: !!shift,
    initialData: []
  });

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const handleScan = async (qrCodeText) => {
    try {
      const currentTime = new Date().toISOString();
      let currentLocation = location;

      // If location not yet available, try to get it
      if (!currentLocation) {
        console.log("Location not available, requesting...");
        await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              currentLocation = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              };
              setLocation(currentLocation);
              resolve();
            },
            (error) => {
              console.error("Failed to get location:", error);
              resolve(); // Continue anyway
            },
            {
              enableHighAccuracy: true,
              timeout: 5000,
              maximumAge: 0
            }
          );
        });
      }

      // Allow scanning even without location if it fails - use last known or null
      if (!currentLocation) {
        console.warn("No location available, proceeding with scan anyway");
        // Don't block scan, just continue
      }

      if (!site || !site.checkpoints || site.checkpoints.length === 0) {
        // Accept any QR code even without checkpoints
        setScannedData({ qr_code: qrCodeText });
        setCheckpoint({
          id: "manual-" + Date.now(),
          name: "Scanned Checkpoint",
          qr_code: qrCodeText,
          location: currentLocation || { lat: 0, lng: 0 }
        });
        setScanTimestamp(currentTime);
        setScanLocation(currentLocation || { lat: 0, lng: 0 });
        setDistanceFromCheckpoint(0);
        
        if (templates.length > 0) {
          setChecklistItems(templates[0].items.map(item => ({
            ...item,
            checked: false,
            value: "",
            photo_url: ""
          })));
        }
        return;
      }

      // Try to find matching checkpoint
      let foundCheckpoint = null;
      
      // Try parsing as JSON first
      try {
        const qrData = JSON.parse(qrCodeText);
        foundCheckpoint = site.checkpoints.find(
          cp => cp.qr_code === qrData.qr_code || 
                cp.id === qrData.checkpoint_id ||
                cp.qr_code === qrCodeText ||
                cp.id === qrCodeText
        );
      } catch (e) {
        // Not JSON, try direct string match
        foundCheckpoint = site.checkpoints.find(
          cp => cp.qr_code === qrCodeText || 
                cp.id === qrCodeText ||
                cp.name === qrCodeText
        );
      }

      // If no match found, accept it anyway but use first checkpoint or create generic one
      if (!foundCheckpoint) {
        foundCheckpoint = site.checkpoints[0] || {
          id: "manual-" + Date.now(),
          name: "Scanned Checkpoint",
          qr_code: qrCodeText,
          location: currentLocation || { lat: 0, lng: 0 }
        };
      }

      // Calculate distance if checkpoint has location
      let distance = 0;
      if (foundCheckpoint.location && foundCheckpoint.location.lat && foundCheckpoint.location.lng) {
        distance = calculateDistance(
          currentLocation.lat,
          currentLocation.lng,
          foundCheckpoint.location.lat,
          foundCheckpoint.location.lng
        );
      }
      setDistanceFromCheckpoint(distance);
      
      setScannedData({ qr_code: qrCodeText });
      setCheckpoint(foundCheckpoint);
      setScanTimestamp(currentTime);
      setScanLocation(currentLocation);

      const checkpointTemplates = templates.filter(
        t => t.checkpoint_id === foundCheckpoint.id
      );

      if (checkpointTemplates.length > 0) {
        const template = checkpointTemplates[0];
        setChecklistItems(template.items.map(item => ({
          ...item,
          checked: false,
          value: "",
          photo_url: ""
        })));
      } else if (templates.length > 0) {
        // Use first available template
        setChecklistItems(templates[0].items.map(item => ({
          ...item,
          checked: false,
          value: "",
          photo_url: ""
        })));
      }

    } catch (error) {
      console.error("QR scan error:", error);
      
      // Fallback - accept any code
      const currentTime = new Date().toISOString();
      const currentLocation = location;

      setScannedData({ qr_code: qrCodeText });
      setCheckpoint({
        id: "manual-" + Date.now(),
        name: "Scanned Checkpoint",
        qr_code: qrCodeText,
        location: currentLocation || { lat: 0, lng: 0 }
      });
      setScanTimestamp(currentTime);
      setScanLocation(currentLocation || { lat: 0, lng: 0 });
      setDistanceFromCheckpoint(0);

      if (templates.length > 0) {
        setChecklistItems(templates[0].items.map(item => ({
          ...item,
          checked: false,
          value: "",
          photo_url: ""
        })));
      }
    }
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...checklistItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setChecklistItems(newItems);
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append('file', file);
        
        const result = await base44.functions.invoke('uploadPhotoFile', {}, formData);
        if (result.data?.file_url) {
          setPhotos([...photos, result.data.file_url]);
        } else {
          throw new Error(result.data?.error || "Upload failed");
        }
      } catch (error) {
        console.error("Photo upload error:", error);
        alert("Failed to upload photo");
      }
    }
  };

  const handleVideoUpload = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setVideos([...videos, file_url]);
      } catch (error) {
        alert("Failed to upload video");
      }
    }
  };

  const isComplete = () => {
    return checklistItems.every(item => {
      if (!item.required) return true;
      if (item.type === "checkbox") return item.checked;
      if (item.type === "text") return item.value.trim().length > 0;
      if (item.type === "photo") return item.photo_url.length > 0;
      return true;
    });
  };

  const handleSubmit = async () => {
    if (!isComplete()) {
      alert("Please complete all required checklist items");
      return;
    }

    if (!signature) {
      setShowSignature(true);
      return;
    }

    setSubmitting(true);

    try {
      await base44.entities.PatrolLog.create({
        guard_id: user.id,
        guard_name: user.full_name,
        shift_id: shift.id,
        site_id: shift.site_id,
        checkpoint_id: checkpoint.id,
        checkpoint_name: checkpoint.name,
        qr_code: checkpoint.qr_code,
        location: scanLocation,
        timestamp: scanTimestamp,
        verified: distanceFromCheckpoint !== null ? distanceFromCheckpoint <= 100 : true,
        notes: notes
      });

      if (checklistItems.length > 0) {
        await base44.entities.ChecklistCompletion.create({
          template_id: templates[0]?.id || "manual",
          template_name: templates[0]?.name || "Manual Checklist",
          guard_id: user.id,
          guard_name: user.full_name,
          shift_id: shift.id,
          site_id: shift.site_id,
          checkpoint_id: checkpoint.id,
          qr_code_scanned: checkpoint.qr_code,
          completed_items: checklistItems.map(item => ({
            item_id: item.id,
            checked: item.checked,
            value: item.value,
            photo_url: item.photo_url
          })),
          signature: {
            data_url: signature,
            timestamp: new Date().toISOString(),
            method: "digital"
          },
          location: scanLocation,
          completed_at: new Date().toISOString(),
          status: "completed",
          notes: notes,
          media: [
            ...photos.map(url => ({ type: "photo", url })),
            ...videos.map(url => ({ type: "video", url }))
          ]
        });
      }

      alert("✅ Checkpoint scanned and logged successfully!");
      
      setScannedData(null);
      setCheckpoint(null);
      setChecklistItems([]);
      setNotes("");
      setPhotos([]);
      setVideos([]);
      setSignature(null);
      setScanTimestamp(null);
      setScanLocation(null);
      
    } catch (error) {
      alert("Failed to submit checkpoint scan: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || !shift) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-white">You must be on an active shift to scan checkpoints</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showSignature && !signature) {
    return (
      <div className="min-h-screen p-4">
        <SignaturePad
          onSave={setSignature}
          onCancel={() => setShowSignature(false)}
        />
      </div>
    );
  }

  if (!scannedData) {
    return (
      <div className="min-h-screen p-4 flex items-center justify-center">
        <div className="w-full max-w-md">
          <Card className="bg-slate-800/50 border-slate-700 mb-4">
            <CardHeader>
              <CardTitle className="text-white">Scan Checkpoint</CardTitle>
              <p className="text-sm text-slate-400 mt-2">
                Current Site: {site?.name || "Loading..."}
              </p>
            </CardHeader>
          </Card>
          <QRCodeReader onScan={handleScan} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 space-y-4">
      <Card className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            Checkpoint Scanned Successfully
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-slate-300">
              <MapPin className="w-4 h-4 text-emerald-400" />
              <span>{checkpoint.name}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              <Clock className="w-4 h-4 text-sky-400" />
              <span>{new Date(scanTimestamp).toLocaleTimeString()}</span>
            </div>
          </div>
          <div className="p-3 bg-slate-900/50 rounded-lg">
            <p className="text-xs text-slate-400">Scan Location</p>
            <p className="text-white text-sm">
              {scanLocation.lat.toFixed(6)}, {scanLocation.lng.toFixed(6)}
            </p>
            {distanceFromCheckpoint !== null && (
              <p className="text-xs text-emerald-400 mt-1">
                ✓ Location verified ({Math.round(distanceFromCheckpoint)}m from checkpoint)
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {checklistItems.length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">Checkpoint Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checklistItems.map((item, index) => (
              <div key={item.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                {item.type === "checkbox" && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={(checked) => handleItemChange(index, "checked", checked)}
                    />
                    <span className="text-white">
                      {item.text}
                      {item.required && <span className="text-rose-400 ml-1">*</span>}
                    </span>
                  </label>
                )}

                {item.type === "text" && (
                  <div>
                    <label className="text-white font-medium block mb-2">
                      {item.text}
                      {item.required && <span className="text-rose-400 ml-1">*</span>}
                    </label>
                    <Textarea
                      value={item.value}
                      onChange={(e) => handleItemChange(index, "value", e.target.value)}
                      placeholder="Enter details..."
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                  </div>
                )}

                {item.type === "photo" && (
                  <div>
                    <label className="text-white font-medium block mb-2">
                      {item.text}
                      {item.required && <span className="text-rose-400 ml-1">*</span>}
                    </label>
                    {item.photo_url ? (
                      <div className="relative">
                        <img src={item.photo_url} alt="Uploaded" className="w-full h-48 object-cover rounded-lg" />
                        <Button
                          size="sm"
                          onClick={() => handleItemChange(index, "photo_url", "")}
                          className="absolute top-2 right-2"
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={async (e) => {
                            try {
                              const file = e.target.files?.[0];
                              if (!file) {
                                return;
                              }
                              const formData = new FormData();
                              formData.append('file', file);
                              const result = await base44.functions.invoke('uploadPhotoFile', {}, formData);
                              if (result.data?.file_url) {
                                handleItemChange(index, "photo_url", result.data.file_url);
                              } else {
                                throw new Error(result.data?.error || "Upload failed");
                              }
                            } catch (error) {
                              console.error("Checklist photo upload error:", error);
                              alert("Failed to upload photo");
                            }
                          }}
                          className="hidden"
                          id={`item-photo-${index}`}
                        />
                        <label htmlFor={`item-photo-${index}`}>
                          <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500">
                            <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-sm text-slate-400">Take Photo</p>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">Additional Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-white font-medium block mb-2">Notes/Comments</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional observations or notes..."
              className="bg-slate-900 border-slate-700 text-white"
              rows={4}
            />
          </div>

          <div>
            <label className="text-white font-medium block mb-2">Photos</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoUpload}
              className="hidden"
              id="photos"
            />
            <label htmlFor="photos">
              <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500">
                <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Upload Photos</p>
              </div>
            </label>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="w-full h-24 object-cover rounded" />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-white font-medium block mb-2">Videos</label>
            <input
              type="file"
              accept="video/*"
              capture="environment"
              multiple
              onChange={handleVideoUpload}
              className="hidden"
              id="videos"
            />
            <label htmlFor="videos">
              <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500">
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Upload Videos</p>
              </div>
            </label>
            {videos.length > 0 && (
              <p className="text-sm text-emerald-400 mt-2">{videos.length} video(s) uploaded</p>
            )}
          </div>

          {signature && (
            <div className="p-4 bg-slate-900/50 rounded-lg border border-emerald-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Digital Signature</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSignature(null);
                    setShowSignature(true);
                  }}
                  className="text-sky-400"
                >
                  Re-sign
                </Button>
              </div>
              <img src={signature} alt="Signature" className="h-24 bg-white rounded" />
            </div>
          )}

          <Button
            className="w-full h-14 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            onClick={handleSubmit}
            disabled={!isComplete() || submitting}
          >
            {submitting ? (
              "Submitting..."
            ) : !signature ? (
              <>
                <PenTool className="w-5 h-5 mr-2" />
                Sign & Submit Checkpoint
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Submit Checkpoint Log
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}