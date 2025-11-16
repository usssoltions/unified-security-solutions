import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, CheckSquare, X } from "lucide-react";
import ChecklistTemplateForm from "../components/patrol/ChecklistTemplateForm";

export default function PatrolChecklists() {
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ["checklistTemplates"],
    queryFn: async () => {
      return await base44.entities.ChecklistTemplate.filter({ status: "active" });
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await base44.entities.ChecklistTemplate.update(id, { status: "inactive" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["checklistTemplates"]);
    }
  });

  const getSiteName = (siteId) => {
    const site = sites.find(s => s.id === siteId);
    return site?.name || "All Sites";
  };

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Patrol Checklists</h1>
            <p className="text-slate-400">Create and manage site patrol checklists</p>
          </div>
          <Button
            onClick={() => {
              setEditingTemplate(null);
              setShowForm(true);
            }}
            className="bg-sky-600 hover:bg-sky-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            New Checklist
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((template) => (
            <Card key={template.id} className="bg-slate-800 border-slate-700">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-white text-lg">{template.name}</CardTitle>
                    <p className="text-sm text-slate-400 mt-1">
                      {getSiteName(template.site_id)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setEditingTemplate(template);
                        setShowForm(true);
                      }}
                      className="text-sky-400"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(template.id)}
                      className="text-rose-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Items:</span>
                    <span className="text-white font-semibold">{template.items?.length || 0}</span>
                  </div>
                  {template.checkpoint_id && (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                      Checkpoint Linked
                    </Badge>
                  )}
                  {template.requires_signature && (
                    <Badge variant="outline" className="border-sky-500 text-sky-400">
                      Signature Required
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {templates.length === 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-12 text-center">
              <CheckSquare className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white font-semibold mb-2">No Checklists Yet</h3>
              <p className="text-slate-400 mb-4">Create your first patrol checklist to get started</p>
              <Button
                onClick={() => setShowForm(true)}
                className="bg-sky-600 hover:bg-sky-700"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Checklist
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {showForm && (
        <ChecklistTemplateForm
          template={editingTemplate}
          sites={sites}
          onClose={() => {
            setShowForm(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setEditingTemplate(null);
            queryClient.invalidateQueries(["checklistTemplates"]);
          }}
        />
      )}
    </div>
  );
}