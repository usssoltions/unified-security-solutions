import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Clock, Camera, Upload, Send, X } from "lucide-react";
import SignaturePad from "../components/guard/SignaturePad";

export default function GuardPatrolChecklist() {
  const [user, setUser] = useState(null);
  const [activePatrol, setActivePatrol] = useState(null);
  const [completedItems, setCompletedItems] = useState({});
  const [itemPhotos, setItemPhotos] = useState({});
  const [uploading, setUploading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [signature, setSignature] = useState(null);
  const [notes, setNotes] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    const loadUser = async () => {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    };
    loadUser();
  }, []);

  const { data: activeShift } = useQuery({
    queryKey: ["activeShift", user?.id],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      return shifts[0] || null;
    },
    enabled: !!user
  });

  const { data: templates = [] } = useQuery({
    queryKey: ["availableChecklists", activeShift?.site_id],
    queryFn: async () => {
      if (!activeShift) return [];
      return await base44.entities.ChecklistTemplate.filter({
        $or: [
          { site_id: activeShift.site_id },
          { site_id: "all" }
        ],
        status: "active"
      });
    },
    enabled: !!activeShift
  });

  const completeMutation = useMutation({
    mutationFn: async (data) => {
      const completion = await base44.entities.ChecklistCompletion.create(data);

      await base44.entities.Alert.create({
        type: "system",
        priority: "low",
        title: "Patrol Checklist Completed",
        message: `${user.full_name} completed "${data.template_name}" at ${activeShift.site_name}`,
        guard_id: user.id,
        guard_name: user.full_name,
        status: "active",
        metadata: { completion_id: completion.id }
      });

      return completion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["completedPatrols"]);
      setActivePatrol(null);
      setCompletedItems({});
      setItemPhotos({});
      setSignature(null);
      setNotes("");
      alert("Patrol checklist submitted successfully!");
    }
  });

  const startPatrol = (template) => {
    setActivePatrol({
      ...template,
      started_at: new Date().toISOString()
    });
  };

  const handleItemToggle = (itemId, checked) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: {
        item_id: itemId,
        checked,
        value: checked ? "✓" : "",
        photo_url: itemPhotos[itemId] || ""
      }
    }));
  };

  const handleItemText = (itemId, value) => {
    setCompletedItems(prev => ({
      ...prev,
      [itemId]: {
        item_id: itemId,
        checked: true,
        value,
        photo_url: itemPhotos[itemId] || ""
      }
    }));
  };

  const handlePhotoUpload = async (itemId, file) => {
    setUploading(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setItemPhotos(prev => ({ ...prev, [itemId]: file_url }));
      setCompletedItems(prev => ({
        ...prev,
        [itemId]: {
          ...prev[itemId],
          item_id: itemId,
          checked: true,
          photo_url: file_url
        }
      }));
    } catch (error) {
      alert("Failed to upload photo");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = () => {
    const requiredItems = activePatrol.items.filter(item => item.required);
    const allRequiredCompleted = requiredItems.every(item => 
      completedItems[item.id]?.checked || 
      completedItems[item.id]?.value ||
      completedItems[item.id]?.photo_url
    );

    if (!allRequiredCompleted) {
      alert("Please complete all required items");
      return;
    }

    if (activePatrol.requires_signature && !signature) {
      setShowSignature(true);
      return;
    }

    const timeSpent = Math.round((new Date() - new Date(activePatrol.started_at)) / 60000);

    completeMutation.mutate({
      template_id: activePatrol.id,
      template_name: activePatrol.name,
      guard_id: user.id,
      guard_name: user.full_name,
      shift_id: activeShift.id,
      site_id: activeShift.site_id,
      checkpoint_id: activePatrol.checkpoint_id,
      completed_items: Object.values(completedItems),
      signature: signature ? { data_url: signature, timestamp: new Date().toISOString(), method: "digital" } : null,
      completed_at: new Date().toISOString(),
      status: "completed",
      notes,
      time_spent_minutes: timeSpent
    });
  };

  if (showSignature) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50">
        <div className="min-h-screen p-4">
          <SignaturePad
            onSave={(sig) => {
              setSignature(sig);
              setShowSignature(false);
              handleSubmit();
            }}
            onCancel={() => setShowSignature(false)}
          />
        </div>
      </div>
    );
  }

  if (!user || !activeShift) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (activePatrol) {
    const progress = activePatrol.items.length > 0
      ? (Object.keys(completedItems).length / activePatrol.items.length) * 100
      : 0;

    return (
      <div className="min-h-screen p-4 pb-24 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-2xl mx-auto space-y-6">
          <Card className="bg-slate-800 border-sky-500">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white">{activePatrol.name}</CardTitle>
                  <p className="text-sm text-slate-400 mt-1">{activeShift.site_name}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setActivePatrol(null)}
                  className="text-slate-400"
                >
                  <X />
                </Button>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2 text-sm">
                  <span className="text-slate-400">Progress</span>
                  <span className="text-white font-semibold">
                    {Object.keys(completedItems).length} / {activePatrol.items.length}
                  </span>
                </div>
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </CardHeader>
          </Card>

          <div className="space-y-3">
            {activePatrol.items.map((item) => (
              <Card key={item.id} className="bg-slate-800 border-slate-700">
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      {item.type === "checkbox" && (
                        <input
                          type="checkbox"
                          checked={completedItems[item.id]?.checked || false}
                          onChange={(e) => handleItemToggle(item.id, e.target.checked)}
                          className="w-5 h-5 mt-1"
                        />
                      )}
                      <div className="flex-1">
                        <p className="text-white">{item.text}</p>
                        {item.required && (
                          <Badge variant="outline" className="border-rose-500 text-rose-400 mt-1">
                            Required
                          </Badge>
                        )}
                      </div>
                    </div>

                    {item.type === "text" && (
                      <Textarea
                        value={completedItems[item.id]?.value || ""}
                        onChange={(e) => handleItemText(item.id, e.target.value)}
                        placeholder="Enter details..."
                        className="bg-slate-900 border-slate-700 text-white"
                      />
                    )}

                    {(item.type === "photo" || itemPhotos[item.id]) && (
                      <div>
                        {itemPhotos[item.id] ? (
                          <img
                            src={itemPhotos[item.id]}
                            alt="Evidence"
                            className="w-full h-48 object-cover rounded-lg"
                          />
                        ) : (
                          <div>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => {
                                if (e.target.files[0]) {
                                  handlePhotoUpload(item.id, e.target.files[0]);
                                }
                              }}
                              className="hidden"
                              id={`photo-${item.id}`}
                            />
                            <label htmlFor={`photo-${item.id}`}>
                              <Button
                                type="button"
                                variant="outline"
                                className="w-full border-slate-700"
                                asChild
                              >
                                <div>
                                  <Camera className="w-4 h-4 mr-2" />
                                  {uploading ? "Uploading..." : "Take Photo"}
                                </div>
                              </Button>
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="pt-4">
              <label className="text-sm text-slate-400 block mb-2">Additional Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional observations or comments..."
                className="bg-slate-900 border-slate-700 text-white"
              />
            </CardContent>
          </Card>

          <Button
            onClick={handleSubmit}
            disabled={completeMutation.isPending}
            className="w-full bg-sky-600 hover:bg-sky-700 h-14 text-lg"
          >
            <Send className="w-5 h-5 mr-2" />
            {completeMutation.isPending ? "Submitting..." : "Submit Patrol"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pb-24 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Patrol Checklists</h1>
          <p className="text-slate-400">Start a patrol checklist for your site</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {templates.map((template) => (
            <Card key={template.id} className="bg-slate-800 border-slate-700 hover:border-sky-500 transition-colors">
              <CardHeader>
                <CardTitle className="text-white text-lg">{template.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckSquare className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-300">{template.items?.length || 0} items</span>
                </div>
                {template.requires_signature && (
                  <Badge variant="outline" className="border-sky-500 text-sky-400">
                    Signature Required
                  </Badge>
                )}
                <Button
                  onClick={() => startPatrol(template)}
                  className="w-full bg-sky-600 hover:bg-sky-700"
                >
                  Start Patrol
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {templates.length === 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-12 text-center">
              <CheckSquare className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white font-semibold mb-2">No Checklists Available</h3>
              <p className="text-slate-400">No patrol checklists have been assigned to this site yet</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}