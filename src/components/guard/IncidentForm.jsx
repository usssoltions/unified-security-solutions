import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Loader2, Send, PenTool } from "lucide-react";
import SignaturePad from "./SignaturePad";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "other",
    priority: "medium",
    media: [],
    signature: null
  });

  const [uploading, setUploading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const incident = await base44.entities.Incident.create({
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: shift?.site_id || "",
        site_name: shift?.site_name || "",
        shift_id: shift?.id || "",
        location: location,
        reported_at: new Date().toISOString(),
        media: data.media
      });

      // Send notifications
      try {
        const allUsers = await base44.entities.User.list();
        const managementEmails = allUsers
          .filter(u => ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type))
          .map(u => u.email)
          .filter(Boolean);

        for (const email of managementEmails) {
          await base44.integrations.Core.SendEmail({
            to: email,
            subject: `🚨 INCIDENT REPORT: ${data.title}`,
            body: `Incident reported by ${user.full_name}\n\n${data.description}\n\nSite: ${shift?.site_name || 'N/A'}\nPriority: ${data.priority}`
          });
        }
      } catch (error) {
        console.error('Failed to send notification emails:', error);
      }

      return incident;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["incidents"]);
      onSuccess();
    },
    onError: (error) => {
      alert(`Failed to report incident: ${error.message}`);
    }
  });

  const handleMediaCapture = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      const uploadedMedia = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedMedia.push({ type: 'photo', url: file_url });
      }
      setFormData({
        ...formData,
        media: [...formData.media, ...uploadedMedia]
      });
    } catch (error) {
      alert("Failed to upload media");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }
    
    createMutation.mutate(formData);
  };

  if (showSignature) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4">
          <SignaturePad
            onSave={(sig) => {
              setFormData({ ...formData, signature: sig });
              setShowSignature(false);
            }}
            onCancel={() => setShowSignature(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 pt-20">
        <Card className="w-full max-w-2xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-xl">Report Incident</CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-white font-medium block mb-2">Incident Title *</label>
                <Input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Brief description of incident"
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Category *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2"
                  required
                >
                  <option value="fire">Fire</option>
                  <option value="theft">Theft</option>
                  <option value="vandalism">Vandalism</option>
                  <option value="medical">Medical Emergency</option>
                  <option value="trespassing">Trespassing</option>
                  <option value="suspicious_activity">Suspicious Activity</option>
                  <option value="equipment_failure">Equipment Failure</option>
                  <option value="safety_hazard">Safety Hazard</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Priority *</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2"
                  required
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Description *</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Provide detailed description of the incident..."
                  className="bg-slate-900 border-slate-700 text-white min-h-32"
                  required
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Photos/Evidence</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleMediaCapture}
                  className="hidden"
                  id="incident-photos"
                />
                <label htmlFor="incident-photos">
                  <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500">
                    <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">{uploading ? "Uploading..." : "Take/Upload Photos"}</p>
                  </div>
                </label>
                {formData.media.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {formData.media.map((item, idx) => (
                      <img key={idx} src={item.url} alt="Evidence" className="w-full h-24 object-cover rounded" />
                    ))}
                  </div>
                )}
              </div>

              {formData.signature && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-emerald-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-400">Officer Signature</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowSignature(true)}
                      className="text-sky-400"
                    >
                      Re-sign
                    </Button>
                  </div>
                  <img src={formData.signature} alt="Signature" className="h-24 bg-white rounded" />
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
                  disabled={createMutation.isPending}
                  className="flex-1 bg-rose-600 hover:bg-rose-700"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : !formData.signature ? (
                    <>
                      <PenTool className="w-5 h-5 mr-2" />
                      Sign & Submit
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      Submit Report
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}