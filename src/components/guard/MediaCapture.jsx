import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Camera, Video, Mic, X, Loader2, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MediaCapture({ media = [], onMediaUpdate, title = "ATTACHMENTS" }) {
  const [recording, setRecording] = useState(null);
  const [uploading, setUploading] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const videoPreviewRef = useRef(null);

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files);
    setUploading(true);
    
    for (const file of files) {
      try {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        onMediaUpdate([...media, { type: "photo", url: file_url }]);
      } catch (error) {
        alert("Failed to upload photo: " + error.message);
      }
    }
    
    setUploading(false);
  };

  const startRecording = async (type) => {
    try {
      const constraints = type === 'video' 
        ? { video: { facingMode: 'environment' }, audio: true }
        : { audio: true };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      if (type === 'video' && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.play();
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: type === 'video' ? 'video/webm' : 'audio/webm'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: type === 'video' ? 'video/webm' : 'audio/webm'
        });
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = null;
        }

        // Upload the recording
        setUploading(true);
        try {
          const file = new File([blob], `${type}-${Date.now()}.webm`, {
            type: blob.type
          });
          
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          onMediaUpdate([...media, { type, url: file_url }]);
        } catch (error) {
          alert(`Failed to upload ${type}: ` + error.message);
        } finally {
          setUploading(false);
          setRecording(null);
        }
      };

      mediaRecorder.start();
      setRecording(type);
    } catch (error) {
      alert(`Failed to start ${type} recording: ` + error.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const removeMedia = (index) => {
    const newMedia = media.filter((_, i) => i !== index);
    onMediaUpdate(newMedia);
  };

  const photos = media.filter(m => m.type === 'photo');
  const videos = media.filter(m => m.type === 'video');
  const audios = media.filter(m => m.type === 'audio');

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center justify-between">
          <span>{title}</span>
          <span className="text-sm text-slate-400">{media.length} item(s)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Media Capture Buttons */}
        {!recording && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
                id="photo-input"
              />
              <label htmlFor="photo-input">
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-4 text-center cursor-pointer hover:border-sky-500 transition-colors">
                  <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-xs text-slate-400">Photo</p>
                </div>
              </label>
            </div>

            <button
              onClick={() => startRecording('video')}
              disabled={uploading}
              className="border-2 border-dashed border-slate-600 rounded-lg p-4 text-center hover:border-sky-500 transition-colors"
            >
              <Video className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Video</p>
            </button>

            <button
              onClick={() => startRecording('audio')}
              disabled={uploading}
              className="border-2 border-dashed border-slate-600 rounded-lg p-4 text-center hover:border-sky-500 transition-colors"
            >
              <Mic className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-400">Voice</p>
            </button>
          </div>
        )}

        {/* Recording UI */}
        {recording && (
          <div className="bg-rose-900/20 border-2 border-rose-500 rounded-lg p-6">
            {recording === 'video' && (
              <video
                ref={videoPreviewRef}
                className="w-full rounded-lg mb-4 bg-black"
                playsInline
                muted
              />
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {recording === 'video' ? <Video className="w-6 h-6 text-rose-400 animate-pulse" /> : <Mic className="w-6 h-6 text-rose-400 animate-pulse" />}
                <span className="text-white font-semibold">
                  Recording {recording === 'video' ? 'Video' : 'Audio'}...
                </span>
              </div>
              <Button
                onClick={stopRecording}
                className="bg-rose-600 hover:bg-rose-700"
              >
                <X className="w-4 h-4 mr-2" />
                Stop & Save
              </Button>
            </div>
          </div>
        )}

        {/* Uploading Indicator */}
        {uploading && (
          <div className="flex items-center justify-center gap-3 p-4 bg-sky-900/20 border border-sky-500 rounded-lg">
            <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
            <span className="text-sky-400">Uploading...</span>
          </div>
        )}

        {/* Media Preview */}
        {photos.length > 0 && (
          <div>
            <h4 className="text-white font-semibold mb-2">Photos ({photos.length})</h4>
            <div className="grid grid-cols-1 gap-3">
              {photos.map((item, index) => (
                <div key={index} className="relative group">
                  <img
                    src={item.url}
                    alt={`Photo ${index + 1}`}
                    className="w-full h-auto max-h-96 object-contain bg-slate-900 rounded border border-slate-700"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMedia(media.indexOf(item))}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {videos.length > 0 && (
          <div>
            <h4 className="text-white font-semibold mb-2">Videos ({videos.length})</h4>
            <div className="space-y-3">
              {videos.map((item, index) => (
                <div key={index} className="relative group">
                  <video
                    src={item.url}
                    controls
                    className="w-full rounded border border-slate-700 bg-slate-900"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMedia(media.indexOf(item))}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {audios.length > 0 && (
          <div>
            <h4 className="text-white font-semibold mb-2">Voice Notes ({audios.length})</h4>
            <div className="space-y-3">
              {audios.map((item, index) => (
                <div key={index} className="relative bg-slate-900 rounded-lg p-4 border border-slate-700 group">
                  <audio
                    src={item.url}
                    controls
                    className="w-full mb-2"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => removeMedia(media.indexOf(item))}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <p className="text-xs text-slate-400">Voice note #{index + 1}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}