import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Settings, 
  Plus, 
  Trash2, 
  Save,
  AlertTriangle,
  Wrench,
  Shield,
  Package,
  Bell
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Configuration() {
  // Incident Categories
  const [incidentCategories, setIncidentCategories] = useState([
    { id: 1, value: "fire", label: "Fire", color: "rose" },
    { id: 2, value: "theft", label: "Theft", color: "orange" },
    { id: 3, value: "vandalism", label: "Vandalism", color: "amber" },
    { id: 4, value: "medical", label: "Medical Emergency", color: "rose" },
    { id: 5, value: "trespassing", label: "Trespassing", color: "yellow" },
    { id: 6, value: "suspicious_activity", label: "Suspicious Activity", color: "amber" },
    { id: 7, value: "equipment_failure", label: "Equipment Failure", color: "blue" },
    { id: 8, value: "safety_hazard", label: "Safety Hazard", color: "orange" },
    { id: 9, value: "other", label: "Other", color: "slate" }
  ]);
  const [newIncidentCategory, setNewIncidentCategory] = useState("");

  // Maintenance Categories
  const [maintenanceCategories, setMaintenanceCategories] = useState([
    { id: 1, value: "lighting", label: "Lighting", icon: "💡" },
    { id: 2, value: "locks", label: "Locks & Keys", icon: "🔐" },
    { id: 3, value: "fencing", label: "Fencing", icon: "🚧" },
    { id: 4, value: "gate", label: "Gate/Barrier", icon: "🚪" },
    { id: 5, value: "alarm_system", label: "Alarm System", icon: "🚨" },
    { id: 6, value: "camera", label: "Camera/CCTV", icon: "📹" },
    { id: 7, value: "plumbing", label: "Plumbing", icon: "🚰" },
    { id: 8, value: "electrical", label: "Electrical", icon: "⚡" },
    { id: 9, value: "structural", label: "Structural", icon: "🏗️" },
    { id: 10, value: "other", label: "Other", icon: "🔧" }
  ]);
  const [newMaintenanceCategory, setNewMaintenanceCategory] = useState("");

  // Alarm Types
  const [alarmTypes, setAlarmTypes] = useState([
    { id: 1, value: "burglary", label: "Burglary", priority: "critical" },
    { id: 2, value: "panic", label: "Panic Button", priority: "critical" },
    { id: 3, value: "medical", label: "Medical Emergency", priority: "critical" },
    { id: 4, value: "fire", label: "Fire Alarm", priority: "critical" },
    { id: 5, value: "armed_robbery", label: "Armed Robbery", priority: "critical" },
    { id: 6, value: "suspicious_activity", label: "Suspicious Activity", priority: "high" },
    { id: 7, value: "false_alarm", label: "False Alarm", priority: "low" },
    { id: 8, value: "general", label: "General", priority: "medium" }
  ]);
  const [newAlarmType, setNewAlarmType] = useState("");

  // Asset Categories
  const [assetCategories, setAssetCategories] = useState([
    { id: 1, value: "vehicle", label: "Vehicle", icon: "🚗" },
    { id: 2, value: "equipment", label: "Equipment", icon: "🔧" },
    { id: 3, value: "electronics", label: "Electronics", icon: "📱" },
    { id: 4, value: "furniture", label: "Furniture", icon: "🪑" },
    { id: 5, value: "tools", label: "Tools", icon: "🔨" },
    { id: 6, value: "safety_gear", label: "Safety Gear", icon: "🦺" },
    { id: 7, value: "other", label: "Other", icon: "📦" }
  ]);
  const [newAssetCategory, setNewAssetCategory] = useState("");

  // Priority Levels
  const [priorityLevels] = useState([
    { value: "critical", label: "Critical", color: "rose", description: "Immediate response required" },
    { value: "high", label: "High", color: "orange", description: "Urgent attention needed" },
    { value: "medium", label: "Medium", color: "amber", description: "Normal priority" },
    { value: "low", label: "Low", color: "sky", description: "Can be scheduled" }
  ]);

  const handleAddCategory = (type) => {
    let newItem, setter, value;
    
    switch(type) {
      case "incident":
        value = newIncidentCategory.trim();
        if (!value) {
          alert("Please enter a category name");
          return;
        }
        newItem = {
          id: Date.now(),
          value: value.toLowerCase().replace(/\s+/g, '_'),
          label: value,
          color: "sky"
        };
        setter = setIncidentCategories;
        setNewIncidentCategory("");
        break;
      case "maintenance":
        value = newMaintenanceCategory.trim();
        if (!value) {
          alert("Please enter a category name");
          return;
        }
        newItem = {
          id: Date.now(),
          value: value.toLowerCase().replace(/\s+/g, '_'),
          label: value,
          icon: "🔧"
        };
        setter = setMaintenanceCategories;
        setNewMaintenanceCategory("");
        break;
      case "alarm":
        value = newAlarmType.trim();
        if (!value) {
          alert("Please enter an alarm type");
          return;
        }
        newItem = {
          id: Date.now(),
          value: value.toLowerCase().replace(/\s+/g, '_'),
          label: value,
          priority: "medium"
        };
        setter = setAlarmTypes;
        setNewAlarmType("");
        break;
      case "asset":
        value = newAssetCategory.trim();
        if (!value) {
          alert("Please enter a category name");
          return;
        }
        newItem = {
          id: Date.now(),
          value: value.toLowerCase().replace(/\s+/g, '_'),
          label: value,
          icon: "📦"
        };
        setter = setAssetCategories;
        setNewAssetCategory("");
        break;
      default:
        return;
    }

    setter(prev => [...prev, newItem]);
    alert(`✅ ${newItem.label} added successfully!`);
  };

  const handleRemoveCategory = (type, id) => {
    switch(type) {
      case "incident":
        setIncidentCategories(prev => prev.filter(item => item.id !== id));
        break;
      case "maintenance":
        setMaintenanceCategories(prev => prev.filter(item => item.id !== id));
        break;
      case "alarm":
        setAlarmTypes(prev => prev.filter(item => item.id !== id));
        break;
      case "asset":
        setAssetCategories(prev => prev.filter(item => item.id !== id));
        break;
    }
  };

  const handleSaveConfiguration = () => {
    // In a real implementation, save to database or configuration entity
    alert("Configuration saved successfully! (This would save to database in production)");
  };

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
            <Settings className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">System Configuration</h1>
            <p className="text-slate-400">Manage dropdown lists and system settings</p>
          </div>
        </div>
        <Button
          onClick={handleSaveConfiguration}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
        >
          <Save className="w-5 h-5 mr-2" />
          Save All Changes
        </Button>
      </div>

      {/* Info Banner */}
      <Card className="bg-sky-500/10 border-sky-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Settings className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sky-400 font-semibold mb-1">Configuration Management</h3>
              <p className="text-sm text-slate-300">
                Customize dropdown options for incidents, maintenance requests, alarms, and assets. 
                Changes will be reflected across the entire system.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Configuration Tabs */}
      <Tabs defaultValue="incidents" className="space-y-6">
        <TabsList className="bg-slate-800 border border-slate-700">
          <TabsTrigger value="incidents" className="data-[state=active]:bg-slate-700">
            <AlertTriangle className="w-4 h-4 mr-2" />
            Incidents
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="data-[state=active]:bg-slate-700">
            <Wrench className="w-4 h-4 mr-2" />
            Maintenance
          </TabsTrigger>
          <TabsTrigger value="alarms" className="data-[state=active]:bg-slate-700">
            <Bell className="w-4 h-4 mr-2" />
            Alarms
          </TabsTrigger>
          <TabsTrigger value="assets" className="data-[state=active]:bg-slate-700">
            <Package className="w-4 h-4 mr-2" />
            Assets
          </TabsTrigger>
          <TabsTrigger value="priorities" className="data-[state=active]:bg-slate-700">
            <Shield className="w-4 h-4 mr-2" />
            Priorities
          </TabsTrigger>
        </TabsList>

        {/* Incident Categories */}
        <TabsContent value="incidents">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Incident Categories</CardTitle>
              <p className="text-sm text-slate-400">Manage categories for incident reporting</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Add new incident category..."
                  value={newIncidentCategory}
                  onChange={(e) => setNewIncidentCategory(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCategory('incident')}
                  className="bg-slate-900/50 border-slate-700 text-white"
                />
                <Button 
                  type="button"
                  onClick={() => handleAddCategory('incident')} 
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(Array.isArray(incidentCategories) ? incidentCategories : []).map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className={`bg-${category.color}-500`}>
                        {category.label}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveCategory('incident', category.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maintenance Categories */}
        <TabsContent value="maintenance">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Maintenance Categories</CardTitle>
              <p className="text-sm text-slate-400">Manage categories for maintenance requests</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Add new maintenance category..."
                  value={newMaintenanceCategory}
                  onChange={(e) => setNewMaintenanceCategory(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCategory('maintenance')}
                  className="bg-slate-900/50 border-slate-700 text-white"
                />
                <Button 
                  type="button"
                  onClick={() => handleAddCategory('maintenance')} 
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(Array.isArray(maintenanceCategories) ? maintenanceCategories : []).map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{category.icon}</span>
                      <span className="text-white font-medium">{category.label}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveCategory('maintenance', category.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alarm Types */}
        <TabsContent value="alarms">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Alarm Types</CardTitle>
              <p className="text-sm text-slate-400">Manage alarm categories for armed response</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Add new alarm type..."
                  value={newAlarmType}
                  onChange={(e) => setNewAlarmType(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCategory('alarm')}
                  className="bg-slate-900/50 border-slate-700 text-white"
                />
                <Button 
                  type="button"
                  onClick={() => handleAddCategory('alarm')} 
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {(Array.isArray(alarmTypes) ? alarmTypes : []).map((alarm) => (
                  <div
                    key={alarm.id}
                    className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-center gap-3">
                      <Bell className="w-4 h-4 text-rose-400" />
                      <div>
                        <p className="text-white font-medium">{alarm.label}</p>
                        <Badge className={`text-xs ${
                          alarm.priority === 'critical' ? 'bg-rose-500' :
                          alarm.priority === 'high' ? 'bg-orange-500' :
                          alarm.priority === 'medium' ? 'bg-amber-500' :
                          'bg-sky-500'
                        }`}>
                          {alarm.priority}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveCategory('alarm', alarm.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Asset Categories */}
        <TabsContent value="assets">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Asset Categories</CardTitle>
              <p className="text-sm text-slate-400">Manage categories for asset management</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Add new asset category..."
                  value={newAssetCategory}
                  onChange={(e) => setNewAssetCategory(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddCategory('asset')}
                  className="bg-slate-900/50 border-slate-700 text-white"
                />
                <Button 
                  type="button"
                  onClick={() => handleAddCategory('asset')} 
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </Button>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                {(Array.isArray(assetCategories) ? assetCategories : []).map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{category.icon}</span>
                      <span className="text-white font-medium">{category.label}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveCategory('asset', category.id)}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Priority Levels */}
        <TabsContent value="priorities">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Priority Levels</CardTitle>
              <p className="text-sm text-slate-400">System-wide priority levels (read-only)</p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {(Array.isArray(priorityLevels) ? priorityLevels : []).map((priority) => (
                  <div
                    key={priority.value}
                    className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg border border-slate-700"
                  >
                    <div className="flex items-center gap-4">
                      <Badge className={`bg-${priority.color}-500 text-white px-4 py-2`}>
                        {priority.label}
                      </Badge>
                      <p className="text-slate-400">{priority.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}