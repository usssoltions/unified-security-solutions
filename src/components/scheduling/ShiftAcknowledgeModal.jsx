/**
 * ShiftAcknowledgeModal
 * Guard-facing modal to Accept, Decline, or Request Revision for a shift.
 * Requires a digital signature to confirm. Fires WhatsApp to all admin contacts.
 */
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, RefreshCw, X, Loader2, PenTool } from "lucide-react";
import SignaturePad from "@/components/guard/SignaturePad";
import WhatsAppNotifier from "@/components/WhatsAppNotifier";
import { shiftAckMessage } from "@/lib/whatsapp";

export default function ShiftAcknowledgeModal({ shift, user, onClose }) {
  const [step, setStep] = useState("choose"); // choose | sign | whatsapp | done
  const [status, setStatus] = useState(null); // accepted | declined | revision_requested
  const [notes, setNotes] = useState("");
  const [signature, setSignature] = useState(null);
  const [saving, setSaving] = useState(false);
  const [waMessage, setWaMessage] = useState("");

  const statusConfig = {
    accepted: {
      label: "Accept Shift",
      color: "bg-emerald-600 hover:bg-emerald-700",
      icon: CheckCircle2,
      iconColor: "text-emerald-400",
    },
    declined: {
      label: "Decline Shift",
      color: "bg-rose-600 hover:bg-rose-700",
      icon: XCircle,
      iconColor: "text-rose-400",
    },
    revision_requested: {
      label: "Request Revision",
      color: "bg-amber-600 hover:bg-amber-700",
      icon: RefreshCw,
      iconColor: "text-amber-400",
    },
  };

  const handleChoose = (s) => {
    setStatus(s);
    if (s === "accepted") {
      setStep("sign");
    } else {
      setStep("notes");
    }
  };

  const handleAfterNotes = () => setStep("sign");

  const handleSignSave = async (sig) => {
    setSignature(sig);
    setSaving(true);
    try {
      // Update shift acknowledgement on the Shift entity
      await base44.entities.Shift.update(shift.id, {
        guard_ack_status: status,
        guard_ack_note: notes,
        guard_ack_at: new Date().toISOString(),
        guard_ack_signature: sig,
      });

      // Notify admins in-app
      const allUsers = await base44.entities.User.list();
      const admins = allUsers.filter((u) =>
        ["admin", "dispatcher", "supervisor", "management"].includes(u.role_type)
      );
      for (const admin of admins) {
        await base44.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.full_name,
          type: "shift_reminder",
          priority: status === "declined" ? "high" : "medium",
          title: `Shift ${status.replace("_", " ")} — ${user.full_name}`,
          message: `${user.full_name} has ${status.replace("_", " ")} their shift at ${shift.site_name} on ${new Date(shift.start_time).toLocaleDateString("en-ZA")}.${notes ? ` Note: ${notes}` : ""}`,
          read: false,
          related_entity: "shift",
          related_id: shift.id,
        });
      }

      // Send email if possible
      try {
        await base44.integrations.Core.SendEmail({
          to: admins.map((a) => a.email).filter(Boolean).join(","),
          subject: `Shift ${status.replace("_", " ")} — ${user.full_name} @ ${shift.site_name}`,
          body: `${user.full_name} has ${status.replace("_", " ")} their shift.\n\nSite: ${shift.site_name}\nDate: ${new Date(shift.start_time).toLocaleString("en-ZA")}\n${notes ? `Message: ${notes}` : ""}`,
        });
      } catch (_) {}

      // Build WhatsApp message
      const msg = shiftAckMessage({
        guardName: user.full_name,
        siteName: shift.site_name,
        startTime: shift.start_time,
        status,
        notes,
      });
      setWaMessage(msg);
      setStep("whatsapp");
    } catch (err) {
      alert("Failed to save acknowledgement: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (step === "sign") {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-[70] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <SignaturePad
            onSave={handleSignSave}
            onCancel={() => setStep(status === "accepted" ? "choose" : "notes")}
          />
        </div>
      </div>
    );
  }

  if (step === "whatsapp") {
    return (
      <WhatsAppNotifier
        message={waMessage}
        title={`Shift ${status.replace("_", " ")} — Notify Management`}
        onDone={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white text-lg">Shift Acknowledgement</CardTitle>
            <button onClick={onClose} className="text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="bg-slate-900/60 rounded-xl p-4 space-y-2 text-sm">
            <p className="text-slate-300"><span className="text-slate-500">Site:</span> {shift.site_name}</p>
            <p className="text-slate-300">
              <span className="text-slate-500">Date:</span>{" "}
              {new Date(shift.start_time).toLocaleDateString("en-ZA")}
            </p>
            <p className="text-slate-300">
              <span className="text-slate-500">Time:</span>{" "}
              {new Date(shift.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} –{" "}
              {new Date(shift.end_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
            </p>
            {shift.notes && <p className="text-slate-400 text-xs">{shift.notes}</p>}
          </div>

          {step === "choose" && (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm text-center">How would you like to respond to this shift?</p>
              {Object.entries(statusConfig).map(([key, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <Button
                    key={key}
                    onClick={() => handleChoose(key)}
                    className={`w-full h-12 ${cfg.color} font-semibold`}
                  >
                    <Icon className="w-5 h-5 mr-2" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          )}

          {step === "notes" && (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">
                {status === "declined" ? "Reason for declining (optional):" : "What revision is needed?"}
              </p>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a message for management..."
                className="bg-slate-900 border-slate-700 text-white"
                rows={3}
              />
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep("choose")}
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  Back
                </Button>
                <Button
                  onClick={handleAfterNotes}
                  disabled={saving}
                  className={`flex-1 ${statusConfig[status]?.color}`}
                >
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PenTool className="w-4 h-4 mr-2" />}
                  Sign & Confirm
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}