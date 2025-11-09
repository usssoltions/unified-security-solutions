import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Upload } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "suspicious_activity",
    priority: "medium",
    guard_id: user.id,
    guard_name: user.full_name,
    site_id: shift?.site_id || "",
    site_name: shift?.site_name || "",
    shift_id: shift?.id || "",
    location: location,
    media: [],
    reported_at: new Date().toISOString()
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await base44.entities.Incident.create(formData);
      alert("✅ Incident reported successfully!");
      onSuccess();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMediaCapture = async (e) => {
    const files = Array.from(e.target.files);
    
    for (const file of files) {
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData(prev => ({
          ...prev,
          media: [...prev.media, {
            type: file.type.startsWith('video') ? 'video' : 'photo',
            url: file_url
          }]
        }));
      } catch (error) {
        alert(`Failed to upload ${file.name}`);
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Report Incident</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Incident Title *</label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-slate-900/50 border-slate-700 text-white"
                required
                placeholder="Brief description"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Description *</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-900/50 border-slate-700 text-white h-32"
                required
                placeholder="Detailed description of the incident..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Category</label>
                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                  <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fire">Fire</SelectItem>
                    <SelectItem value="theft">Theft</SelectItem>
                    <SelectItem value="vandalism">Vandalism</SelectItem>
                    <SelectItem value="medical">Medical</SelectItem>
                    <SelectItem value="trespassing">Trespassing</SelectItem>
                    <SelectItem value="suspicious_activity">Suspicious Activity</SelectItem>
                    <SelectItem value="equipment_failure">Equipment Failure</SelectItem>
                    <SelectItem value="safety_hazard">Safety Hazard</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Priority</label>
                <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                  <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Photos/Videos</label>
              <div className="flex gap-2">
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    capture="environment"
                    multiple
                    onChange={handleMediaCapture}
                    className="hidden"
                  />
                  <Button type="button" variant="outline" className="w-full border-slate-700" asChild>
                    <div>
                      <Camera className="w-4 h-4 mr-2" />
                      Take Photo/Video
                    </div>
                  </Button>
                </label>
                <label className="flex-1">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    onChange={handleMediaCapture}
                    className="hidden"
                  />
                  <Button type="button" variant="outline" className="w-full border-slate-700" asChild>
                    <div>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Media
                    </div>
                  </Button>
                </label>
              </div>
              {formData.media.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto">
                  {formData.media.map((media, idx) => (
                    <img
                      key={idx}
                      src={media.url}
                      alt="Evidence"
                      className="h-20 w-20 object-cover rounded border border-slate-700"
                    />
                  ))}
                </div>
              )}
            </div>

            {location && (
              <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <p className="text-xs text-slate-400 mb-1">GPS Location</p>
                <p className="text-sm text-white font-mono">
                  {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                </p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
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
                disabled={submitting}
                className="flex-1 bg-rose-600 hover:bg-rose-700"
              >
                {submitting ? "Submitting..." : "Report Incident"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}