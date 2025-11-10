import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Loader2, CheckCircle2, AlertCircle, Zap, LogOut, RefreshCw, Shield } from "lucide-react";

export default function SystemSetup() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [needsRelogin, setNeedsRelogin] = useState(false);
  const [roleStatus, setRoleStatus] = useState(null);

  useEffect(() => {
    checkCurrentRole();
  }, []);

  const addStatus = (message, type = "info") => {
    setStatus(prev => [...prev, { message, type, timestamp: new Date() }]);
  };

  const checkCurrentRole = async () => {
    setChecking(true);
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
      
      // Check BOTH role and role_type
      const hasAdminRole = user.role === 'admin';
      const hasAdminRoleType = user.role_type === 'admin' || user.role_type === 'dispatcher';
      
      if (hasAdminRole && hasAdminRoleType) {
        setRoleStatus({ hasPermission: true, role: user.role_type, bothSet: true });
      } else {
        setRoleStatus({ 
          hasPermission: false, 
          role: user.role_type || 'none',
          builtInRole: user.role || 'user',
          bothSet: false
        });
      }
    } catch (error) {
      console.error("Failed to check role:", error);
    } finally {
      setChecking(false);
    }
  };

  const forceRoleUpdate = async () => {
    setLoading(true);
    setStatus([]);
    
    try {
      // Update BOTH role and role_type fields
      await base44.auth.updateMe({ 
        role: "admin",           // Built-in role field
        role_type: "admin",      // Custom role_type field
        badge_number: "ADMIN-001",
        phone: "+27123456789"
      });
      
      addStatus("✅ Updated role field to 'admin'", "success");
      addStatus("✅ Updated role_type field to 'admin'", "success");
      addStatus("✅ All permissions set correctly", "success");
      addStatus("🔄 Page will refresh in 3 seconds...", "warning");
      
      // Force hard refresh after delay
      setTimeout(() => {
        window.location.href = window.location.href;
      }, 3000);
      
    } catch (error) {
      addStatus(`❌ Error: ${error.message}`, "error");
      console.error("Role update error:", error);
    } finally {
      setLoading(false);
    }
  };

  const setupTestData = async () => {
    setLoading(true);
    setStatus([]);
    setNeedsRelogin(false);
    
    try {
      // Get current user
      const user = await base44.auth.me();
      setCurrentUser(user);
      addStatus(`Logged in as: ${user.full_name} (${user.email})`, "success");
      addStatus(`Current role: ${user.role}`, "info");
      addStatus(`Current role_type: ${user.role_type || 'Not set'}`, "info");

      // Check BOTH permissions
      const hasAdminRole = user.role === 'admin';
      const hasAdminRoleType = user.role_type === 'admin' || user.role_type === 'dispatcher';
      
      if (!hasAdminRole || !hasAdminRoleType) {
        addStatus("❌ Missing required permissions!", "error");
        if (!hasAdminRole) {
          addStatus("   - 'role' field must be 'admin' (currently: " + (user.role || 'not set') + ")", "error");
        }
        if (!hasAdminRoleType) {
          addStatus("   - 'role_type' field must be 'admin' or 'dispatcher' (currently: " + (user.role_type || 'not set') + ")", "error");
        }
        addStatus("Please use 'Force Role to Admin' button first", "warning");
        setLoading(false);
        return;
      }

      addStatus("✅ You have all required permissions", "success");

      // Create Sites
      addStatus("Creating test sites at your location...", "info");
      const sites = await Promise.all([
        base44.entities.Site.create({
          name: "Yzerfontein Security Post",
          address: "131 Atlantic Drive, Yzerfontein, 7351",
          client_name: "Coastal Properties",
          location: { lat: -33.3482, lng: 18.1615 },
          geofence_radius: 200,
          status: "active",
          checkpoints: [
            { id: "cp1", name: "Main Gate", qr_code: "YZER_MAIN_001", location: { lat: -33.3482, lng: 18.1615 } },
            { id: "cp2", name: "Perimeter Fence", qr_code: "YZER_PERI_002", location: { lat: -33.3483, lng: 18.1616 } }
          ]
        }),
        base44.entities.Site.create({
          name: "Beach Front Property",
          address: "45 Beach Road, Yzerfontein, 7351",
          client_name: "Ocean View Estates",
          location: { lat: -33.3490, lng: 18.1620 },
          geofence_radius: 150,
          status: "active",
          checkpoints: [
            { id: "cp3", name: "Beach Access", qr_code: "BEACH_ACC_001", location: { lat: -33.3490, lng: 18.1620 } }
          ]
        }),
        base44.entities.Site.create({
          name: "Town Center Complex",
          address: "Main Street, Yzerfontein, 7351",
          client_name: "Local Business Council",
          location: { lat: -33.3500, lng: 18.1600 },
          geofence_radius: 200,
          status: "active"
        })
      ]);
      addStatus(`✅ Created ${sites.length} sites in Yzerfontein area`, "success");

      // Create Checklist Templates
      addStatus("Creating checklist templates...", "info");
      const templates = await Promise.all([
        base44.entities.ChecklistTemplate.create({
          name: "Main Gate Security Check",
          site_id: sites[0].id,
          checkpoint_id: "cp1",
          items: [
            { id: "i1", text: "Gate locked and secure", required: true, type: "checkbox" },
            { id: "i2", text: "Alarm system armed", required: true, type: "checkbox" },
            { id: "i3", text: "Area clear of obstructions", required: true, type: "checkbox" },
            { id: "i4", text: "Take photo of gate", required: true, type: "photo" }
          ],
          requires_signature: true,
          status: "active"
        }),
        base44.entities.ChecklistTemplate.create({
          name: "Perimeter Patrol",
          site_id: sites[0].id,
          checkpoint_id: "cp2",
          items: [
            { id: "i1", text: "Fence condition check", required: true, type: "checkbox" },
            { id: "i2", text: "Lighting functional", required: true, type: "checkbox" },
            { id: "i3", text: "No unauthorized access", required: true, type: "checkbox" }
          ],
          requires_signature: true,
          status: "active"
        })
      ]);
      addStatus(`✅ Created ${templates.length} checklist templates`, "success");

      // Create Shifts
      addStatus("Creating shifts at 131 Atlantic Drive...", "info");
      const now = new Date();
      const shifts = await Promise.all([
        base44.entities.Shift.create({
          guard_id: user.id,
          guard_name: user.full_name,
          site_id: sites[0].id,
          site_name: sites[0].name,
          start_time: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
          status: "scheduled"
        }),
        base44.entities.Shift.create({
          guard_id: user.id,
          guard_name: user.full_name,
          site_id: sites[1].id,
          site_name: sites[1].name,
          start_time: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now.getTime() + 32 * 60 * 60 * 1000).toISOString(),
          status: "scheduled"
        })
      ]);
      addStatus(`✅ Created ${shifts.length} shifts`, "success");

      // Create Assets
      addStatus("Creating sample assets...", "info");
      await Promise.all([
        base44.entities.Asset.create({
          asset_name: "Patrol Vehicle #1",
          asset_number: "VEH-001",
          category: "vehicle",
          status: "active",
          site_id: sites[0].id,
          site_name: sites[0].name,
          purchase_date: "2023-01-15",
          purchase_cost: 250000,
          current_value: 200000
        }),
        base44.entities.Asset.create({
          asset_name: "Radio Set #12",
          asset_number: "RAD-012",
          category: "electronics",
          status: "active",
          assigned_to: user.id,
          assigned_to_name: user.full_name,
          purchase_date: "2024-03-20",
          purchase_cost: 3500,
          current_value: 3000
        })
      ]);
      addStatus("✅ Created sample assets", "success");

      // Create Incidents
      addStatus("Creating sample incidents...", "info");
      await base44.entities.Incident.create({
        title: "Suspicious Vehicle Near Beach",
        description: "Unidentified vehicle parked near restricted beach access",
        category: "suspicious_activity",
        priority: "medium",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: sites[0].id,
        site_name: sites[0].name,
        location: { lat: -33.3482, lng: 18.1615 },
        reported_at: new Date().toISOString()
      });
      addStatus("✅ Created sample incident", "success");

      // Create Maintenance
      addStatus("Creating sample maintenance...", "info");
      await base44.entities.MaintenanceRequest.create({
        title: "Broken Gate Light",
        description: "Main gate light fixture not working",
        category: "lighting",
        urgency: "medium",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: sites[0].id,
        site_name: sites[0].name,
        reported_at: new Date().toISOString()
      });
      addStatus("✅ Created maintenance request", "success");

      // Create Report Schedule
      addStatus("Creating report schedule...", "info");
      await base44.entities.ReportSchedule.create({
        name: "Daily Morning Report - Yzerfontein",
        report_type: "daily_activity",
        frequency: "daily",
        send_time: "08:00",
        recipients: [user.email],
        sites: sites.map(s => s.id),
        status: "active",
        created_by: user.id
      });
      addStatus("✅ Created automated report schedule", "success");

      addStatus("🎉 SETUP COMPLETE! All test data created.", "success");
      addStatus("📍 Shift location: 131 Atlantic Drive, Yzerfontein", "success");

    } catch (error) {
      addStatus(`❌ Error: ${error.message}`, "error");
      console.error("Setup error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <CardTitle className="text-white text-2xl">System Setup & Test Data</CardTitle>
                <p className="text-slate-400 mt-1">Set up your admin role and create test data</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Current Role Status */}
            <Card className={`${
              roleStatus?.hasPermission 
                ? 'bg-emerald-500/10 border-emerald-500/30' 
                : 'bg-rose-500/10 border-rose-500/30'
            }`}>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <Shield className={`w-8 h-8 ${
                    roleStatus?.hasPermission ? 'text-emerald-400' : 'text-rose-400'
                  }`} />
                  <div className="flex-1">
                    <p className="text-sm text-slate-400">Current Permission Status</p>
                    <p className={`text-lg font-bold ${
                      roleStatus?.hasPermission ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {roleStatus?.hasPermission 
                        ? `✅ Full Admin Access`
                        : `❌ Incomplete Permissions`
                      }
                    </p>
                    {roleStatus && !roleStatus.hasPermission && (
                      <div className="text-xs text-slate-400 mt-1">
                        <p>Built-in role: {roleStatus.builtInRole || 'not set'}</p>
                        <p>Role type: {roleStatus.role || 'not set'}</p>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={checkCurrentRole}
                    disabled={checking}
                    size="sm"
                    variant="outline"
                    className="border-slate-600"
                  >
                    <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Step 1: Force Role Update */}
            {!roleStatus?.hasPermission && (
              <Card className="bg-amber-500/10 border-amber-500/30">
                <CardHeader>
                  <CardTitle className="text-amber-400 flex items-center gap-2">
                    <span className="text-2xl">1️⃣</span>
                    STEP 1: Get Full Admin Permissions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-slate-300">
                    You need BOTH the built-in 'role' and custom 'role_type' fields set to admin. Click below to set both.
                  </p>
                  <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700 text-xs text-slate-400">
                    <p className="font-semibold text-amber-400 mb-1">What this does:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Sets <code className="text-sky-400">role = "admin"</code> (built-in field)</li>
                      <li>Sets <code className="text-sky-400">role_type = "admin"</code> (custom field)</li>
                      <li>Both are required for RLS (Row Level Security) rules</li>
                    </ul>
                  </div>
                  <Button
                    onClick={forceRoleUpdate}
                    disabled={loading}
                    className="w-full bg-amber-600 hover:bg-amber-700 h-12"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                        Setting Admin Permissions...
                      </>
                    ) : (
                      <>
                        <Shield className="w-5 h-5 mr-2" />
                        Set Full Admin Permissions
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Step 2: Generate Test Data */}
            <Card className="bg-sky-500/10 border-sky-500/30">
              <CardHeader>
                <CardTitle className="text-sky-400 flex items-center gap-2">
                  <span className="text-2xl">2️⃣</span>
                  STEP 2: Generate Test Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-slate-300 space-y-1">
                  <p className="font-semibold">📍 Location: 131 Atlantic Drive, Yzerfontein</p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li>3 test sites in Yzerfontein area</li>
                    <li>2 checklist templates with QR codes</li>
                    <li>2 shifts (1 ready to clock in)</li>
                    <li>Sample assets, incidents & maintenance</li>
                  </ul>
                </div>
                <Button
                  onClick={setupTestData}
                  disabled={loading || !roleStatus?.hasPermission}
                  className="w-full h-12 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Creating Test Data...
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5 mr-2" />
                      Generate Test Data
                    </>
                  )}
                </Button>
                {!roleStatus?.hasPermission && (
                  <p className="text-xs text-amber-400 text-center">
                    ⚠️ Complete Step 1 first to enable this button
                  </p>
                )}
              </CardContent>
            </Card>

            {currentUser && (
              <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-400">Current User:</p>
                <p className="text-white font-semibold">{currentUser.full_name}</p>
                <p className="text-xs text-slate-500">{currentUser.email}</p>
                <div className="text-xs mt-1 space-y-0.5">
                  <p className="text-slate-400">Built-in role: <span className="text-emerald-400">{currentUser.role || 'not set'}</span></p>
                  <p className="text-slate-400">Role type: <span className="text-emerald-400">{currentUser.role_type || 'not set'}</span></p>
                </div>
              </div>
            )}

            {status.length > 0 && (
              <Card className="bg-slate-900/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white text-sm">Setup Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {status.map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        {item.type === "success" && <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />}
                        {item.type === "error" && <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />}
                        {item.type === "warning" && <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />}
                        {item.type === "info" && <div className="w-4 h-4 flex-shrink-0" />}
                        <span className={
                          item.type === "success" ? "text-emerald-400" :
                          item.type === "error" ? "text-rose-400" :
                          item.type === "warning" ? "text-amber-400" :
                          "text-slate-300"
                        }>
                          {item.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}