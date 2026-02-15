import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, CheckCircle2, Loader2, PenTool } from "lucide-react";
import SignaturePad from "../guard/SignaturePad";

export default function ChecklistForm({ template, checkpoint, shift, user, location, qrCode, onComplete }) {
  const [items, setItems] = useState(
    template.items.map(item => ({
      ...item,
      checked: false,
      value: "",
      photo_url: "",
      photo_metadata: null,
      uploading: false
    }))
  );
  const [signature, setSignature] = useState(null);
  const [showSignature, setShowSignature] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const handlePhotoUpload = async (index, file) => {
    handleItemChange(index, "uploading", true);
    
    try {
      if (!file) {
        throw new Error("No file selected");
      }

      const formData = new FormData();
      formData.append('file', file);

      const result = await base44.functions.invoke('uploadPhotoFile', {}, formData);

      if (!result.data?.file_url) {
        throw new Error(result.data?.error || "Upload failed");
      }

      const file_url = result.data.file_url;
      
      // Create photo metadata
      const photoData = {
        url: file_url,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        location: location ? { lat: location.lat, lng: location.lng } : null,
        checkpoint: checkpoint?.name || "Unknown"
      };
      
      handleItemChange(index, "photo_url", file_url);
      handleItemChange(index, "photo_metadata", photoData);
      handleItemChange(index, "uploading", false);
    } catch (error) {
      console.error("Photo upload error:", error);
      handleItemChange(index, "uploading", false);
      alert("Failed to upload photo");
    }
  };

  const isComplete = () => {
    return items.every(item => {
      if (!item.required) return true;
      if (item.type === "checkbox") return item.checked;
      if (item.type === "text") return item.value.trim().length > 0;
      if (item.type === "photo") return item.photo_url.length > 0;
      return true;
    });
  };

  const handleSubmit = async () => {
    if (!isComplete()) {
      alert("Please complete all required items");
      return;
    }

    if (template.requires_signature && !signature) {
      setShowSignature(true);
      return;
    }

    setLoading(true);

    try {
      await base44.entities.ChecklistCompletion.create({
        template_id: template.id,
        template_name: template.name,
        guard_id: user.id,
        guard_name: user.full_name,
        shift_id: shift.id,
        site_id: checkpoint.site_id,
        checkpoint_id: checkpoint.id,
        qr_code_scanned: qrCode,
        completed_items: items.map(item => ({
          item_id: item.id,
          checked: item.checked,
          value: item.value,
          photo_url: item.photo_url,
          photo_metadata: item.photo_metadata
        })),
        signature: signature ? {
          data_url: signature,
          timestamp: new Date().toISOString(),
          method: "digital"
        } : null,
        location: location,
        completed_at: new Date().toISOString(),
        status: "completed",
        notes: notes
      });

      onComplete();
    } catch (error) {
      alert("Failed to submit checklist");
    } finally {
      setLoading(false);
    }
  };

  if (showSignature && !signature) {
    return (
      <SignaturePad
        onSave={setSignature}
        onCancel={() => setShowSignature(false)}
      />
    );
  }

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-sky-400" />
          {template.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
            <div className="flex items-start gap-3">
              {item.type === "checkbox" && (
                <>
                  <Checkbox
                    checked={item.checked}
                    onCheckedChange={(checked) => handleItemChange(index, "checked", checked)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label className="text-white font-medium">
                      {item.text}
                      {item.required && <span className="text-rose-400 ml-1">*</span>}
                    </label>
                  </div>
                </>
              )}

              {item.type === "text" && (
                <div className="flex-1">
                  <label className="text-white font-medium block mb-2">
                    {item.text}
                    {item.required && <span className="text-rose-400 ml-1">*</span>}
                  </label>
                  <Textarea
                    value={item.value}
                    onChange={(e) => handleItemChange(index, "value", e.target.value)}
                    placeholder="Enter details..."
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                </div>
              )}

              {item.type === "photo" && (
                <div className="flex-1">
                  <label className="text-white font-medium block mb-2">
                    {item.text}
                    {item.required && <span className="text-rose-400 ml-1">*</span>}
                  </label>
                  {item.photo_url ? (
                    <div className="space-y-2">
                      <div className="relative">
                        <img src={item.photo_url} alt="Uploaded" className="w-full h-48 object-cover rounded-lg border border-emerald-500/50 bg-slate-900" />
                        <div className="absolute top-2 left-2 bg-emerald-500 text-white text-xs px-2 py-1 rounded">✓ Uploaded</div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            handleItemChange(index, "photo_url", "");
                            handleItemChange(index, "photo_metadata", null);
                          }}
                          className="absolute top-2 right-2"
                        >
                          Replace
                        </Button>
                      </div>
                      {item.photo_metadata && (
                        <div className="p-3 bg-slate-900/50 rounded border border-slate-700 text-xs space-y-1">
                          <p className="text-slate-300"><span className="text-slate-400">📷 Captured:</span> {item.photo_metadata.timestamp}</p>
                          <p className="text-slate-300"><span className="text-slate-400">📍 Location:</span> {item.photo_metadata.location ? `${item.photo_metadata.location.lat.toFixed(6)}, ${item.photo_metadata.location.lng.toFixed(6)}` : "N/A"}</p>
                          <p className="text-slate-300"><span className="text-slate-400">🎯 Checkpoint:</span> {item.photo_metadata.checkpoint}</p>
                        </div>
                      )}
                    </div>
                  ) : item.uploading ? (
                    <div className="border-2 border-dashed border-sky-500 rounded-lg p-8 text-center bg-sky-500/5">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-400 mx-auto mb-2" />
                      <p className="text-sm text-sky-400 font-medium">Uploading...</p>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => {
                          try {
                            const file = e.target.files?.[0];
                            if (!file) {
                              alert("No file selected");
                              return;
                            }
                            handlePhotoUpload(index, file);
                          } catch (err) {
                            console.error("File selection error:", err);
                            alert("Error selecting file: " + err.message);
                          }
                        }}
                        className="hidden"
                        id={`photo-${index}`}
                        disabled={item.uploading}
                      />
                      <label htmlFor={`photo-${index}`} className={item.uploading ? "pointer-events-none opacity-50" : ""}>
                        <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center cursor-pointer hover:border-sky-500 transition-colors">
                          <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                          <p className="text-sm text-slate-400">Take Photo</p>
                        </div>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        <div>
          <label className="text-white font-medium block mb-2">Additional Notes</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional observations..."
            className="bg-slate-900/50 border-slate-700 text-white"
          />
        </div>

        {template.requires_signature && signature && (
          <div className="p-4 bg-slate-900/50 rounded-lg border border-emerald-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Digital Signature</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSignature(null);
                  setShowSignature(true);
                }}
                className="text-sky-400"
              >
                Re-sign
              </Button>
            </div>
            <img src={signature} alt="Signature" className="h-24 bg-white rounded" />
          </div>
        )}

        <Button
          className="w-full h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
          onClick={handleSubmit}
          disabled={!isComplete() || loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Submitting...
            </>
          ) : template.requires_signature && !signature ? (
            <>
              <PenTool className="w-5 h-5 mr-2" />
              Sign & Submit
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Complete Checklist
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}