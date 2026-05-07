import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { saveOffline, isOnline } from "@/lib/offlineDB";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, Send, Shield, Camera } from "lucide-react";
import SignaturePad from "../components/guard/SignaturePad";
import WhatsAppNotifier from "@/components/WhatsAppNotifier";

export default function StartOfShift() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(null);
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [waMessage, setWaMessage] = useState(null);
  const [formData, setFormData] = useState({
    shift_post: "",
    special_instructions: "",
    post_items_received: "",
    relieving_officer: "",
    additional_notes: "",
    observations: [{ type: "", time: "", comments: "" }],
    photos: [],
    signature: null
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (currentUser.current_shift_id) {
        const currentShift = await base44.entities.Shift.get(currentUser.current_shift_id);
        setShift(currentShift);

        if (currentShift.site_id) {
          const currentSite = await base44.entities.Site.get(currentShift.site_id);
          setSite(currentSite);
        }
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    setUploadingPhoto(true);
    
    for (const file of files) {
      try {
        // Validate file
        if (!file.type.startsWith('image/')) {
          alert(`${file.name} is not an image file`);
          continue;
        }
        
        // Upload using the integration
        const result = await base44.integrations.Core.UploadFile({ file: file });
        
        if (result?.file_url) {
          setFormData(prev => ({
            ...prev,
            photos: [...prev.photos, result.file_url]
          }));
        } else {
          throw new Error('No file URL returned from upload');
        }
      } catch (fileError) {
        console.error("Full error details:", fileError);
        const errorMsg = fileError?.response?.data?.message || fileError?.message || 'Unknown error occurred';
        alert(`Upload failed: ${errorMsg}. Please try again or contact support if issue persists.`);
      }
    }
    
    setUploadingPhoto(false);
    e.target.value = '';
  };

  const addObservation = () => {
    setFormData(prev => ({
      ...prev,
      observations: [...prev.observations, { type: "", time: "", comments: "" }]
    }));
  };

  const updateObservation = (index, field, value) => {
    const newObservations = [...formData.observations];
    newObservations[index][field] = value;
    setFormData(prev => ({ ...prev, observations: newObservations }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }

    setSubmitting(true);

    try {
      // Get current location
      let currentLocation = null;
      if (navigator.geolocation) {
        try {
          const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
          });
          currentLocation = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
        } catch (error) {
          console.error('Failed to get location:', error);
        }
      }

      // Create shift handover record with full report details
      const handoverData = {
        shift_id: shift.id,
        site_id: shift.site_id,
        site_name: site?.name,
        outgoing_guard_id: user.id,
        outgoing_guard_name: user.full_name,
        handover_time: new Date().toISOString(),
        special_instructions: `
SHIFT/POST: ${formData.shift_post}
SPECIAL INSTRUCTIONS: ${formData.special_instructions}
POST ITEMS RECEIVED: ${formData.post_items_received}
RELIEVING OFFICER: ${formData.relieving_officer}

ADDITIONAL NOTES:
${formData.additional_notes}
        `.trim(),
        key_activities: formData.observations
          .filter(obs => obs.type || obs.comments)
          .map(obs => `${obs.type || 'Observation'} at ${obs.time}: ${obs.comments}`),
        media_attachments: formData.photos.map(url => ({ type: "photo", url }))
      };

      // If offline or rate-limited, save locally and redirect
      if (!isOnline()) {
        await saveOffline('pending_handover', { ...handoverData, _savedAt: new Date().toISOString() });
        await base44.auth.updateMe({ needs_start_of_shift_report: false }).catch(() => {});
        alert("✅ Report saved offline — will sync when connection is restored.");
        navigate(createPageUrl("GuardShift"));
        return;
      }

      let createdHandover;
      try {
        createdHandover = await base44.entities.ShiftHandover.create(handoverData);
      } catch (apiErr) {
        // Rate-limited or network error — save offline
        await saveOffline('pending_handover', { ...handoverData, _savedAt: new Date().toISOString() });
        try { await base44.auth.updateMe({ needs_start_of_shift_report: false }); } catch {}
        alert("✅ Server busy — report saved offline and will sync automatically.");
        navigate(createPageUrl("GuardShift"));
        return;
      }

      // Update user - mark that start of shift report is completed
      await base44.auth.updateMe({ needs_start_of_shift_report: false }).catch(() => {});

      // Notify admins via in-app notification + email (no backend function needed)
      try {
        const allUsers = await base44.entities.User.list();
        const admins = allUsers.filter(u =>
          ["admin", "dispatcher", "supervisor", "management"].includes(u.role_type)
        );
        const notifTitle = `🛡️ Start of Shift — ${user.full_name} @ ${site?.name || shift?.site_name}`;
        const notifMessage = `Guard ${user.full_name} has clocked in and submitted their start-of-shift report. Post: ${formData.shift_post || "N/A"}. Site: ${site?.name || "Unknown"}.`;

        for (const admin of admins) {
          await base44.entities.Notification.create({
            recipient_id: admin.id,
            recipient_name: admin.full_name,
            type: "shift_reminder",
            priority: "medium",
            title: notifTitle,
            message: notifMessage,
            read: false,
            related_entity: "shift_handover",
            related_id: createdHandover?.id || null,
          }).catch(() => {});

          if (admin.email) {
            await base44.integrations.Core.SendEmail({
              to: admin.email,
              subject: notifTitle,
              body: `${notifMessage}\n\nPost: ${formData.shift_post}\nSpecial Instructions: ${formData.special_instructions}\nPost Items: ${formData.post_items_received}\nRelieving Officer: ${formData.relieving_officer}\nAdditional Notes: ${formData.additional_notes}\n${currentLocation ? `GPS: ${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}` : ""}`,
            }).catch(() => {});
          }
        }

        // Show WhatsApp notifier before redirecting
        const { startOfShiftMessage, buildAdminLinks } = await import("@/lib/whatsapp");
        const waMsg = startOfShiftMessage({ guardName: user.full_name, siteName: site?.name || shift?.site_name, shiftPost: formData.shift_post });
        const waLinks = buildAdminLinks(waMsg);
        if (waLinks.length > 0) {
          setWaMessage(waMsg);
          return; // onDone will navigate
        }
      } catch (notifError) {
        console.warn("Notification skipped:", notifError?.message);
      }

      // Redirect back to guard shift page
      navigate(createPageUrl("GuardShift"));
    } catch (error) {
      console.error("Error submitting report:", error);
      alert("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (waMessage) {
    return (
      <WhatsAppNotifier
        message={waMessage}
        title="🛡️ Send Start-of-Shift Alerts via WhatsApp"
        onDone={() => { setWaMessage(null); navigate(createPageUrl("GuardShift")); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  if (showSignature) {
    return (
      <div className="min-h-screen p-4">
        <SignaturePad
          onSave={(sig) => {
            setFormData(prev => ({ ...prev, signature: sig }));
            setShowSignature(false);
          }}
          onCancel={() => setShowSignature(false)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto pt-8 space-y-4">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-sky-500 rounded-full flex items-center justify-center">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Start of Shift Report</h1>
            <p className="text-slate-400">
              {site?.name} • {new Date().toLocaleDateString()}
            </p>
          </div>
        </div>

        {site && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">ID, DATE, CLIENT, & SITE</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <span className="text-slate-400">Internal ID:</span>
                <span className="text-white">{Date.now()}</span>
                <span className="text-slate-400">Date Entered:</span>
                <span className="text-white">{new Date().toLocaleString()}</span>
                <span className="text-slate-400">Client:</span>
                <span className="text-white">{site.client_name}</span>
                <span className="text-slate-400">Site:</span>
                <span className="text-white">{shift?.site_name}</span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">OFFICER / ENTERED BY</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-slate-400">Officer Name:</span>
              <span className="text-white">{user?.full_name}</span>
              <span className="text-slate-400">Entered By:</span>
              <span className="text-white">{user?.full_name}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">START OF SHIFT INFORMATION</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-white font-medium block mb-2">Shift/Post</label>
              <Input
                value={formData.shift_post}
                onChange={(e) => setFormData({ ...formData, shift_post: e.target.value })}
                placeholder="e.g., Day shift, Night shift"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-white font-medium block mb-2">Special Instructions</label>
              <Textarea
                value={formData.special_instructions}
                onChange={(e) => setFormData({ ...formData, special_instructions: e.target.value })}
                placeholder="Any special instructions for this shift..."
                className="bg-slate-900 border-slate-700 text-white"
                rows={2}
              />
            </div>

            <div>
              <label className="text-white font-medium block mb-2">Post Items Received</label>
              <Input
                value={formData.post_items_received}
                onChange={(e) => setFormData({ ...formData, post_items_received: e.target.value })}
                placeholder="e.g., Phone, Radio, Keys"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-white font-medium block mb-2">Relieving Officer</label>
              <Input
                value={formData.relieving_officer}
                onChange={(e) => setFormData({ ...formData, relieving_officer: e.target.value })}
                placeholder="Name of officer you're relieving"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">OBSERVATIONS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {formData.observations.map((obs, index) => (
              <div key={index} className="p-4 bg-slate-900/50 rounded-lg space-y-3">
                <h4 className="text-white font-semibold">Observation #{index + 1}</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    placeholder="Type"
                    value={obs.type}
                    onChange={(e) => updateObservation(index, 'type', e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                  <Input
                    type="time"
                    value={obs.time}
                    onChange={(e) => updateObservation(index, 'time', e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
                <Textarea
                  placeholder="Comments"
                  value={obs.comments}
                  onChange={(e) => updateObservation(index, 'comments', e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                  rows={2}
                />
              </div>
            ))}
            <Button onClick={addObservation} variant="outline" className="w-full border-slate-600">
              + Add Observation
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">ADDITIONAL NOTES</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={formData.additional_notes}
              onChange={(e) => setFormData({ ...formData, additional_notes: e.target.value })}
              placeholder="Any additional information..."
              className="bg-slate-900 border-slate-700 text-white"
              rows={4}
            />
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">PHOTOS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500">
                <Camera className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                <p className="text-slate-400">{uploadingPhoto ? "Uploading..." : "Take/Upload Photos"}</p>
              </div>
            </label>
            {formData.photos.length > 0 && (
              <div className="grid grid-cols-1 gap-3">
                {formData.photos.map((url, i) => (
                  <img key={i} src={url} alt={`Photo ${i+1}`} className="w-full h-auto max-h-96 object-contain bg-slate-900 rounded border border-slate-700" />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {formData.signature && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-white font-medium">Digital Signature</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSignature(true)}
                  className="text-sky-400"
                >
                  Re-sign
                </Button>
              </div>
              <img src={formData.signature} alt="Signature" className="h-24 bg-white rounded" />
            </CardContent>
          </Card>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitting || !shift}
          className="w-full h-16 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 font-bold"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Submitting Report...
            </>
          ) : !formData.signature ? (
            <>
              <Send className="w-5 h-5 mr-2" />
              Sign & Submit Report
            </>
          ) : (
            <>
              <Send className="w-5 h-5 mr-2" />
              Submit Report
            </>
          )}
        </Button>

        {!shift && (
          <p className="text-rose-400 text-center">
            You must be on an active shift to submit a start of shift report
          </p>
        )}
      </div>
    </div>
  );
}