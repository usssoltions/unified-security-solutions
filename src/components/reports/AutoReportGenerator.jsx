import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";

export default function AutoReportGenerator({ user, shift }) {
  useEffect(() => {
    if (!user || !shift) return;

    const generateShiftEndReport = async () => {
      try {
        const templates = await base44.entities.ReportTemplate.filter({
          template_type: "shift_end",
          auto_generate: true,
          status: "active"
        });

        if (templates.length === 0) return;

        const template = templates[0];

        // Gather all data
        const [patrols, incidents, maintenance, trainings, alerts, checkpoints, stayAwakeLogs] = await Promise.all([
          base44.entities.PatrolLog.filter({ shift_id: shift.id }),
          base44.entities.Incident.filter({ shift_id: shift.id }),
          base44.entities.MaintenanceRequest.filter({ guard_id: user.id }),
          base44.entities.TrainingAssignment.filter({
            assigned_to: user.id,
            status: "completed"
          }),
          base44.entities.Alert.filter({ guard_id: user.id }),
          base44.entities.ChecklistCompletion.filter({ shift_id: shift.id }),
          base44.entities.StayAwakeLog.filter({ shift_id: shift.id })
        ]);

        // Build comprehensive data summary
        const dataSummary = {
          shift: {
            site: shift.site_name,
            start: new Date(shift.start_time).toLocaleString(),
            end: new Date(shift.end_time).toLocaleString(),
            duration: Math.round((new Date(shift.end_time) - new Date(shift.start_time)) / 3600000) + " hours"
          },
          patrols: patrols.map(p => ({
            checkpoint: p.checkpoint_name,
            time: new Date(p.timestamp).toLocaleTimeString(),
            verified: p.verified
          })),
          incidents: incidents.map(i => ({
            category: i.category,
            priority: i.priority,
            description: i.description?.substring(0, 100),
            time: new Date(i.reported_at).toLocaleTimeString()
          })),
          maintenance: maintenance.map(m => ({
            category: m.category,
            urgency: m.urgency,
            description: m.description?.substring(0, 100)
          })),
          trainings: trainings.map(t => ({
            title: t.training_title,
            score: t.score,
            passed: t.passed
          })),
          checkpoints: checkpoints.length,
          stayAwakeResponses: stayAwakeLogs.filter(l => l.status === "acknowledged").length,
          stayAwakeMissed: stayAwakeLogs.filter(l => l.status === "missed").length
        };

        // Generate AI report
        const prompt = `Generate a comprehensive shift-end report for a security guard:

SHIFT DETAILS:
- Site: ${dataSummary.shift.site}
- Duration: ${dataSummary.shift.start} to ${dataSummary.shift.end}
- Guard: ${user.full_name}

ACTIVITY SUMMARY:
- Patrols Completed: ${patrols.length}
- Checkpoints Scanned: ${dataSummary.checkpoints}
- Incidents Reported: ${incidents.length}
- Maintenance Requests: ${maintenance.length}
- Trainings Completed: ${trainings.length}
- Stay Awake Responses: ${dataSummary.stayAwakeResponses}/${stayAwakeLogs.length}

PATROL DETAILS:
${dataSummary.patrols.map(p => `- ${p.checkpoint} at ${p.time} (${p.verified ? "Verified" : "Not verified"})`).join("\n")}

INCIDENTS:
${dataSummary.incidents.map(i => `- [${i.priority}] ${i.category}: ${i.description} at ${i.time}`).join("\n") || "No incidents reported"}

MAINTENANCE:
${dataSummary.maintenance.map(m => `- [${m.urgency}] ${m.category}: ${m.description}`).join("\n") || "No maintenance requests"}

Generate a professional report with:
1. Executive Summary
2. Detailed Activity Analysis
3. Key Highlights & Concerns
4. Performance Metrics
5. Recommendations for next shift`;

        const aiReport = await base44.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: {
            type: "object",
            properties: {
              summary: { type: "string" },
              detailed_analysis: { type: "string" },
              highlights: { type: "string" },
              performance_metrics: { type: "string" },
              recommendations: { type: "string" },
              ai_insights: { type: "string" }
            }
          }
        });

        const reportContent = `
# SHIFT-END REPORT
**Generated**: ${new Date().toLocaleString()}
**Guard**: ${user.full_name}
**Site**: ${shift.site_name}
**Shift**: ${dataSummary.shift.start} - ${dataSummary.shift.end}

---

## EXECUTIVE SUMMARY
${aiReport.summary}

## DETAILED ACTIVITY ANALYSIS
${aiReport.detailed_analysis}

## KEY HIGHLIGHTS & CONCERNS
${aiReport.highlights}

## PERFORMANCE METRICS
${aiReport.performance_metrics}

**Statistics:**
- ✓ Patrols Completed: ${patrols.length}
- ✓ Checkpoints Scanned: ${dataSummary.checkpoints}
- ✓ Incidents Reported: ${incidents.length}
- ✓ Maintenance Requests: ${maintenance.length}
- ✓ Trainings Completed: ${trainings.length}
- ✓ Stay Awake Response Rate: ${stayAwakeLogs.length > 0 ? Math.round((dataSummary.stayAwakeResponses / stayAwakeLogs.length) * 100) : 100}%

## RECOMMENDATIONS FOR NEXT SHIFT
${aiReport.recommendations}

## AI INSIGHTS
${aiReport.ai_insights}

---
*This report was automatically generated using AI analysis*
        `.trim();

        // Save generated report
        const report = await base44.entities.GeneratedReport.create({
          title: `Shift Report - ${shift.site_name} - ${new Date().toLocaleDateString()}`,
          report_type: "shift_end",
          template_id: template.id,
          guard_id: user.id,
          guard_name: user.full_name,
          shift_id: shift.id,
          site_id: shift.site_id,
          site_name: shift.site_name,
          report_date: new Date().toISOString().split('T')[0],
          content: reportContent,
          summary: aiReport.summary,
          statistics: {
            patrols_completed: patrols.length,
            incidents_reported: incidents.length,
            trainings_completed: trainings.length,
            checkpoints_scanned: dataSummary.checkpoints,
            alerts_responded: dataSummary.stayAwakeResponses
          },
          ai_insights: aiReport.ai_insights,
          generated_at: new Date().toISOString()
        });

        // Send to recipients if configured
        if (template.recipients && template.recipients.length > 0) {
          for (const email of template.recipients) {
            await base44.integrations.Core.SendEmail({
              to: email,
              subject: `Shift Report: ${user.full_name} - ${shift.site_name}`,
              body: reportContent.replace(/\n/g, '<br>').replace(/\*\*/g, '<b>').replace(/\*/g, '</b>')
            });
          }
        }

        console.log("Auto-report generated:", report.id);
      } catch (error) {
        console.error("Failed to generate shift report:", error);
      }
    };

    // Check if shift is ending soon (within 30 minutes)
    const checkShiftEnd = () => {
      if (shift.status === "active") {
        const endTime = new Date(shift.end_time);
        const now = new Date();
        const minutesUntilEnd = (endTime - now) / 60000;

        if (minutesUntilEnd > 0 && minutesUntilEnd <= 30) {
          generateShiftEndReport();
        }
      }
    };

    checkShiftEnd();
    const interval = setInterval(checkShiftEnd, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(interval);
  }, [user, shift]);

  return null; // This component doesn't render anything
}