import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Trash2,
  Mail,
  MessageSquare,
  Printer,
  Download,
  Loader2,
  X,
  AlertCircle,
  Share2
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function BulkShiftActions({ 
  selectedShifts, 
  allShifts, 
  guards, 
  sites, 
  onClearSelection 
}) {
  const queryClient = useQueryClient();
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [actionStatus, setActionStatus] = useState(null);

  const selectedShiftData = allShifts.filter(s => selectedShifts.includes(s.id));

  const deleteShiftsMutation = useMutation({
    mutationFn: async () => {
      // Notify guards and delete
      const deletePromises = selectedShiftData.map(async (shift) => {
        if (shift.guard_id) {
          await base44.entities.Alert.create({
            type: "shift_reminder",
            priority: "high",
            title: "❌ Shift Cancelled",
            message: `Your shift at ${shift.site_name} on ${new Date(shift.start_time).toLocaleString()} has been cancelled.`,
            guard_id: shift.guard_id,
            guard_name: shift.guard_name,
            status: "active"
          });
        }
        return base44.entities.Shift.delete(shift.id);
      });
      
      await Promise.all(deletePromises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["shifts"]);
      setActionStatus({ type: 'success', message: `Successfully deleted ${selectedShifts.length} shifts` });
      setTimeout(() => {
        onClearSelection();
        setActionStatus(null);
      }, 2000);
    },
    onError: (error) => {
      setActionStatus({ type: 'error', message: 'Failed to delete shifts: ' + error.message });
    }
  });

  const generateShiftReport = () => {
    const groupedByGuard = selectedShiftData.reduce((acc, shift) => {
      const guardName = shift.guard_name || 'Unassigned';
      if (!acc[guardName]) {
        acc[guardName] = [];
      }
      acc[guardName].push(shift);
      return acc;
    }, {});

    let report = '🛡️ SHIFT SCHEDULE REPORT\n';
    report += `Generated: ${new Date().toLocaleString()}\n`;
    report += `Total Shifts: ${selectedShifts.length}\n\n`;
    report += '═══════════════════════════════════\n\n';

    Object.entries(groupedByGuard).forEach(([guardName, shifts]) => {
      report += `👤 ${guardName}\n`;
      report += `   ${shifts.length} shift${shifts.length > 1 ? 's' : ''}\n\n`;
      
      shifts.forEach((shift, idx) => {
        report += `   ${idx + 1}. ${shift.site_name}\n`;
        report += `      📅 ${new Date(shift.start_time).toLocaleDateString()}\n`;
        report += `      🕐 ${new Date(shift.start_time).toLocaleTimeString()} - ${new Date(shift.end_time).toLocaleTimeString()}\n`;
        report += `      📊 Status: ${shift.status}\n`;
        if (shift.notes) {
          report += `      📝 ${shift.notes}\n`;
        }
        report += '\n';
      });
      report += '───────────────────────────────────\n\n';
    });

    return report;
  };

  const handlePrint = () => {
    const report = generateShiftReport();
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Shift Schedule - ${selectedShifts.length} Shifts</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 30px;
              max-width: 800px;
              margin: 0 auto;
              line-height: 1.6;
            }
            h1 { 
              color: #0284c7; 
              border-bottom: 3px solid #0284c7;
              padding-bottom: 10px;
            }
            .meta {
              color: #64748b;
              margin-bottom: 20px;
            }
            .guard-section {
              margin: 30px 0;
              padding: 20px;
              background: #f8fafc;
              border-left: 4px solid #0284c7;
            }
            .guard-name {
              font-size: 1.2em;
              font-weight: bold;
              color: #1e293b;
              margin-bottom: 10px;
            }
            .shift {
              margin: 15px 0;
              padding: 15px;
              background: white;
              border: 1px solid #e2e8f0;
              border-radius: 5px;
            }
            .shift-site {
              font-weight: bold;
              color: #0f172a;
              font-size: 1.1em;
            }
            .shift-detail {
              margin: 5px 0;
              color: #475569;
            }
            .status {
              display: inline-block;
              padding: 3px 10px;
              border-radius: 12px;
              font-size: 0.85em;
              font-weight: bold;
            }
            .status-scheduled { background: #dbeafe; color: #0369a1; }
            .status-active { background: #d1fae5; color: #059669; }
            .status-completed { background: #dcfce7; color: #16a34a; }
            .status-missed { background: #fee2e2; color: #dc2626; }
            @media print {
              body { padding: 20px; }
              .guard-section { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>🛡️ Shift Schedule Report</h1>
          <div class="meta">
            <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
            <div><strong>Total Shifts:</strong> ${selectedShifts.length}</div>
          </div>
          ${Object.entries(selectedShiftData.reduce((acc, shift) => {
            const guardName = shift.guard_name || 'Unassigned';
            if (!acc[guardName]) acc[guardName] = [];
            acc[guardName].push(shift);
            return acc;
          }, {})).map(([guardName, shifts]) => `
            <div class="guard-section">
              <div class="guard-name">👤 ${guardName}</div>
              <div style="color: #64748b; margin-bottom: 15px;">${shifts.length} shift${shifts.length > 1 ? 's' : ''}</div>
              ${shifts.map((shift, idx) => `
                <div class="shift">
                  <div class="shift-site">${idx + 1}. ${shift.site_name}</div>
                  <div class="shift-detail">📅 ${new Date(shift.start_time).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
                  <div class="shift-detail">🕐 ${new Date(shift.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - ${new Date(shift.end_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div class="shift-detail">
                    <span class="status status-${shift.status}">${shift.status.toUpperCase()}</span>
                  </div>
                  ${shift.notes ? `<div class="shift-detail">📝 ${shift.notes}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
    setShowShareMenu(false);
  };

  const handleEmail = async () => {
    const report = generateShiftReport();
    const uniqueGuards = [...new Set(selectedShiftData.map(s => s.guard_id).filter(Boolean))];
    
    try {
      const emailPromises = uniqueGuards.map(async (guardId) => {
        const guard = guards.find(g => g.id === guardId);
        if (guard?.email) {
          const guardShifts = selectedShiftData.filter(s => s.guard_id === guardId);
          let guardReport = `🛡️ YOUR SHIFT SCHEDULE\n\n`;
          guardReport += `Hello ${guard.full_name},\n\n`;
          guardReport += `You have ${guardShifts.length} upcoming shift${guardShifts.length > 1 ? 's' : ''}:\n\n`;
          
          guardShifts.forEach((shift, idx) => {
            guardReport += `${idx + 1}. ${shift.site_name}\n`;
            guardReport += `   📅 ${new Date(shift.start_time).toLocaleDateString()}\n`;
            guardReport += `   🕐 ${new Date(shift.start_time).toLocaleTimeString()} - ${new Date(shift.end_time).toLocaleTimeString()}\n`;
            guardReport += `   📊 Status: ${shift.status}\n`;
            if (shift.notes) {
              guardReport += `   📝 ${shift.notes}\n`;
            }
            guardReport += '\n';
          });

          await base44.integrations.Core.SendEmail({
            to: guard.email,
            subject: `Your Shift Schedule - ${guardShifts.length} Shifts`,
            body: guardReport
          });
        }
      });

      await Promise.all(emailPromises);
      setActionStatus({ type: 'success', message: `Email sent to ${uniqueGuards.length} guard(s)` });
      setShowShareMenu(false);
    } catch (error) {
      setActionStatus({ type: 'error', message: 'Failed to send emails: ' + error.message });
    }
  };

  const handleWhatsApp = () => {
    const report = generateShiftReport();
    const message = encodeURIComponent(report);
    window.open(`https://wa.me/?text=${message}`, '_blank');
    setShowShareMenu(false);
  };

  const handleDownload = () => {
    const report = generateShiftReport();
    const blob = new Blob([report], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shifts_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    setShowShareMenu(false);
  };

  const handleDelete = () => {
    if (confirm(`Are you sure you want to delete ${selectedShifts.length} shift(s)? All assigned guards will be notified.`)) {
      deleteShiftsMutation.mutate();
    }
  };

  if (selectedShifts.length === 0) return null;

  return (
    <Card className="bg-sky-500/10 border-sky-500/30 sticky top-0 z-10">
      <CardContent className="p-3 sm:p-4">
        {actionStatus && (
          <Alert className={`mb-3 ${actionStatus.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription className="text-sm">
              {actionStatus.message}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm sm:text-base">{selectedShifts.length}</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm sm:text-base">
                {selectedShifts.length} shift{selectedShifts.length > 1 ? 's' : ''} selected
              </p>
              <p className="text-xs text-sky-300">Choose an action below</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowShareMenu(!showShareMenu)}
                className="border-sky-500 text-sky-400 hover:bg-sky-500/20"
              >
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
              
              {showShareMenu && (
                <div className="absolute right-0 top-12 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-2 space-y-1 z-20 min-w-[180px]">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-slate-300 hover:bg-slate-700"
                    onClick={handlePrint}
                  >
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-slate-300 hover:bg-slate-700"
                    onClick={handleEmail}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Email to Guards
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-slate-300 hover:bg-slate-700"
                    onClick={handleWhatsApp}
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    WhatsApp
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-slate-300 hover:bg-slate-700"
                    onClick={handleDownload}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleteShiftsMutation.isPending}
              className="border-rose-500 text-rose-400 hover:bg-rose-500/20"
            >
              {deleteShiftsMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Delete
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
              className="text-slate-400"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}