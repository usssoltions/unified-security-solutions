import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Eye, Calendar } from "lucide-react";

export default function GeneratedReportsView({ user }) {
  const [selectedReport, setSelectedReport] = useState(null);

  const { data: reports = [] } = useQuery({
    queryKey: ["generatedReports", user.id],
    queryFn: () => base44.entities.GeneratedReport.filter(
      { guard_id: user.id },
      "-generated_at",
      50
    ),
    initialData: []
  });

  const downloadReport = (report) => {
    const blob = new Blob([report.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (selectedReport) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4 py-20">
          <Card className="max-w-4xl mx-auto bg-slate-800 border-slate-700">
            <CardHeader className="border-b border-slate-700">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">{selectedReport.title}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => downloadReport(selectedReport)} className="bg-sky-600">
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedReport(null)}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-400 mt-2">
                <span>{new Date(selectedReport.generated_at).toLocaleString()}</span>
                <Badge>{selectedReport.report_type}</Badge>
              </div>
            </CardHeader>

            <CardContent className="p-6">
              {selectedReport.statistics && (
                <div className="grid grid-cols-5 gap-3 mb-6">
                  <div className="p-3 bg-slate-900 rounded-lg text-center">
                    <p className="text-2xl font-bold text-sky-400">{selectedReport.statistics.patrols_completed}</p>
                    <p className="text-xs text-slate-400">Patrols</p>
                  </div>
                  <div className="p-3 bg-slate-900 rounded-lg text-center">
                    <p className="text-2xl font-bold text-rose-400">{selectedReport.statistics.incidents_reported}</p>
                    <p className="text-xs text-slate-400">Incidents</p>
                  </div>
                  <div className="p-3 bg-slate-900 rounded-lg text-center">
                    <p className="text-2xl font-bold text-emerald-400">{selectedReport.statistics.checkpoints_scanned}</p>
                    <p className="text-xs text-slate-400">Checkpoints</p>
                  </div>
                  <div className="p-3 bg-slate-900 rounded-lg text-center">
                    <p className="text-2xl font-bold text-purple-400">{selectedReport.statistics.trainings_completed}</p>
                    <p className="text-xs text-slate-400">Trainings</p>
                  </div>
                  <div className="p-3 bg-slate-900 rounded-lg text-center">
                    <p className="text-2xl font-bold text-amber-400">{selectedReport.statistics.alerts_responded}</p>
                    <p className="text-xs text-slate-400">Alerts</p>
                  </div>
                </div>
              )}

              <div className="prose prose-invert max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-slate-300 font-sans">
                  {selectedReport.content}
                </pre>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-sky-400" />
          My Generated Reports
        </h2>
      </div>

      {reports.length === 0 ? (
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No reports generated yet</p>
          </CardContent>
        </Card>
      ) : (
        reports.map(report => (
          <Card key={report.id} className="bg-slate-800 border-slate-700 hover:border-sky-500/50 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="text-white font-semibold mb-1">{report.title}</h4>
                  <p className="text-sm text-slate-400 mb-2">{report.summary}</p>
                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(report.generated_at).toLocaleDateString()}
                    </span>
                    <Badge variant="outline" className="border-slate-600 text-slate-400">
                      {report.report_type}
                    </Badge>
                    {report.site_name && <span>📍 {report.site_name}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setSelectedReport(report)} className="bg-sky-600 hover:bg-sky-700">
                    <Eye className="w-4 h-4 mr-1" />
                    View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadReport(report)} className="border-slate-600">
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}