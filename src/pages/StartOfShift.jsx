import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle2, Shield } from "lucide-react";

export default function StartOfShift() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [shift, setShift] = useState(null);
  const [site, setSite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    site_condition: "",
    notes: "",
    all_secure: true
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);

      if (currentUser.current_shift_id) {
        const currentShift = await base44.entities.Shift.get(currentUser.current_shift_id);
        setShift(currentShift);

        if (currentShift.site_id) {
          const currentSite = await base44.entities.Site.get(currentShift.site_id);
          setSite(currentSite);
        }
      }
    } catch (error) {
      console.error("Error loading data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Create shift handover record
      await base44.entities.ShiftHandover.create({
        shift_id: shift.id,
        site_id: shift.site_id,
        site_name: site?.name,
        outgoing_guard_id: user.id,
        outgoing_guard_name: user.full_name,
        handover_time: new Date().toISOString(),
        site_status: {
          all_secure: formData.all_secure
        },
        special_instructions: formData.notes,
        weather_conditions: formData.site_condition
      });

      // Update user - mark that start of shift report is completed
      await base44.auth.updateMe({
        needs_start_of_shift_report: false
      });

      // Redirect back to guard shift page
      navigate(createPageUrl("GuardShift"));
    } catch (error) {
      console.error("Error submitting report:", error);
      alert("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto pt-8">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-sky-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">Start of Shift Report</CardTitle>
            <p className="text-slate-400 mt-2">
              {site?.name} • {new Date().toLocaleDateString()}
            </p>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="text-white font-medium block mb-2">
                  Site Condition
                </label>
                <Textarea
                  value={formData.site_condition}
                  onChange={(e) => setFormData({ ...formData, site_condition: e.target.value })}
                  placeholder="Describe the current site condition (weather, lighting, etc.)"
                  className="bg-slate-900 border-slate-700 text-white min-h-[100px]"
                  required
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">
                  Additional Notes
                </label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Any observations, incidents, or special instructions"
                  className="bg-slate-900 border-slate-700 text-white min-h-[100px]"
                />
              </div>

              <div className="flex items-center gap-3 p-4 bg-slate-900/50 rounded-lg">
                <input
                  type="checkbox"
                  id="all_secure"
                  checked={formData.all_secure}
                  onChange={(e) => setFormData({ ...formData, all_secure: e.target.checked })}
                  className="w-5 h-5"
                />
                <label htmlFor="all_secure" className="text-white cursor-pointer">
                  All secure - No immediate issues to report
                </label>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full h-12 bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700 text-white text-lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Submit & Start Shift
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}