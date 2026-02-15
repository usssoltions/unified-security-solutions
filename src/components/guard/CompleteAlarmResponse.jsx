import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { X, Loader2, CheckCircle2, Camera, Video } from "lucide-react";
import SignaturePad from "./SignaturePad";

export default function CompleteAlarmResponse({ alarm, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    summary: "",
    actions_taken: "",
    findings: "",
    police_called: false,
    police_case_number: "",
    photos: [],
    videos: [],
    signature: ""
  });
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSignature, setShowSignature] = useState(false);

  const handleMediaUpload = async (files, type) => {
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        urls.push(file_url);
      }
      setFormData({
        ...formData,
        [type]: [...formData[type], ...urls]
      });
    } catch (error) {
      alert("Failed to upload media");
    } finally {
      setUploading(false);
    }
  };

  const handleComplete = async () => {
    if (!formData.summary || !formData.signature) {
      alert("Please provide a summary and signature");
      return;
    }

    setSubmitting(true);

    try {
      await base44.entities.AlarmResponse.update(alarm.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        completion_report: formData
      });

      // Notify control room
      await base44.entities.Alert.create({
        type: "system",
        priority: "medium",
        title: "Alarm Response Completed",
        message: `${alarm.assigned_to_name} completed response at ${alarm.address}`,
        status: "active"
      });

      // Create incident report if not false alarm
      if (alarm.alarm_type !== "false_alarm") {
        await base44.entities.Incident.create({
          title: `Alarm Response: ${alarm.alarm_type}`,
          description: formData.summary,
          category: alarm.alarm_type.includes("burglary") ? "theft" : "other",
          priority: alarm.priority,
          status: "closed",
          guard_id: alarm.assigned_to,
          guard_name: alarm.assigned_to_name,
          site_id: "",
          site_name: alarm.address,
          location: alarm.location,
          media: formData.photos.map(url => ({ type: "photo", url })),
          resolution_notes: formData.actions_taken,
          reported_at: alarm.dispatched_at,
          resolved_at: new Date().toISOString()
        });
      }

      onSuccess();
    } catch (error) {
      alert("Failed to complete response");
    } finally {
      setSubmitting(false);
    }
  };

  if (showSignature && !formData.signature) {
    return (
      <SignaturePad
        onSave={(signature) => {
          setFormData({ ...formData, signature });
          setShowSignature(false);
        }}
        onCancel={() => setShowSignature(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="min-h-screen p-3 sm:p-4 flex items-start justify-center py-3 sm:py-4">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-2 sm:my-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">Complete Response</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <div className="p-3 bg-slate-900/50 rounded-lg">
              <p className="text-sm text-slate-400">Alarm Type</p>
              <p className="text-white font-semibold">{alarm.alarm_type.replace(/_/g, ' ')}</p>
              <p className="text-sm text-slate-400 mt-1">{alarm.address}</p>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Summary <span className="text-rose-400">*</span>
              </label>
              <Textarea
                placeholder="Brief summary of the situation..."
                value={formData.summary}
                onChange={(e) => setFormData({ ...formData, summary: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-20"
              />
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Actions Taken</label>
              <Textarea
                placeholder="What actions did you take?"
                value={formData.actions_taken}
                onChange={(e) => setFormData({ ...formData, actions_taken: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-20"
              />
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Findings</label>
              <Textarea
                placeholder="What did you find at the scene?"
                value={formData.findings}
                onChange={(e) => setFormData({ ...formData, findings: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-20"
              />
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2 text-white cursor-pointer">
                <Checkbox
                  checked={formData.police_called}
                  onCheckedChange={(checked) => setFormData({ ...formData, police_called: checked })}
                />
                <span className="text-sm">Police called to scene</span>
              </label>

              {formData.police_called && (
                <Input
                  placeholder="Police case number"
                  value={formData.police_case_number}
                  onChange={(e) => setFormData({ ...formData, police_case_number: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              )}
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Evidence</label>
              <div className="flex gap-3">
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleMediaUpload(Array.from(e.target.files), 'photos')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-slate-600"
                    disabled={uploading}
                    onClick={(e) => e.currentTarget.previousElementSibling.click()}
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Photos ({formData.photos.length})
                  </Button>
                </label>

                <label className="flex-1">
                  <input
                    type="file"
                    accept="video/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => handleMediaUpload(Array.from(e.target.files), 'videos')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-slate-600"
                    disabled={uploading}
                    onClick={(e) => e.currentTarget.previousElementSibling.click()}
                  >
                    <Video className="w-4 h-4 mr-2" />
                    Videos ({formData.videos.length})
                  </Button>
                </label>
              </div>
            </div>

            {(formData.photos.length > 0 || formData.videos.length > 0) && (
              <div className="grid grid-cols-3 gap-2">
                {formData.photos.map((url, idx) => (
                  <img
                    key={idx}
                    src={url}
                    alt="Evidence"
                    className="w-full h-24 object-cover rounded border border-slate-700"
                  />
                ))}
              </div>
            )}

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Signature <span className="text-rose-400">*</span>
              </label>
              {formData.signature ? (
                <div className="relative">
                  <img
                    src={formData.signature}
                    alt="Signature"
                    className="w-full h-32 bg-white rounded border border-slate-700"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setFormData({ ...formData, signature: "" })}
                    className="absolute top-2 right-2"
                  >
                    Clear
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setShowSignature(true)}
                  className="w-full border-slate-600"
                >
                  Sign Here
                </Button>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleComplete}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Completing...
                  </>
                ) : (
                  "Complete Response"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}