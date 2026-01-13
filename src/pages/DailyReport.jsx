import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { FileText, Send, Loader2, Camera, CheckCircle2 } from "lucide-react";
import SignaturePad from "../components/guard/SignaturePad";

export default function DailyReport() {
  const [user, setUser] = useState(null);
  const [report, setReport] = useState({
    shift_post: "",
    special_instructions: "",
    post_items_received: "",
    observations: [{ type: "", time: "", comments: "" }],
    relieving_officer_first: "",
    relieving_officer_last: "",
    additional_notes: "",
    photos: [],
    signature: null
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: activeShift } = useQuery({
    queryKey: ["activeShift", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      return shifts[0] || null;
    },
    enabled: !!user
  });

  const { data: site } = useQuery({
    queryKey: ["site", activeShift?.site_id],
    queryFn: async () => {
      if (!activeShift?.site_id) return null;
      return await base44.entities.Site.get(activeShift.site_id);
    },
    enabled: !!activeShift
  });

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    setUploadingPhoto(true);
    for (const file of files) {
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setReport(prev => ({
          ...prev,
          photos: [...prev.photos, file_url]
        }));
      } catch (error) {
        alert("Failed to upload photo");
      }
    }
    setUploadingPhoto(false);
  };

  const addObservation = () => {
    setReport(prev => ({
      ...prev,
      observations: [...prev.observations, { type: "", time: "", comments: "" }]
    }));
  };

  const updateObservation = (index, field, value) => {
    const newObservations = [...report.observations];
    newObservations[index][field] = value;
    setReport(prev => ({ ...prev, observations: newObservations }));
  };

  const handleSubmit = async () => {
    if (!activeShift || !user) {
      alert("You must be on an active shift to submit a report");
      return;
    }

    if (!report.signature) {
      setShowSignature(true);
      return;
    }

    setSubmitting(true);
    try {
      const reportData = {
        title: `Daily Activity Report - ${new Date().toLocaleDateString()}`,
        description: `
INTERNAL ID: ${Date.now()}
DATE ENTERED: ${new Date().toLocaleString()}
CLIENT: ${site?.client_name || 'N/A'}
SITE: ${activeShift.site_name}

OFFICER / ENTERED BY:
Officer Name: ${user.full_name}
Entered By: ${user.full_name}

DAILY ACTIVITY REPORT:
Shift/Post: ${report.shift_post}
Special Instructions: ${report.special_instructions}
Post Items Received: ${report.post_items_received}

OBSERVATIONS:
${report.observations.map((obs, i) => `#${i+1} Type: ${obs.type}, Time: ${obs.time}, Comments: ${obs.comments}`).join('\n')}

RELIEVING OFFICER INFORMATION:
First Name: ${report.relieving_officer_first}
Last Name: ${report.relieving_officer_last}

ADDITIONAL NOTES:
${report.additional_notes}

PHOTOS: ${report.photos.length} photo(s) attached
        `.trim(),
        category: "other",
        priority: "low",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: activeShift.site_id,
        site_name: activeShift.site_name,
        shift_id: activeShift.id,
        reported_at: new Date().toISOString(),
        media: report.photos.map(url => ({ type: "photo", url }))
      };

      const createdIncident = await base44.entities.Incident.create(reportData);

      // Mark daily report as completed
      await base44.auth.updateMe({
        needs_daily_report: false
      });

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

      // Send comprehensive notifications to all admins with ACTUAL report details
      try {
        const allUsers = await base44.entities.User.list();
        const admins = allUsers
          .filter(u => ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type));

        const detailedReport = `
GUARD: ${user.full_name}
SITE: ${activeShift.site_name}
CLIENT: ${site?.client_name || 'N/A'}
SUBMITTED: ${new Date().toLocaleString()}

SHIFT/POST: ${report.shift_post}
SPECIAL INSTRUCTIONS: ${report.special_instructions}
POST ITEMS RECEIVED: ${report.post_items_received}

OBSERVATIONS:
${report.observations.map((obs, i) => `#${i+1} Type: ${obs.type}, Time: ${obs.time}, Comments: ${obs.comments}`).join('\n')}

RELIEVING OFFICER:
First Name: ${report.relieving_officer_first}
Last Name: ${report.relieving_officer_last}

ADDITIONAL NOTES:
${report.additional_notes}

PHOTOS: ${report.photos.length} attached
        `.trim();

        for (const admin of admins) {
          await base44.functions.invoke('sendComprehensiveNotification', {
            recipientIds: [admin.id],
            type: 'shift_reminder',
            title: `📊 Daily Activity Report: ${user.full_name} - ${activeShift.site_name}`,
            message: `Guard ${user.full_name} has submitted their daily activity report for ${activeShift.site_name}.`,
            priority: 'medium',
            relatedEntity: 'incident',
            relatedId: createdIncident.id,
            metadata: {
              guard_name: user.full_name,
              guard_photo: user.profile_photo || null,
              site: activeShift.site_name,
              client: site?.client_name || 'N/A',
              date_entered: new Date().toLocaleString(),
              shift_post: report.shift_post,
              special_instructions: report.special_instructions,
              post_items_received: report.post_items_received,
              observations_count: report.observations.filter(o => o.type || o.comments).length,
              relieving_officer: `${report.relieving_officer_first} ${report.relieving_officer_last}`,
              additional_notes: report.additional_notes,
              photos_count: report.photos.length,
              signature: report.signature,
              latitude: currentLocation?.lat,
              longitude: currentLocation?.lng,
              full_report: detailedReport
            },
            sendEmail: true
          });
        }
      } catch (error) {
        console.error('Failed to send notification emails:', error);
      }

      setSubmitted(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
    } catch (error) {
      alert("Failed to submit report: " + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400" />
      </div>
    );
  }

  if (showSignature) {
    return (
      <div className="min-h-screen p-4">
        <SignaturePad
          onSave={(sig) => {
            setReport(prev => ({ ...prev, signature: sig }));
            setShowSignature(false);
          }}
          onCancel={() => setShowSignature(false)}
        />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen p-4 flex items-center justify-center">
        <Card className="max-w-md bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
          <CardContent className="pt-12 pb-12 text-center">
            <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-white mb-2">Report Submitted!</h2>
            <p className="text-slate-400">Your daily activity report has been recorded and sent to management</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Daily Activity Report</h1>
          <p className="text-slate-400">Complete your shift report</p>
        </div>
      </div>

      {activeShift && site && (
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
              <span className="text-white">{activeShift.site_name}</span>
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
            <span className="text-white">{user.full_name}</span>
            <span className="text-slate-400">Entered By:</span>
            <span className="text-white">{user.full_name}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">DAILY ACTIVITY REPORT</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-white font-medium block mb-2">Shift/Post</label>
            <Input
              value={report.shift_post}
              onChange={(e) => setReport({ ...report, shift_post: e.target.value })}
              placeholder="e.g., Day shift, Night shift"
              className="bg-slate-900 border-slate-700 text-white"
            />
          </div>

          <div>
            <label className="text-white font-medium block mb-2">Special Instructions</label>
            <Textarea
              value={report.special_instructions}
              onChange={(e) => setReport({ ...report, special_instructions: e.target.value })}
              placeholder="Any special instructions for this shift..."
              className="bg-slate-900 border-slate-700 text-white"
              rows={2}
            />
          </div>

          <div>
            <label className="text-white font-medium block mb-2">Post Items Received</label>
            <Input
              value={report.post_items_received}
              onChange={(e) => setReport({ ...report, post_items_received: e.target.value })}
              placeholder="e.g., Phone, Radio, Keys"
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
          {report.observations.map((obs, index) => (
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
          <CardTitle className="text-white">RELIEVING OFFICER INFORMATION</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="First Name"
            value={report.relieving_officer_first}
            onChange={(e) => setReport({ ...report, relieving_officer_first: e.target.value })}
            className="bg-slate-900 border-slate-700 text-white"
          />
          <Input
            placeholder="Last Name"
            value={report.relieving_officer_last}
            onChange={(e) => setReport({ ...report, relieving_officer_last: e.target.value })}
            className="bg-slate-900 border-slate-700 text-white"
          />
        </CardContent>
      </Card>

      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">ADDITIONAL NOTES</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={report.additional_notes}
            onChange={(e) => setReport({ ...report, additional_notes: e.target.value })}
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
          {report.photos.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {report.photos.map((url, i) => (
                <img key={i} src={url} alt={`Photo ${i+1}`} className="w-full h-auto max-h-96 object-contain bg-slate-900 rounded border border-slate-700" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {report.signature && (
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
            <img src={report.signature} alt="Signature" className="h-24 bg-white rounded" />
          </CardContent>
        </Card>
      )}

      <Button
        onClick={handleSubmit}
        disabled={submitting || !activeShift}
        className="w-full h-16 text-lg bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 font-bold"
      >
        {submitting ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Submitting Report...
          </>
        ) : !report.signature ? (
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

      {!activeShift && (
        <p className="text-rose-400 text-center">
          You must be on an active shift to submit a daily report
        </p>
      )}
    </div>
  );
}