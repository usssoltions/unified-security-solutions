import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const maintenance = await base44.asServiceRole.entities.MaintenanceRequest.filter({});
    
    const currentMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    const prevMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });

    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    // Category analysis
    const maintenanceByCategory = currentMaintenance.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {});

    const prevMaintenanceByCategory = prevMaintenance.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {});

    // Urgency analysis
    const maintenanceByUrgency = currentMaintenance.reduce((acc, m) => {
      acc[m.urgency] = (acc[m.urgency] || 0) + 1;
      return acc;
    }, {});

    // Status analysis
    const maintenanceByStatus = currentMaintenance.reduce((acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    }, {});

    // Site analysis
    const maintenanceBySite = currentMaintenance.reduce((acc, m) => {
      const site = m.site_name || 'Unknown';
      acc[site] = (acc[site] || 0) + 1;
      return acc;
    }, {});

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let yPos = 20;

    // BRANDED HEADER
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setFillColor(220, 38, 38);
    doc.rect(0, 40, pageWidth, 6, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.text('UNIFIED SECURITY SOLUTIONS', pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Professional Security Management & Advisory', pageWidth / 2, 23, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MONTHLY MAINTENANCE ANALYSIS REPORT', pageWidth / 2, 35, { align: 'center' });

    yPos = 55;

    // Report Period
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yPos, pageWidth - 30, 12, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Reporting Period: ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, pageWidth / 2, yPos + 8, { align: 'center' });
    yPos += 20;

    // KEY METRICS DASHBOARD
    const cardWidth = (pageWidth - 40) / 4;
    const cardHeight = 30;
    const cardSpacing = 2;
    
    const criticalCount = currentMaintenance.filter(m => m.urgency === 'critical').length;
    const highCount = currentMaintenance.filter(m => m.urgency === 'high').length;
    const completedCount = currentMaintenance.filter(m => m.status === 'completed').length;
    const completionRate = currentMaintenance.length > 0 ? ((completedCount / currentMaintenance.length) * 100).toFixed(1) : 0;
    
    const metrics = [
      { label: 'Total Requests', current: currentMaintenance.length, prev: prevMaintenance.length, color: [59, 130, 246] },
      { label: 'Critical Urgency', current: criticalCount, prev: prevMaintenance.filter(m => m.urgency === 'critical').length, color: [220, 38, 38] },
      { label: 'High Urgency', current: highCount, prev: prevMaintenance.filter(m => m.urgency === 'high').length, color: [251, 146, 60] },
      { label: 'Completion Rate', current: `${completionRate}%`, prev: 'N/A', color: [34, 197, 94] }
    ];

    metrics.forEach((metric, idx) => {
      const x = 15 + idx * (cardWidth + cardSpacing);
      
      doc.setFillColor(...metric.color);
      doc.rect(x, yPos, cardWidth, cardHeight, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(metric.label.toUpperCase(), x + cardWidth / 2, yPos + 7, { align: 'center' });
      
      doc.setFontSize(20);
      doc.text(metric.current.toString(), x + cardWidth / 2, yPos + 18, { align: 'center' });
      
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`Prev: ${metric.prev}`, x + cardWidth / 2, yPos + 25, { align: 'center' });
    });
    
    yPos += cardHeight + 15;

    // COMPARATIVE ANALYSIS
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MAINTENANCE CATEGORIES - MONTH COMPARISON', 15, yPos);
    yPos += 10;

    const allCategories = [...new Set([...Object.keys(maintenanceByCategory), ...Object.keys(prevMaintenanceByCategory)])];

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('Category', 15, yPos);
    doc.text('Current', 70, yPos);
    doc.text('Previous', 100, yPos);
    doc.text('Change', 130, yPos);
    doc.text('Trend', 160, yPos);
    yPos += 5;

    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.5);
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    
    allCategories.forEach(cat => {
      const currentCount = maintenanceByCategory[cat] || 0;
      const prevCount = prevMaintenanceByCategory[cat] || 0;
      const change = calculateChange(currentCount, prevCount);
      const maxCount = Math.max(currentCount, prevCount, 1);
      
      doc.text(cat.replace(/_/g, ' ').substring(0, 18), 15, yPos);
      doc.text(currentCount.toString(), 75, yPos);
      doc.text(prevCount.toString(), 105, yPos);
      doc.text(`${change > 0 ? '+' : ''}${change}%`, 135, yPos);
      
      if (currentCount > prevCount) {
        doc.setTextColor(220, 38, 38);
        doc.text('↑', 165, yPos);
      } else if (currentCount < prevCount) {
        doc.setTextColor(34, 197, 94);
        doc.text('↓', 165, yPos);
      } else {
        doc.setTextColor(100, 100, 100);
        doc.text('→', 165, yPos);
      }
      
      // Visual bars
      doc.setFillColor(59, 130, 246);
      const currentBarWidth = (currentCount / maxCount) * 25;
      doc.rect(80, yPos - 3, currentBarWidth, 4, 'F');
      
      doc.setFillColor(148, 163, 184);
      const prevBarWidth = (prevCount / maxCount) * 25;
      doc.rect(110, yPos - 3, prevBarWidth, 4, 'F');
      
      doc.setTextColor(30, 41, 59);
      yPos += 7;
    });
    yPos += 10;

    // URGENCY BREAKDOWN
    doc.addPage();
    yPos = 20;
    
    doc.setFillColor(59, 130, 246);
    doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MAINTENANCE URGENCY DISTRIBUTION', 20, yPos);
    yPos += 20;

    const urgencies = ['critical', 'high', 'medium', 'low'];
    const urgencyColors = {
      critical: [220, 38, 38],
      high: [251, 146, 60],
      medium: [59, 130, 246],
      low: [34, 197, 94]
    };

    const chartHeight = 80;
    const maxUrgencyCount = Math.max(...urgencies.map(u => maintenanceByUrgency[u] || 0), 1);

    urgencies.forEach((urgency, idx) => {
      const count = maintenanceByUrgency[urgency] || 0;
      const barHeight = (count / maxUrgencyCount) * chartHeight;
      const x = 30 + idx * 40;
      
      doc.setFillColor(...urgencyColors[urgency]);
      doc.rect(x, yPos + chartHeight - barHeight, 30, barHeight, 'F');
      
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(count.toString(), x + 15, yPos + chartHeight - barHeight - 5, { align: 'center' });
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(urgency.toUpperCase(), x + 15, yPos + chartHeight + 8, { align: 'center' });
    });
    
    yPos += chartHeight + 20;

    // STATUS BREAKDOWN
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('MAINTENANCE STATUS OVERVIEW', 15, yPos);
    yPos += 10;

    const statuses = Object.entries(maintenanceByStatus).sort((a, b) => b[1] - a[1]);
    const statusColors = {
      reported: [239, 68, 68],
      assigned: [251, 146, 60],
      in_progress: [59, 130, 246],
      completed: [34, 197, 94],
      cancelled: [148, 163, 184]
    };

    statuses.forEach(([status, count]) => {
      const percentage = ((count / currentMaintenance.length) * 100).toFixed(1);
      const barWidth = (count / currentMaintenance.length) * (pageWidth - 100);
      
      doc.setFillColor(...(statusColors[status] || [100, 100, 100]));
      doc.rect(80, yPos - 4, barWidth, 8, 'F');
      
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(status.replace(/_/g, ' '), 15, yPos);
      doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
      
      yPos += 12;
    });
    yPos += 10;

    // SITE ANALYSIS
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TOP MAINTENANCE LOCATIONS', 15, yPos);
    yPos += 10;

    const topSites = Object.entries(maintenanceBySite).sort((a, b) => b[1] - a[1]).slice(0, 10);

    topSites.forEach(([site, count]) => {
      const percentage = ((count / currentMaintenance.length) * 100).toFixed(1);
      const barWidth = (count / currentMaintenance.length) * (pageWidth - 100);
      
      doc.setFillColor(59, 130, 246);
      doc.rect(80, yPos - 4, barWidth, 8, 'F');
      
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const siteName = site.length > 25 ? site.substring(0, 25) + '...' : site;
      doc.text(siteName, 15, yPos);
      doc.text(`${count} (${percentage}%)`, 85 + barWidth, yPos);
      
      yPos += 10;
    });

    // DETAILED MAINTENANCE LOG
    doc.addPage();
    yPos = 20;
    
    doc.setFillColor(59, 130, 246);
    doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DETAILED MAINTENANCE LOG', 20, yPos);
    yPos += 12;

    currentMaintenance.forEach((maint, idx) => {
      if (yPos > pageHeight - 45) {
        doc.addPage();
        yPos = 20;
      }

      const urgencyColor = urgencyColors[maint.urgency] || [100, 100, 100];
      
      doc.setFillColor(248, 250, 252);
      doc.rect(15, yPos - 5, pageWidth - 30, 38, 'F');
      
      doc.setFillColor(...urgencyColor);
      doc.rect(15, yPos - 5, 3, 38, 'F');
      
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`${idx + 1}. ${maint.title.substring(0, 60)}`, 23, yPos);
      
      doc.setFillColor(...urgencyColor);
      doc.roundedRect(pageWidth - 45, yPos - 4, 28, 6, 1, 1, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.text(maint.urgency.toUpperCase(), pageWidth - 31, yPos + 1, { align: 'center' });
      
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      yPos += 6;
      doc.text(`Category: ${maint.category.replace(/_/g, ' ')} | Status: ${maint.status}`, 23, yPos);
      yPos += 5;
      doc.text(`Site: ${maint.site_name || 'N/A'} | Guard: ${maint.guard_name || 'N/A'}`, 23, yPos);
      yPos += 5;
      doc.text(`Reported: ${new Date(maint.reported_at).toLocaleDateString()}`, 23, yPos);
      yPos += 5;
      const desc = maint.description || 'No description';
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(desc.substring(0, 110) + (desc.length > 110 ? '...' : ''), 23, yPos);
      yPos += 13;
    });

    // RECOMMENDATIONS
    doc.addPage();
    yPos = 20;
    
    doc.setFillColor(59, 130, 246);
    doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('STRATEGIC RECOMMENDATIONS', 20, yPos);
    yPos += 15;

    const recommendations = [
      { text: `Address ${criticalCount} critical maintenance requests requiring immediate action`, priority: 'high' },
      { text: `Review ${highCount} high-urgency maintenance tasks for resource allocation`, priority: 'high' },
      { text: `Top maintenance category (${Object.entries(maintenanceByCategory).sort((a, b) => b[1] - a[1])[0]?.[0]?.replace(/_/g, ' ')}) requires focused planning`, priority: 'high' },
      { text: `Focus on site: ${Object.entries(maintenanceBySite).sort((a, b) => b[1] - a[1])[0]?.[0]} with highest maintenance needs`, priority: 'medium' },
      { text: `Completion rate of ${completionRate}% - evaluate maintenance response efficiency`, priority: 'medium' },
      { text: `Develop preventive maintenance schedules for recurring issues`, priority: 'medium' },
      { text: `Schedule quarterly asset condition reviews with maintenance team`, priority: 'low' }
    ];

    recommendations.forEach((rec, idx) => {
      const bgColor = rec.priority === 'high' ? [254, 226, 226] : rec.priority === 'medium' ? [255, 247, 237] : [240, 253, 244];
      const textColor = rec.priority === 'high' ? [153, 27, 27] : rec.priority === 'medium' ? [154, 52, 18] : [22, 101, 52];
      
      doc.setFillColor(...bgColor);
      doc.rect(15, yPos - 3, pageWidth - 30, 12, 'F');
      
      doc.setTextColor(...textColor);
      doc.text(`${idx + 1}.`, 20, yPos + 4);
      
      const lines = doc.splitTextToSize(rec.text, pageWidth - 50);
      doc.text(lines, 28, yPos + 4);
      yPos += Math.max(12, lines.length * 5 + 4);
    });

    // FOOTER
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      const footerY = pageHeight - 20;
      doc.setFillColor(30, 41, 59);
      doc.rect(0, footerY, pageWidth, 20, 'F');
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(8);
      doc.text('UNIFIED SECURITY SOLUTIONS', pageWidth / 2, footerY + 8, { align: 'center' });
      doc.text(`Report Generated: ${new Date().toLocaleString()} | Page ${i} of ${totalPages}`, pageWidth / 2, footerY + 14, { align: 'center' });
    }

    const pdfBytes = doc.output('arraybuffer');
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfFile = new File([pdfBlob], `Monthly_Maintenance_Report_${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).replace(' ', '_')}.pdf`);
    const { file_url: pdfUrl } = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });

    return Response.json({ 
      success: true,
      pdfUrl: pdfUrl,
      period: currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      totalMaintenance: currentMaintenance.length,
      criticalMaintenance: criticalCount,
      highUrgencyMaintenance: highCount,
      completionRate: completionRate
    });
  } catch (error) {
    console.error('Error generating monthly maintenance report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});