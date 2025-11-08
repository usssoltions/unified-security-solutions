import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, X, Loader2, AlertTriangle } from "lucide-react";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "suspicious_activity",
    priority: "medium"
  });
  const [media, setMedia] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const categories = [
    { value: "fire", label: "Fire" },
    { value: "theft", label: "Theft" },
    { value: "vandalism", label: "Vandalism" },
    { value: "medical", label: "Medical Emergency" },
    { value: "trespassing", label: "Trespassing" },
    { value: "suspicious_activity", label: "Suspicious Activity" },
    { value: "equipment_failure", label: "Equipment Failure" },
    { value: "safety_hazard", label: "Safety Hazard" },
    { value: "other", label: "Other" }
  ];

  const priorities = [
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" }
  ];

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    setUploading(true);

    try {
      const uploadPromises = files.map(async (file) => {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        return { type: "photo", url: file_url };
      });

      const uploaded = await Promise.all(uploadPromises);
      setMedia([...media, ...uploaded]);
    } catch (error) {
      alert("Failed to upload photos");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title.trim() || !formData.description.trim()) {
      alert("Please fill in all required fields");
      return;
    }

    setSubmitting(true);

    try {
      await base44.entities.Incident.create({
        ...formData,
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: shift?.site_id || "",
        site_name: shift?.site_name || "",
        shift_id: shift?.id || "",
        location: location,
        media: media,
        reported_at: new Date().toISOString(),
        status: "reported"
      });

      // Create alert for dispatcher
      await base44.entities.Alert.create({
        type: "panic",
        priority: formData.priority,
        title: `New ${formData.priority} priority incident`,
        message: `${user.full_name} reported: ${formData.title}`,
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: shift?.site_id,
        location: location,
        status: "active"
      });

      onSuccess();
    } catch (error) {
      alert("Failed to submit incident report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">Report Incident</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Incident Title <span className="text-rose-400">*</span>
              </label>
              <Input
                placeholder="Brief description of incident"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Category</label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => setFormData({ ...formData, category: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Priority</label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => setFormData({ ...formData, priority: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((pri) => (
                      <SelectItem key={pri.value} value={pri.value}>
                        {pri.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Description <span className="text-rose-400">*</span>
              </label>
              <Textarea
                placeholder="Detailed description of what occurred..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white min-h-32"
              />
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Evidence</label>
              <input
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                onChange={handlePhotoUpload}
                className="hidden"
                id="incident-photos"
              />
              <label htmlFor="incident-photos">
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500 transition-colors">
                  <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-400">
                    {uploading ? "Uploading..." : "Add Photos/Videos"}
                  </p>
                </div>
              </label>

              {media.length > 0 && (
                <div className="flex gap-2 mt-3 overflow-x-auto">
                  {media.map((item, idx) => (
                    <div key={idx} className="relative flex-shrink-0">
                      <img
                        src={item.url}
                        alt="Evidence"
                        className="h-24 w-24 object-cover rounded-lg border border-slate-700"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="absolute -top-2 -right-2 h-6 w-6 bg-slate-900 border border-slate-700"
                        onClick={() => setMedia(media.filter((_, i) => i !== idx))}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
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
                onClick={handleSubmit}
                disabled={submitting || uploading}
                className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Report"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}