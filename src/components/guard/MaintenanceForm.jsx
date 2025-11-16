import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Upload, Mic, StopCircle, Sparkles, PenTool, Loader2, Send, Video, Play } from "lucide-react";
import SignaturePad from "./SignaturePad";

export default function MaintenanceForm({ user, shift, location, onClose, onSuccess }) {
  const maintenanceCategories = [
    "Lighting", "Locks & Keys", "Fencing", "Gate/Barrier", "Alarm System",
    "Camera/CCTV", "Plumbing", "Electrical", "Structural", "Other"
  ];

  const [formData, setFormData] = useState({
    maintenance_type: "",
    maintenance_type_other: "",
    details: "",
    who_notified: "",
    email_client: "YES",
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
  const [videoRecording, setVideoRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [videoPreview, setVideoPreview] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const videoPreviewRef = useRef(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }
    
    setSubmitting(true);

    try {
      const reportContent = `
MAINTENANCE REQUEST
Time Zone: Africa/Johannesburg

DATE, CLIENT, & SITE
Date Entered: ${new Date().toLocaleString()}
Client: ${shift?.client_name || 'N/A'}
Site: ${formData.site_name}

OFFICER INFORMATION
Officer Name: ${formData.guard_name}

MAINTENANCE REQUEST
Maintenance Type: ${formData.maintenance_type}
${formData.maintenance_type_other ? `If Other, What Type: ${formData.maintenance_type_other}` : ''}
Details: ${formData.details}

NOTIFICATION
Who has been notified: ${formData.who_notified}
Email Client: ${formData.email_client}

PHOTOS: ${formData.media.filter(m => m.type === 'photo').length} photo(s) attached
MEDIA: ${formData.media.filter(m => m.type === 'video').length} video(s) attached
Voice Notes: ${formData.voice_notes.length} voice note(s) attached
Officer Signature: Signed
      `.trim();

      const maintenanceRequest = await base44.entities.MaintenanceRequest.create({
        title: `Maintenance: ${formData.maintenance_type}`,
        description: reportContent,
        category: "other",
        urgency: "medium",
        guard_id: formData.guard_id,
        guard_name: formData.guard_name,
        site_id: formData.site_id,
        site_name: formData.site_name,
        location: formData.location,
        reported_at: formData.reported_at,
        media: formData.media
      });

      // Send email notifications to all admins
      try {
        const admins = await base44.entities.User.filter({ role_type: 'admin' });
        
        for (const admin of admins) {
          if (admin.email) {
            await base44.integrations.Core.SendEmail({
              to: admin.email,
              subject: `🔧 Maintenance Request: ${formData.maintenance_type} - ${formData.site_name}`,
              body: `
<h2>New Maintenance Request Submitted</h2>

<p><strong>Maintenance Type:</strong> ${formData.maintenance_type}</p>
${formData.maintenance_type_other ? `<p><strong>Specific Type:</strong> ${formData.maintenance_type_other}</p>` : ''}
<p><strong>Site:</strong> ${formData.site_name}</p>
<p><strong>Guard:</strong> ${formData.guard_name}</p>
<p><strong>Date/Time:</strong> ${new Date().toLocaleString()}</p>

<h3>Details:</h3>
<p>${formData.details}</p>

${formData.who_notified ? `<p><strong>Who Notified:</strong> ${formData.who_notified}</p>` : ''}
<p><strong>Email Client:</strong> ${formData.email_client}</p>

${formData.media.length > 0 ? `<p><strong>Media:</strong> ${formData.media.length} file(s) attached</p>` : ''}
${formData.voice_notes.length > 0 ? `<p><strong>Voice Notes:</strong> ${formData.voice_notes.length} recording(s)</p>` : ''}

<p><strong>GPS Location:</strong> ${formData.location ? `${formData.location.lat.toFixed(6)}, ${formData.location.lng.toFixed(6)}` : 'Not available'}</p>

<p>Log into the SecureGuard system to view full details and manage this request.</p>
              `
            });
          }
        }
      } catch (emailError) {
        console.error("Failed to send email notifications:", emailError);
      }

      alert("✅ Maintenance request submitted successfully!");
      onSuccess();
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhotoCapture = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        setFormData(prev => ({
          ...prev,
          media: [...prev.media, { type: 'photo', url: file_url }]
        }));
      }
    } catch (error) {
      alert("Failed to upload photo");
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const type = file.type.startsWith('video') ? 'video' : 'photo';
        setFormData(prev => ({
          ...prev,
          media: [...prev.media, { type, url: file_url }]
        }));
      }
    } catch (error) {
      alert("Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        setRecordedAudio(audioUrl);
        
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      alert("Failed to access microphone");
    }
  };

  const saveAudioRecording = async () => {
    if (!recordedAudio) return;

    try {
      const response = await fetch(recordedAudio);
      const blob = await response.blob();
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({
        ...prev,
        voice_notes: [...prev.voice_notes, file_url]
      }));
      
      setRecordedAudio(null);
      alert("Voice note saved!");
    } catch (error) {
      alert("Failed to save voice note");
    }
  };

  const startVideoRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" }, 
        audio: true 
      });
      
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }
      
      setVideoPreview(stream);
      
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const file = new File([blob], `video-${Date.now()}.webm`, { type: 'video/webm' });
        
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          setFormData(prev => ({
            ...prev,
            media: [...prev.media, { type: 'video', url: file_url }]
          }));
          alert("Video saved!");
        } catch (error) {
          alert("Failed to upload video");
        }
        
        stream.getTracks().forEach(track => track.stop());
        setVideoPreview(null);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setVideoRecording(true);
      
      setTimeout(() => {
        if (recorder.state === 'recording') {
          stopRecording();
        }
      }, 30000);
    } catch (error) {
      alert("Failed to access camera");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      setVideoRecording(false);
      setMediaRecorder(null);
    }
  };

  const getAIAssistance = async () => {
    setAiAssisting(true);
    try {
      const prompt = `You are a maintenance expert assistant helping a security guard write a professional maintenance request. Based on this information, provide:

Maintenance Type: ${formData.maintenance_type}
${formData.maintenance_type_other ? `Specific Type: ${formData.maintenance_type_other}` : ''}
Current Details: ${formData.details}

Please provide:
1. Enhanced professional details with technical terminology
2. Recommended urgency level (critical/high/medium/low) with justification
3. Suggested immediate actions or safety precautions
4. Who should be notified (e.g., "Site Manager, Maintenance Team, Client")`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            enhanced_details: { type: "string" },
            urgency_recommendation: { type: "string" },
            safety_notes: { type: "string" },
            notification_suggestions: { type: "string" }
          }
        }
      });

      setFormData(prev => ({
        ...prev,
        details: prev.details + "\n\n=== AI ENHANCEMENT ===\n" + response.enhanced_details + "\n\nUrgency: " + response.urgency_recommendation + "\n\nSafety: " + response.safety_notes,
        who_notified: response.notification_suggestions
      }));
    } catch (error) {
      alert("AI assistance failed: " + error.message);
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
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-800 border border-slate-700 my-8 mx-4 rounded-lg">
        <div className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 rounded-t-lg">
          <div className="flex items-center justify-between p-4">
            <h2 className="text-white text-xl font-bold">Maintenance Request</h2>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={getAIAssistance}
                disabled={aiAssisting || !formData.maintenance_type}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                {aiAssisting ? "AI Assisting..." : "AI Assist"}
              </Button>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5 text-white" />
              </Button>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-sm text-slate-400 mb-2 block">Maintenance Type *</label>
            <select
              value={formData.maintenance_type}
              onChange={(e) => setFormData({ ...formData, maintenance_type: e.target.value })}
              className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-md p-2"
              required
            >
              <option value="">Select maintenance type...</option>
              {maintenanceCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">If Other, What Type:</label>
            <Input
              value={formData.maintenance_type_other}
              onChange={(e) => setFormData({ ...formData, maintenance_type_other: e.target.value })}
              placeholder="Specify if 'Other'"
              className="bg-slate-900/50 border-slate-700 text-white"
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Details *</label>
            <Textarea
              value={formData.details}
              onChange={(e) => setFormData({ ...formData, details: e.target.value })}
              className="bg-slate-900/50 border-slate-700 text-white h-32"
              required
              placeholder="Detailed description of the maintenance issue..."
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Who has been notified:</label>
            <Input
              value={formData.who_notified}
              onChange={(e) => setFormData({ ...formData, who_notified: e.target.value })}
              placeholder="e.g., Site Manager, Maintenance Team"
              className="bg-slate-900/50 border-slate-700 text-white"
            />
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Email Client:</label>
            <select
              value={formData.email_client}
              onChange={(e) => setFormData({ ...formData, email_client: e.target.value })}
              className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-md p-2"
            >
              <option value="YES">YES</option>
              <option value="NO">NO</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Photos</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotoCapture}
              className="hidden"
              id="photo-capture"
            />
            <label htmlFor="photo-capture">
              <Button type="button" className="w-full bg-sky-600 hover:bg-sky-700" asChild>
                <div>
                  <Camera className="w-4 h-4 mr-2" />
                  {uploading ? "Uploading..." : "Take Photo with Camera"}
                </div>
              </Button>
            </label>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Upload Media</label>
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload">
              <Button type="button" variant="outline" className="w-full border-slate-700" asChild>
                <div>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Photos/Videos from Gallery
                </div>
              </Button>
            </label>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Record Video (max 30 seconds)</label>
            {videoRecording && videoPreview && (
              <div className="mb-2 relative">
                <video
                  ref={videoPreviewRef}
                  className="w-full h-48 bg-black rounded-lg"
                  playsInline
                  muted
                />
                <div className="absolute top-2 right-2 bg-rose-600 px-3 py-1 rounded-full flex items-center gap-2">
                  <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                  <span className="text-white text-sm font-bold">REC</span>
                </div>
              </div>
            )}
            <Button
              type="button"
              onClick={videoRecording ? stopRecording : startVideoRecording}
              className={`w-full ${videoRecording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
            >
              {videoRecording ? (
                <>
                  <StopCircle className="w-5 h-5 mr-2 animate-pulse" />
                  Stop Recording Video
                </>
              ) : (
                <>
                  <Video className="w-5 h-5 mr-2" />
                  Record Video
                </>
              )}
            </Button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">Voice Notes</label>
            {recordedAudio && (
              <div className="mb-2 p-3 bg-slate-900/50 rounded-lg border border-emerald-500/20">
                <audio src={recordedAudio} controls className="w-full mb-2" />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveAudioRecording}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  >
                    Save Voice Note
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setRecordedAudio(null)}
                    className="border-slate-600"
                  >
                    Discard
                  </Button>
                </div>
              </div>
            )}
            {!recordedAudio && (
              <Button
                type="button"
                onClick={recording ? stopRecording : startAudioRecording}
                className={`w-full ${recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {recording ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                      <Mic className="w-5 h-5" />
                      <span>Recording... Tap to Stop</span>
                    </div>
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5 mr-2" />
                    Record Voice Note
                  </>
                )}
              </Button>
            )}
            {formData.voice_notes.length > 0 && (
              <p className="text-sm text-emerald-400 mt-2">
                ✓ {formData.voice_notes.length} voice note(s) saved
              </p>
            )}
          </div>

          {formData.media.length > 0 && (
            <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
              <p className="text-sm text-slate-400 mb-2">Media Attached:</p>
              <div className="flex gap-2 overflow-x-auto">
                {formData.media.map((media, idx) => (
                  <div key={idx} className="relative flex-shrink-0">
                    {media.type === 'video' ? (
                      <video src={media.url} className="h-20 w-20 object-cover rounded" />
                    ) : (
                      <img src={media.url} alt="Maintenance" className="h-20 w-20 object-cover rounded" />
                    )}
                    <span className="absolute top-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                      {media.type === 'video' ? '📹' : '📷'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          <div className="flex gap-3 pt-4 sticky bottom-0 bg-slate-800 pb-4 -mx-6 px-6 border-t border-slate-700">
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
      </div>
    </div>
  );
}