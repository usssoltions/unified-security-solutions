import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Upload, Mic, StopCircle, Sparkles, PenTool, Loader2, Send, Video, Play } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SignaturePad from "./SignaturePad";
import { useMutation, useQueryClient } from "@tanstack/react-query";

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
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    onMutate: async (newRequest) => {
      await queryClient.cancelQueries({ queryKey: ['maintenanceRequests'] });
      const previous = queryClient.getQueryData(['maintenanceRequests']);

      queryClient.setQueryData(['maintenanceRequests'], (old = []) => [
        {
          id: `temp-${Date.now()}`,
          title: `Maintenance: ${newRequest.maintenance_type}`,
          description: 'Submitting...',
          category: 'other',
          urgency: 'medium',
          status: 'reported',
          guard_name: user.full_name,
          site_name: shift?.site_name || '',
          reported_at: new Date().toISOString(),
          created_date: new Date().toISOString()
        },
        ...old
      ]);

      return { previous };
    },
    mutationFn: async (data) => {
      const reportContent = `
MAINTENANCE REQUEST
Time Zone: Africa/Johannesburg

DATE, CLIENT, & SITE
Date Entered: ${new Date().toLocaleString()}
Client: ${shift?.client_name || 'N/A'}
Site: ${data.site_name}

OFFICER INFORMATION
Officer Name: ${data.guard_name}

MAINTENANCE REQUEST
Maintenance Type: ${data.maintenance_type}
${data.maintenance_type_other ? `If Other, What Type: ${data.maintenance_type_other}` : ''}
Details: ${data.details}

NOTIFICATION
Who has been notified: ${data.who_notified}
Email Client: ${data.email_client}

PHOTOS: ${data.media.filter(m => m.type === 'photo').length} photo(s) attached
MEDIA: ${data.media.filter(m => m.type === 'video').length} video(s) attached
Voice Notes: ${data.voice_notes.length} voice note(s) attached
Officer Signature: Signed
      `.trim();

      const maintenanceRequest = await base44.entities.MaintenanceRequest.create({
        title: `Maintenance: ${data.maintenance_type}`,
        description: reportContent,
        category: "other",
        urgency: "medium",
        guard_id: data.guard_id,
        guard_name: data.guard_name,
        site_id: data.site_id,
        site_name: data.site_name,
        location: data.location,
        reported_at: data.reported_at,
        media: [...data.media, ...data.voice_notes.map(url => ({ type: 'audio', url }))]
      });

      try {
        await base44.functions.invoke('notifyAdminsMaintenance', {
          maintenanceId: maintenanceRequest.id,
          guardName: data.guard_name,
          maintenanceType: data.maintenance_type,
          siteName: data.site_name,
          details: data.details.substring(0, 200),
          location: data.location
        });
      } catch (error) {
        console.error('Failed to send maintenance notification:', error);
      }

      return maintenanceRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenanceRequests'] });
      alert("Maintenance request submitted successfully!");
      onSuccess();
    },
    onError: (error, newRequest, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['maintenanceRequests'], context.previous);
      }
      alert(`Error: ${error.message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenanceRequests'] });
    }
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }
    
    createMutation.mutate(formData);
  };

  const handlePhotoCapture = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        try {
          const result = await base44.integrations.Core.UploadFile({ file });
          if (result && result.file_url) {
            setFormData(prev => ({
              ...prev,
              media: [...prev.media, { type: 'photo', url: result.file_url }]
            }));
          }
        } catch (err) {
          console.error("Upload error:", err);
          alert("Failed to upload photo. Please try again.");
        }
      }
    } catch (error) {
      console.error("Photo capture error:", error);
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
      
      setVideoPreview(stream);
      
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(e => console.log('Video play failed:', e));
      }
      
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
      alert("Failed to access camera: " + error.message);
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
      <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
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
    <div 
      className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto safe-area-top safe-area-bottom"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="min-h-screen p-4 pt-20 pb-32">
        <Card className="w-full max-w-2xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader className="sticky top-0 z-10 bg-slate-800 border-b border-slate-700 rounded-t-lg -mx-6 -mt-6 pt-6 px-6">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-xl font-bold">Maintenance Request</CardTitle>
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
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Maintenance Type *</label>
                <Select
                  value={formData.maintenance_type}
                  onValueChange={(value) => setFormData({ ...formData, maintenance_type: value })}
                  required
                >
                  <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                    <SelectValue placeholder="Select maintenance type..." />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    {maintenanceCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select
                  value={formData.email_client}
                  onValueChange={(value) => setFormData({ ...formData, email_client: value })}
                >
                  <SelectTrigger className="bg-slate-900/50 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    <SelectItem value="YES">YES</SelectItem>
                    <SelectItem value="NO">NO</SelectItem>
                  </SelectContent>
                </Select>
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
                <label className="text-white font-medium block mb-2">Record Video (max 30 seconds)</label>
                {videoRecording && videoPreview && (
                  <div className="mb-2 relative">
                    <video
                      ref={videoPreviewRef}
                      className="w-full h-48 bg-black rounded-lg"
                      playsInline
                      autoPlay
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

              <div className="flex gap-3 pt-6 pb-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-slate-600 h-12"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 bg-amber-600 hover:bg-amber-700 h-12"
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
                      Submit Request
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