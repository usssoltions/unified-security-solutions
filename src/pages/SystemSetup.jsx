import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Loader2, CheckCircle2, AlertCircle, Zap } from "lucide-react";

export default function SystemSetup() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);

  const addStatus = (message, type = "info") => {
    setStatus(prev => [...prev, { message, type, timestamp: new Date() }]);
  };

  const setupTestData = async () => {
    setLoading(true);
    setStatus([]);
    
    try {
      // Get current user
      const user = await base44.auth.me();
      setCurrentUser(user);
      addStatus(`Logged in as: ${user.full_name} (${user.email})`, "success");

      // Update current user to admin
      addStatus("Setting your role to Admin...", "info");
      await base44.auth.updateMe({ role_type: "admin" });
      addStatus("✅ You are now an Admin!", "success");

      // Create Sites
      addStatus("Creating test sites...", "info");
      const sites = await Promise.all([
        base44.entities.Site.create({
          name: "Corporate Plaza",
          address: "123 Business Ave, Cape Town",
          client_name: "ABC Corporation",
          location: { lat: -33.9249, lng: 18.4241 },
          geofence_radius: 100,
          status: "active",
          checkpoints: [
            { id: "cp1", name: "Main Entrance", qr_code: "CORP_MAIN_001", location: { lat: -33.9249, lng: 18.4241 } },
            { id: "cp2", name: "Parking Garage", qr_code: "CORP_PARK_002", location: { lat: -33.9250, lng: 18.4242 } }
          ]
        }),
        base44.entities.Site.create({
          name: "Retail Center",
          address: "456 Shopping St, Cape Town",
          client_name: "Retail Group Ltd",
          location: { lat: -33.9189, lng: 18.4232 },
          geofence_radius: 150,
          status: "active",
          checkpoints: [
            { id: "cp3", name: "North Gate", qr_code: "RETAIL_NORTH_001", location: { lat: -33.9189, lng: 18.4232 } }
          ]
        }),
        base44.entities.Site.create({
          name: "Industrial Park",
          address: "789 Factory Rd, Cape Town",
          client_name: "Manufacturing Co",
          location: { lat: -33.9300, lng: 18.4300 },
          geofence_radius: 200,
          status: "active"
        })
      ]);
      addStatus(`✅ Created ${sites.length} sites`, "success");

      // Create Guard Users (via invitations in real scenario, here we simulate)
      addStatus("Creating test guard accounts...", "info");
      addStatus("Note: In production, create users via Dashboard → Users → Invite", "warning");

      // Create Checklist Templates
      addStatus("Creating checklist templates...", "info");
      const templates = await Promise.all([
        base44.entities.ChecklistTemplate.create({
          name: "Main Entrance Security Check",
          site_id: sites[0].id,
          checkpoint_id: "cp1",
          items: [
            { id: "i1", text: "Doors locked and secure", required: true, type: "checkbox" },
            { id: "i2", text: "Alarm system armed", required: true, type: "checkbox" },
            { id: "i3", text: "Area clear of obstructions", required: true, type: "checkbox" },
            { id: "i4", text: "Take photo of entrance", required: true, type: "photo" }
          ],
          requires_signature: true,
          status: "active"
        }),
        base44.entities.ChecklistTemplate.create({
          name: "Parking Garage Patrol",
          site_id: sites[0].id,
          checkpoint_id: "cp2",
          items: [
            { id: "i1", text: "Vehicle count", required: true, type: "text" },
            { id: "i2", text: "Lighting functional", required: true, type: "checkbox" },
            { id: "i3", text: "Emergency exits clear", required: true, type: "checkbox" }
          ],
          requires_signature: true,
          status: "active"
        })
      ]);
      addStatus(`✅ Created ${templates.length} checklist templates`, "success");

      // Create Shifts for current user
      addStatus("Creating shifts for you...", "info");
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
      addStatus(`✅ Created ${shifts.length} shifts (1 ready to clock in)`, "success");

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
        title: "Suspicious Vehicle in Parking",
        description: "Unidentified vehicle parked in restricted area for 30+ minutes",
        category: "suspicious_activity",
        priority: "medium",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: sites[0].id,
        site_name: sites[0].name,
        location: { lat: -33.9249, lng: 18.4241 },
        reported_at: new Date().toISOString()
      });
      addStatus("✅ Created sample incident", "success");

      // Create sample maintenance request
      addStatus("Creating sample maintenance...", "info");
      await base44.entities.MaintenanceRequest.create({
        title: "Broken Light in Garage",
        description: "Light fixture #4 in parking garage not working",
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
        name: "Daily Morning Report",
        report_type: "daily_activity",
        frequency: "daily",
        send_time: "08:00",
        recipients: [user.email],
        sites: sites.map(s => s.id),
        status: "active",
        created_by: user.id
      });
      addStatus("✅ Created automated report schedule", "success");

      addStatus("🎉 SETUP COMPLETE! You can now test all features.", "success");
      addStatus("💡 Go to 'My Shift' to clock in and start testing", "info");

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
                <p className="text-slate-400 mt-1">Quickly populate your database with sample data</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
              <h3 className="text-sky-400 font-semibold mb-2">What will be created:</h3>
              <ul className="space-y-1 text-sm text-slate-300">
                <li>✅ 3 test sites with GPS locations and checkpoints</li>
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
              <h3 className="text-amber-400 font-semibold mb-2">📱 Next Steps:</h3>
              <ol className="space-y-1 text-sm text-slate-300 list-decimal list-inside">
                <li>Click "Generate Test Data" above</li>
                <li>Go to "My Shift" page (you'll be set as a Guard)</li>
                <li>Clock in to your scheduled shift</li>
                <li>Test QR scanning, incidents, maintenance, etc.</li>
                <li>Switch to Dispatcher role to test Control Room</li>
                <li>Use Analytics page to view reports</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}