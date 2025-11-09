import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Loader2, CheckCircle2, AlertCircle, Zap, LogOut } from "lucide-react";

export default function SystemSetup() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [needsRelogin, setNeedsRelogin] = useState(false);

  const addStatus = (message, type = "info") => {
    setStatus(prev => [...prev, { message, type, timestamp: new Date() }]);
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
      addStatus(`Current role: ${user.role_type || 'Not set'}`, "info");

      // Check if already admin
      if (user.role_type === 'admin' || user.role_type === 'dispatcher') {
        addStatus("✅ You already have admin/dispatcher permissions", "success");
      } else {
        // Update current user to admin
        addStatus("Setting your role to Admin...", "info");
        await base44.auth.updateMe({ 
          role_type: "admin",
          badge_number: user.badge_number || "ADMIN-001",
          phone: user.phone || "+27123456789"
        });
        
        addStatus("✅ Role updated in database!", "success");
        addStatus("⚠️ You need to logout and login again for permissions to take effect", "warning");
        setNeedsRelogin(true);
        setLoading(false);
        return;
      }

      // Continue with setup only if already admin
      // Create Sites - UPDATED TO YOUR LOCATION
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

      // Create Shifts for current user at YOUR LOCATION
      addStatus("Creating shifts at 131 Atlantic Drive...", "info");
      const now = new Date();
      const shifts = await Promise.all([
        // Active shift (started 2 hours ago, ends in 6 hours)
        base44.entities.Shift.create({
          guard_id: user.id,
          guard_name: user.full_name,
          site_id: sites[0].id,
          site_name: sites[0].name,
          start_time: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
          status: "scheduled"
        }),
        // Upcoming shift tomorrow
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
      addStatus(`✅ Created ${shifts.length} shifts (1 ready to clock in at 131 Atlantic Drive)`, "success");

      // Create sample Assets
      addStatus("Creating sample assets...", "info");
      const assets = await Promise.all([
        base44.entities.Asset.create({
          asset_name: "Patrol Vehicle #1",
          asset_number: "VEH-001",
          category: "vehicle",
          status: "active",
          site_id: sites[0].id,
          site_name: sites[0].name,
          purchase_date: "2023-01-15",
          purchase_cost: 250000,
          current_value: 200000,
          last_service_date: "2024-09-01",
          next_service_date: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          service_interval_days: 90
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
      addStatus(`✅ Created ${assets.length} assets`, "success");

      // Create sample incidents
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

      // Create sample maintenance request
      addStatus("Creating sample maintenance...", "info");
      await base44.entities.MaintenanceRequest.create({
        title: "Broken Gate Light",
        description: "Main gate light fixture not working - needs replacement",
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

      // Create custom report schedule
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
      addStatus("💡 Go to 'My Shift' to clock in (200m geofence radius)", "info");

    } catch (error) {
      addStatus(`❌ Error: ${error.message}`, "error");
      console.error("Setup error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoutAndRelogin = async () => {
    await base44.auth.logout(window.location.href);
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
                <p className="text-slate-400 mt-1">Quickly populate your database with sample data</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {needsRelogin && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-amber-400 font-semibold mb-2">Action Required: Logout & Login</h3>
                    <p className="text-sm text-slate-300 mb-4">
                      Your role has been updated to Admin, but you need to logout and login again 
                      for the permissions to take effect in your session.
                    </p>
                    <Button
                      onClick={handleLogoutAndRelogin}
                      className="w-full bg-amber-600 hover:bg-amber-700"
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout & Return to Login
                    </Button>
                    <p className="text-xs text-slate-400 mt-2">
                      After logging back in, click "Generate Test Data" again to create the test sites.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
              <h3 className="text-sky-400 font-semibold mb-2">📍 Test Location Setup:</h3>
              <p className="text-white font-medium mb-2">131 Atlantic Drive, Yzerfontein, 7351</p>
              <ul className="space-y-1 text-sm text-slate-300">
                <li>✅ 3 test sites in Yzerfontein area</li>
                <li>✅ Main site at YOUR LOCATION (200m geofence)</li>
                <li>✅ 2 checklist templates with QR codes</li>
                <li>✅ 2 shifts (1 active shift you can clock into now)</li>
                <li>✅ 2 sample assets (vehicle & equipment)</li>
                <li>✅ Sample incident report</li>
                <li>✅ Sample maintenance request</li>
                <li>✅ Daily automated report schedule</li>
                <li>✅ Your account upgraded to Admin role</li>
              </ul>
            </div>

            <Button
              onClick={setupTestData}
              disabled={loading}
              className="w-full h-14 text-lg bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                  Setting up system...
                </>
              ) : (
                <>
                  <Zap className="w-6 h-6 mr-2" />
                  Generate Test Data
                </>
              )}
            </Button>

            {currentUser && (
              <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                <p className="text-sm text-slate-400">Current User:</p>
                <p className="text-white font-semibold">{currentUser.full_name}</p>
                <p className="text-xs text-slate-500">{currentUser.email}</p>
                <p className="text-xs text-emerald-400 mt-1">Role: {currentUser.role_type || 'Not set'}</p>
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

            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <h3 className="text-amber-400 font-semibold mb-2">📱 Setup Steps:</h3>
              <ol className="space-y-1 text-sm text-slate-300 list-decimal list-inside">
                <li>Click "Generate Test Data" button above</li>
                <li>If prompted, logout and login again (for role permissions)</li>
                <li>Click "Generate Test Data" again after re-login</li>
                <li>Test data will be created at your location</li>
                <li>Go to "Sites" to create additional sites</li>
                <li>Go to "My Shift" to test guard features</li>
                <li>Test QR scanning (codes: YZER_MAIN_001, YZER_PERI_002)</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}