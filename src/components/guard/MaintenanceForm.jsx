import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Upload, Mic, StopCircle, Sparkles, PenTool, Loader2, Send } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SignaturePad from "./SignaturePad";

export default function MaintenanceForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "lighting",
    urgency: "medium",
    guard_id: user.id,
    guard_name: user.full_name,
    site_id: shift?.site_id || "",
    site_name: shift?.site_name || "",
    location: location,
    media: [],
    voice_notes: [],
    signature: null,
    reported_at: new Date().toISOString()
  });
  
  const [submitting, setSubmitting] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [aiAssisting, setAiAssisting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }
    
    setSubmitting(true);

    try {
      await base44.entities.MaintenanceRequest.create(formData);

      // Send real-time notifications
      const allUsers = await base44.entities.User.list();
      const recipients = allUsers.filter(u => 
        ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type)
      );

      const maintenanceMessage = `
🔧 NEW MAINTENANCE REQUEST

Title: ${formData.title}
Category: ${formData.category}
Urgency: ${formData.urgency}
Site: ${formData.site_name}
Reported by: ${formData.guard_name}
Time: ${new Date().toLocaleString()}

Description:
${formData.description}

${formData.location ? `Location: ${formData.location.lat}, ${formData.location.lng}` : ''}

Status: Reported
Officer Signature: Signed
Voice Notes: ${formData.voice_notes.length} attached
      `.trim();

      for (const recipient of recipients) {
        if (recipient.email) {
          await base44.integrations.Core.SendEmail({
            to: recipient.email,
            subject: `🔧 ${formData.urgency.toUpperCase()} MAINTENANCE: ${formData.title} - ${formData.site_name}`,
            body: maintenanceMessage
          });
        }
      }

      alert("✅ Maintenance request submitted successfully!");
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          setFormData(prev => ({
            ...prev,
            voice_notes: [...prev.voice_notes, file_url]
          }));
        } catch (error) {
          alert("Failed to upload voice note");
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      alert("Failed to access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      setMediaRecorder(null);
    }
  };

  const getAIAssistance = async () => {
    setAiAssisting(true);
    try {
      const prompt = `Based on this maintenance issue, provide professional recommendations:

Category: ${formData.category}
Title: ${formData.title}
Description: ${formData.description}
Urgency: ${formData.urgency}

Please provide:
1. Enhanced description with technical details
2. Recommended immediate actions
3. Safety considerations`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            enhanced_description: { type: "string" },
            recommendations: { type: "string" }
          }
        }
      });

      setFormData(prev => ({
        ...prev,
        description: prev.description + "\n\nAI Enhancement: " + response.enhanced_description + "\n\nRecommendations: " + response.recommendations
      }));
    } catch (error) {
      alert("AI assistance failed");
    } finally {
      setAiAssisting(false);
    }
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">Maintenance Request</CardTitle>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={getAIAssistance}
                disabled={aiAssisting || !formData.title}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {aiAssisting ? "AI Assisting..." : "AI Assist"}
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Issue Title *</label>
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
                placeholder="Detailed description of the maintenance issue..."
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
                    <SelectItem value="lighting">Lighting</SelectItem>
                    <SelectItem value="locks">Locks & Keys</SelectItem>
                    <SelectItem value="fencing">Fencing</SelectItem>
                    <SelectItem value="gate">Gate/Barrier</SelectItem>
                    <SelectItem value="alarm_system">Alarm System</SelectItem>
                    <SelectItem value="camera">Camera/CCTV</SelectItem>
                    <SelectItem value="plumbing">Plumbing</SelectItem>
                    <SelectItem value="electrical">Electrical</SelectItem>
                    <SelectItem value="structural">Structural</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Urgency</label>
                <Select value={formData.urgency} onValueChange={(value) => setFormData({ ...formData, urgency: value })}>
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
                      alt="Issue"
                      className="h-20 w-20 object-cover rounded border border-slate-700"
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Voice Notes</label>
              <Button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                className={`w-full ${recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-sky-600 hover:bg-sky-700'}`}
              >
                {recording ? (
                  <>
                    <StopCircle className="w-5 h-5 mr-2 animate-pulse" />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5 mr-2" />
                    Record Voice Note
                  </>
                )}
              </Button>
              {formData.voice_notes.length > 0 && (
                <p className="text-sm text-emerald-400 mt-2">
                  {formData.voice_notes.length} voice note(s) recorded
                </p>
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
                disabled={submitting}
                className="flex-1 bg-amber-600 hover:bg-amber-700"
              >
                {submitting ? (
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
                    Submit Request
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