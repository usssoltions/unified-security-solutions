import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Plus, Loader2, BarChart3 } from "lucide-react";

export default function CustomReportBuilder({ onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    chart_type: "table"
  });
  const [selectedEntities, setSelectedEntities] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const entities = [
    { value: "Incident", label: "Incidents" },
    { value: "Shift", label: "Shifts" },
    { value: "ChecklistCompletion", label: "Checklists" },
    { value: "MaintenanceRequest", label: "Maintenance" },
    { value: "PatrolLog", label: "Patrol Logs" },
    { value: "StayAwakeLog", label: "Stay Awake Logs" },
    { value: "Asset", label: "Assets" }
  ];

  const metricTypes = [
    { value: "count", label: "Count" },
    { value: "sum", label: "Sum" },
    { value: "average", label: "Average" },
    { value: "min", label: "Minimum" },
    { value: "max", label: "Maximum" }
  ];

  const chartTypes = [
    { value: "table", label: "Table" },
    { value: "bar", label: "Bar Chart" },
    { value: "line", label: "Line Chart" },
    { value: "pie", label: "Pie Chart" },
    { value: "area", label: "Area Chart" }
  ];

  const addMetric = () => {
    setMetrics([...metrics, { name: "", type: "count", field: "" }]);
  };

  const removeMetric = (index) => {
    setMetrics(metrics.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!formData.name || selectedEntities.length === 0) {
      alert("Please fill in required fields");
      return;
    }

    setSubmitting(true);

    try {
      await base44.entities.CustomReport.create({
        ...formData,
        data_sources: selectedEntities.map(entity => ({
          entity,
          fields: [],
          filters: {}
        })),
        metrics,
        grouping: [],
        status: "active"
      });

      onClose();
    } catch (error) {
      alert("Failed to create custom report");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-3xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">Custom Report Builder</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Report Name <span className="text-rose-400">*</span>
              </label>
              <Input
                placeholder="e.g., Weekly Incident Summary"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Description</label>
              <Textarea
                placeholder="What does this report show?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Data Sources <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3 p-4 bg-slate-900/50 rounded-lg">
                {entities.map((entity) => (
                  <label key={entity.value} className="flex items-center gap-2 text-white cursor-pointer">
                    <Checkbox
                      checked={selectedEntities.includes(entity.value)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedEntities([...selectedEntities, entity.value]);
                        } else {
                          setSelectedEntities(selectedEntities.filter(e => e !== entity.value));
                        }
                      }}
                    />
                    <span className="text-sm">{entity.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-slate-300 font-medium">Metrics</label>
                <Button size="sm" onClick={addMetric} variant="outline" className="border-slate-600">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Metric
                </Button>
              </div>
              <div className="space-y-3">
                {metrics.map((metric, index) => (
                  <div key={index} className="flex gap-3 p-3 bg-slate-900/50 rounded-lg">
                    <Input
                      placeholder="Metric name"
                      value={metric.name}
                      onChange={(e) => {
                        const newMetrics = [...metrics];
                        newMetrics[index].name = e.target.value;
                        setMetrics(newMetrics);
                      }}
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                    <Select
                      value={metric.type}
                      onValueChange={(value) => {
                        const newMetrics = [...metrics];
                        newMetrics[index].type = value;
                        setMetrics(newMetrics);
                      }}
                    >
                      <SelectTrigger className="w-32 bg-slate-800 border-slate-700 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {metricTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeMetric(index)}
                      className="text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">Visualization</label>
              <Select
                value={formData.chart_type}
                onValueChange={(value) => setFormData({ ...formData, chart_type: value })}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chartTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-purple-500 to-purple-600"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Report"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}