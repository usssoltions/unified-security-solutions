import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  Star,
  BarChart3,
  Shield,
  Clock,
  Navigation
} from "lucide-react";

export default function ReportDisplay({ report }) {
  const getRatingBadge = (rating) => {
    const config = {
      excellent: { className: "bg-emerald-500", icon: "🌟" },
      good: { className: "bg-sky-500", icon: "👍" },
      fair: { className: "bg-amber-500", icon: "⚠️" },
      needs_improvement: { className: "bg-rose-500", icon: "🔧" }
    };
    return config[rating] || config.fair;
  };

  const ratingConfig = getRatingBadge(report.ai_analysis.overall_rating);

  const downloadReport = () => {
    const reportText = `
${report.entity_name} - ${report.period.toUpperCase()} REPORT
Generated: ${new Date(report.generated_at).toLocaleString()}

=== EXECUTIVE SUMMARY ===
${report.ai_analysis.executive_summary}

=== KEY METRICS ===
- Total Shifts: ${report.metrics.totalShifts}
- Completed Shifts: ${report.metrics.completedShifts}
- Total Incidents: ${report.metrics.totalIncidents}
- Critical Incidents: ${report.metrics.criticalIncidents}
- Maintenance Requests: ${report.metrics.maintenanceRequests}
- Patrol Checkpoints: ${report.metrics.patrolCheckpoints}
- Distance Traveled: ${report.distance_traveled} km

=== KPI ANALYSIS ===
Shift Completion Rate: ${report.ai_analysis.kpi_analysis.shift_completion_rate}
Incident Resolution Rate: ${report.ai_analysis.kpi_analysis.incident_resolution_rate}
Maintenance Completion Rate: ${report.ai_analysis.kpi_analysis.maintenance_completion_rate}
Checkpoint Verification Rate: ${report.ai_analysis.kpi_analysis.checkpoint_verification_rate}
Stay Awake Response Rate: ${report.ai_analysis.kpi_analysis.stay_awake_response_rate}

=== PERFORMANCE HIGHLIGHTS ===
${report.ai_analysis.performance_highlights.map((h, i) => `${i + 1}. ${h}`).join('\n')}

=== AREAS OF CONCERN ===
${report.ai_analysis.areas_of_concern.map((c, i) => `${i + 1}. ${c}`).join('\n')}

=== INCIDENT ANALYSIS ===
${report.ai_analysis.incident_analysis}

=== PATROL ASSESSMENT ===
${report.ai_analysis.patrol_assessment}

=== RESPONSE TIME ANALYSIS ===
${report.ai_analysis.response_time_analysis}

=== RECOMMENDATIONS ===
${report.ai_analysis.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

=== RESOURCE INSIGHTS ===
${report.ai_analysis.resource_insights}

=== COMPLIANCE NOTES ===
${report.ai_analysis.compliance_notes}
    `.trim();

    const blob = new Blob([reportText], { type: "text/plain" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report.entity_name.replace(/\s+/g, '_')}_${report.period}_report.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <div className="space-y-6">
      {/* Report Header */}
      <Card className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-purple-500/30">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-white text-2xl mb-2">{report.entity_name}</CardTitle>
              <div className="flex items-center gap-3">
                <Badge className="bg-purple-600">
                  {report.period.charAt(0).toUpperCase() + report.period.slice(1)} Report
                </Badge>
                <Badge className={ratingConfig.className}>
                  {ratingConfig.icon} {report.ai_analysis.overall_rating.replace(/_/g, ' ').toUpperCase()}
                </Badge>
                <span className="text-xs text-slate-400">
                  Generated: {new Date(report.generated_at).toLocaleString()}
                </span>
              </div>
            </div>
            <Button onClick={downloadReport} variant="outline" className="border-purple-500 text-purple-400">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Executive Summary */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Star className="w-5 h-5 text-amber-400" />
            Executive Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-300 leading-relaxed">{report.ai_analysis.executive_summary}</p>
        </CardContent>
      </Card>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center">
              <Shield className="w-8 h-8 text-sky-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{report.metrics.totalShifts}</p>
              <p className="text-sm text-slate-400">Total Shifts</p>
              <p className="text-xs text-emerald-400 mt-1">
                {report.metrics.completedShifts} completed
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{report.metrics.totalIncidents}</p>
              <p className="text-sm text-slate-400">Incidents</p>
              <p className="text-xs text-rose-400 mt-1">
                {report.metrics.criticalIncidents} critical
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center">
              <CheckCircle2 className="w-8 h-8 text-purple-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{report.metrics.patrolCheckpoints}</p>
              <p className="text-sm text-slate-400">Checkpoints</p>
              <p className="text-xs text-emerald-400 mt-1">
                {report.metrics.verifiedCheckpoints} verified
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center">
              <Navigation className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{report.distance_traveled}</p>
              <p className="text-sm text-slate-400">km Traveled</p>
              <p className="text-xs text-slate-400 mt-1">
                {report.metrics.locationDataPoints} tracking points
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Analysis */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-400" />
            Key Performance Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(report.ai_analysis.kpi_analysis).map(([key, value]) => (
              <div key={key} className="p-3 bg-slate-900/50 rounded-lg">
                <p className="text-sm text-slate-400 mb-1">
                  {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </p>
                <p className="text-lg font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance Highlights */}
      <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Performance Highlights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {report.ai_analysis.performance_highlights.map((highlight, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-300">{highlight}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Areas of Concern */}
      {report.ai_analysis.areas_of_concern.length > 0 && (
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Areas of Concern
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {report.ai_analysis.areas_of_concern.map((concern, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-300">{concern}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Analysis Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Incident Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300 leading-relaxed">
              {report.ai_analysis.incident_analysis}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Patrol Assessment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300 leading-relaxed">
              {report.ai_analysis.patrol_assessment}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Response Time Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300 leading-relaxed">
              {report.ai_analysis.response_time_analysis}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white text-sm">Resource Insights</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-300 leading-relaxed">
              {report.ai_analysis.resource_insights}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendations */}
      <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-sky-400" />
            Recommendations for Improvement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {report.ai_analysis.recommendations.map((rec, idx) => (
              <li key={idx} className="flex items-start gap-3">
                <span className="text-sky-400 font-bold">{idx + 1}.</span>
                <span className="text-slate-300">{rec}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Compliance Notes */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white text-sm">Compliance & Safety Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-300 leading-relaxed">
            {report.ai_analysis.compliance_notes}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}