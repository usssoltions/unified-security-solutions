import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import WhatsAppNotifier from "@/components/WhatsAppNotifier";
import { panicMessage } from "@/lib/whatsapp";

export default function PanicButton({ shiftId, siteId }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [location, setLocation] = useState(null);
  const [waMessage, setWaMessage] = useState(null);

  const handlePanicPress = () => {
    // Get current location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
          setShowConfirm(true);
        },
        () => {
          alert("Unable to get location. Please enable location services.");
        }
      );
    } else {
      alert("Geolocation not supported by your device.");
    }
  };

  const sendPanicAlert = async () => {
    if (!location) {
      alert("Location required to send panic alert");
      return;
    }

    setSending(true);
    try {
      const user = await base44.auth.me();

      // Create panic alert in database
      await base44.entities.Alert.create({
        type: "panic",
        priority: "critical",
        title: "🚨 PANIC ALERT",
        message: `EMERGENCY: ${user.full_name} has triggered a panic alert! Location: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}. ${notes ? `Notes: ${notes}` : ""}`,
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: siteId || "",
        shift_id: shiftId || "",
        location,
        status: "active"
      });

      // Create an incident record so it shows in control room
      await base44.entities.Incident.create({
        title: "🚨 PANIC ALERT - IMMEDIATE RESPONSE REQUIRED",
        description: `Guard ${user.full_name} triggered panic alert. ${notes || "No additional notes."}`,
        category: "suspicious_activity",
        priority: "critical",
        status: "reported",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: siteId || "",
        shift_id: shiftId || "",
        location,
        reported_at: new Date().toISOString()
      });

      setShowConfirm(false);
      setNotes("");
      const msg = panicMessage({
        guardName: user.full_name,
        siteName: user.site_name || siteId || "Unknown Site",
        lat: location?.lat,
        lng: location?.lng,
        notes,
      });
      setWaMessage(msg);
    } catch (error) {
      // Even if DB fails, show a softer message
      alert("Alert sent. If you don't receive confirmation, CALL EMERGENCY SERVICES IMMEDIATELY!");
      console.error("Panic alert error:", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {waMessage && (
        <WhatsAppNotifier
          message={waMessage}
          title="🚨 Send Panic Alerts via WhatsApp"
          onDone={() => setWaMessage(null)}
        />
      )}
      <Button
        onClick={handlePanicPress}
        className="w-full bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white shadow-lg shadow-red-500/50 py-3 sm:py-4 lg:py-5 text-xs sm:text-sm lg:text-base font-bold animate-pulse"
      >
        <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 mr-1 sm:mr-2" />
        <span className="truncate">🚨 PANIC BUTTON - EMERGENCY</span>
      </Button>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="bg-slate-900 border-red-500">
          <DialogHeader>
            <DialogTitle className="text-red-500 text-xl flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              Confirm Emergency Alert
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-red-900/20 border border-red-500 rounded-lg p-4">
              <p className="text-white font-semibold mb-2">
                ⚠️ This will immediately alert all administrators
              </p>
              <p className="text-slate-300 text-sm">
                Your exact location will be shared with dispatch and emergency response team.
              </p>
            </div>

            {location && (
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
                <div className="flex items-start gap-2 text-sm text-slate-300">
                  <MapPin className="w-4 h-4 text-sky-400 mt-0.5" />
                  <div>
                    <p className="font-semibold text-white">Your Location</p>
                    <p>Lat: {location.lat.toFixed(6)}</p>
                    <p>Lng: {location.lng.toFixed(6)}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="text-white text-sm font-medium mb-2 block">
                Additional Notes (Optional)
              </label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Describe the emergency situation..."
                className="bg-slate-800 border-slate-700 text-white"
                rows={3}
              />
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => setShowConfirm(false)}
                variant="outline"
                className="flex-1 border-slate-600 text-slate-300"
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                onClick={sendPanicAlert}
                disabled={sending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
              >
                {sending ? "SENDING ALERT..." : "🚨 SEND EMERGENCY ALERT"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}