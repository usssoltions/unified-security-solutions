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

    const [incidents, maintenance] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({})
    ]);

    // Filter out any non-incident categories (start of shift reports should use ShiftHandover entity)
    const validIncidentCategories = ['fire', 'theft', 'vandalism', 'medical', 'trespassing', 'suspicious_activity', 'equipment_failure', 'safety_hazard', 'other'];
    
    const currentIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      const isValidCategory = validIncidentCategories.includes(i.category);
      return date >= currentMonthStart && date <= currentMonthEnd && isValidCategory;
    });
    
    const currentMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    const prevIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      const isValidCategory = validIncidentCategories.includes(i.category);
      return date >= prevMonthStart && date <= prevMonthEnd && isValidCategory;
    });
    
    const prevMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });

    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    const incidentChange = calculateChange(currentIncidents.length, prevIncidents.length);
    const maintenanceChange = calculateChange(currentMaintenance.length, prevMaintenance.length);

    // Group by category
    const incidentsByCategory = currentIncidents.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {});

    const maintenanceByCategory = currentMaintenance.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {});

    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    );

    const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/45d7f532d_ubsnew.png';

    // Generate PDF Report with enhanced visuals
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let yPos = 20;

    // BRANDED HEADER - Dark blue with red accent
    doc.setFillColor(30, 41, 59); // Dark navy
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    // Red accent bar
    doc.setFillColor(220, 38, 38); // Red
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
    doc.text('INCIDENT & MAINTENANCE ANALYSIS', pageWidth / 2, 35, { align: 'center' });

    yPos = 55;

    // Report Period with styling
    doc.setFillColor(248, 250, 252);
    doc.rect(15, yPos, pageWidth - 30, 12, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`Reporting Period: ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, pageWidth / 2, yPos + 8, { align: 'center' });
    yPos += 20;

    // KEY METRICS CARDS - Visual dashboard
    const cardWidth = (pageWidth - 40) / 4;
    const cardHeight = 28;
    const cardSpacing = 2;
    
    const metrics = [
      { label: 'Total Incidents', current: currentIncidents.length, prev: prevIncidents.length, change: incidentChange, color: [220, 38, 38] },
      { label: 'Critical', current: currentIncidents.filter(i => i.priority === 'critical').length, prev: prevIncidents.filter(i => i.priority === 'critical').length, change: 0, color: [239, 68, 68] },
      { label: 'Maintenance', current: currentMaintenance.length, prev: prevMaintenance.length, change: maintenanceChange, color: [59, 130, 246] },
      { label: 'Urgent Tasks', current: currentMaintenance.filter(m => m.urgency === 'critical' || m.urgency === 'high').length, prev: 0, change: 0, color: [251, 146, 60] }
    ];

    metrics.forEach((metric, idx) => {
      const x = 15 + idx * (cardWidth + cardSpacing);
      
      // Card background
      doc.setFillColor(...metric.color);
      doc.rect(x, yPos, cardWidth, cardHeight, 'F');
      
      // White text
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(metric.label.toUpperCase(), x + cardWidth / 2, yPos + 6, { align: 'center' });
      
      doc.setFontSize(20);
      doc.text(metric.current.toString(), x + cardWidth / 2, yPos + 17, { align: 'center' });
      
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(`Prev: ${metric.prev}`, x + cardWidth / 2, yPos + 23, { align: 'center' });
    });
    
    yPos += cardHeight + 15;

    // COMPARATIVE ANALYSIS - Incident Types by Month
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('COMPARATIVE ANALYSIS - INCIDENT TYPES', 15, yPos);
    yPos += 10;

    // Get all unique categories
    const allCategories = [...new Set([...Object.keys(incidentsByCategory), ...Object.keys(prevIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {}))])];
    const prevIncidentsByCategory = prevIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {});

    // Comparison table with bars
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('Category', 15, yPos);
    doc.text('Current', 80, yPos);
    doc.text('Previous', 120, yPos);
    doc.text('Trend', 160, yPos);
    yPos += 5;

    doc.setDrawColor(220, 38, 38);
    doc.setLineWidth(0.5);
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    
    allCategories.forEach(cat => {
      const currentCount = incidentsByCategory[cat] || 0;
      const prevCount = prevIncidentsByCategory[cat] || 0;
      const maxCount = Math.max(currentCount, prevCount, 1);
      
      doc.text(cat.replace(/_/g, ' ').substring(0, 20), 15, yPos);
      doc.text(currentCount.toString(), 85, yPos);
      doc.text(prevCount.toString(), 125, yPos);
      
      // Trend indicator
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
      const currentBarWidth = (currentCount / maxCount) * 30;
      doc.rect(95, yPos - 3, currentBarWidth, 4, 'F');
      
      doc.setFillColor(148, 163, 184);
      const prevBarWidth = (prevCount / maxCount) * 30;
      doc.rect(135, yPos - 3, prevBarWidth, 4, 'F');
      
      doc.setTextColor(30, 41, 59);
      yPos += 7;
    });
    yPos += 10;

    // MAINTENANCE COMPARISON
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('COMPARATIVE ANALYSIS - MAINTENANCE TYPES', 15, yPos);
    yPos += 10;

    const allMaintenanceCategories = [...new Set([...Object.keys(maintenanceByCategory), ...Object.keys(prevMaintenance.reduce((acc, m) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {}))])];
    const prevMaintenanceByCategory = prevMaintenance.reduce((acc, m) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {});

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 100, 100);
    doc.text('Category', 15, yPos);
    doc.text('Current', 80, yPos);
    doc.text('Previous', 120, yPos);
    doc.text('Trend', 160, yPos);
    yPos += 5;

    doc.setDrawColor(59, 130, 246);
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    
    allMaintenanceCategories.forEach(cat => {
      const currentCount = maintenanceByCategory[cat] || 0;
      const prevCount = prevMaintenanceByCategory[cat] || 0;
      const maxCount = Math.max(currentCount, prevCount, 1);
      
      doc.text(cat.replace(/_/g, ' ').substring(0, 20), 15, yPos);
      doc.text(currentCount.toString(), 85, yPos);
      doc.text(prevCount.toString(), 125, yPos);
      
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
      
      doc.setFillColor(59, 130, 246);
      const currentBarWidth = (currentCount / maxCount) * 30;
      doc.rect(95, yPos - 3, currentBarWidth, 4, 'F');
      
      doc.setFillColor(148, 163, 184);
      const prevBarWidth = (prevCount / maxCount) * 30;
      doc.rect(135, yPos - 3, prevBarWidth, 4, 'F');
      
      doc.setTextColor(30, 41, 59);
      yPos += 7;
    });
    yPos += 10;

    // DETAILED INCIDENT LOG with color coding
    if (currentIncidents.length > 0) {
      doc.addPage();
      yPos = 20;
      
      // Section header with red background
      doc.setFillColor(220, 38, 38);
      doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('DETAILED INCIDENT LOG', 20, yPos);
      yPos += 12;

      currentIncidents.forEach((incident, idx) => {
        if (yPos > pageHeight - 45) {
          doc.addPage();
          yPos = 20;
        }

        // Color-coded left border based on priority
        const priorityColors = {
          critical: [220, 38, 38],
          high: [251, 146, 60],
          medium: [59, 130, 246],
          low: [34, 197, 94]
        };
        const borderColor = priorityColors[incident.priority] || [100, 100, 100];
        
        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos - 5, pageWidth - 30, 38, 'F');
        
        doc.setFillColor(...borderColor);
        doc.rect(15, yPos - 5, 3, 38, 'F');
        
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${incident.title.substring(0, 60)}`, 23, yPos);
        
        // Priority badge
        doc.setFillColor(...borderColor);
        doc.roundedRect(pageWidth - 45, yPos - 4, 28, 6, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.text(incident.priority.toUpperCase(), pageWidth - 31, yPos + 1, { align: 'center' });
        
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        yPos += 6;
        doc.text(`Category: ${incident.category.replace(/_/g, ' ')} | Status: ${incident.status}`, 23, yPos);
        yPos += 5;
        doc.text(`Site: ${incident.site_name || 'N/A'} | Guard: ${incident.guard_name || 'N/A'}`, 23, yPos);
        yPos += 5;
        doc.text(`Reported: ${new Date(incident.reported_at).toLocaleDateString()}`, 23, yPos);
        yPos += 5;
        const desc = incident.description || 'No description';
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text(desc.substring(0, 110) + (desc.length > 110 ? '...' : ''), 23, yPos);
        yPos += 13;
      });
    }

    // DETAILED MAINTENANCE LOG with color coding
    if (currentMaintenance.length > 0) {
      doc.addPage();
      yPos = 20;
      
      // Section header with blue background
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

        const urgencyColors = {
          critical: [220, 38, 38],
          high: [251, 146, 60],
          medium: [59, 130, 246],
          low: [34, 197, 94]
        };
        const borderColor = urgencyColors[maint.urgency] || [100, 100, 100];
        
        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos - 5, pageWidth - 30, 38, 'F');
        
        doc.setFillColor(...borderColor);
        doc.rect(15, yPos - 5, 3, 38, 'F');
        
        doc.setTextColor(30, 41, 59);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${maint.title.substring(0, 60)}`, 23, yPos);
        
        doc.setFillColor(...borderColor);
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
    }

    // ACTION ITEMS PAGE - Enhanced visual
    doc.addPage();
    yPos = 20;
    
    // Red header bar
    doc.setFillColor(220, 38, 38);
    doc.rect(15, yPos - 8, pageWidth - 30, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('STRATEGIC RECOMMENDATIONS', 20, yPos);
    yPos += 15;

    // Action items with icons (using bullets and color coding)
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const actionItems = [
      { text: `Review ${currentIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').length} high-priority incidents - Implement preventive measures`, priority: 'high' },
      { text: `${currentMaintenance.filter(m => m.status !== 'completed').length} pending maintenance requests require immediate scheduling`, priority: 'high' },
      { text: `Focus areas identified: ${Object.entries(incidentsByCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, count]) => cat.replace(/_/g, ' ')).join(', ')}`, priority: 'medium' },
      { text: 'Analyze guard reports for recurring patterns and trends', priority: 'medium' },
      { text: 'Evaluate need for enhanced security measures at high-incident locations', priority: 'medium' },
      { text: 'Schedule board review of comparative month-over-month trends', priority: 'low' }
    ];

    actionItems.forEach((item, idx) => {
      const bgColor = item.priority === 'high' ? [254, 226, 226] : item.priority === 'medium' ? [255, 247, 237] : [240, 253, 244];
      const textColor = item.priority === 'high' ? [153, 27, 27] : item.priority === 'medium' ? [154, 52, 18] : [22, 101, 52];
      
      doc.setFillColor(...bgColor);
      doc.rect(15, yPos - 3, pageWidth - 30, 12, 'F');
      
      doc.setTextColor(...textColor);
      doc.text(`${idx + 1}.`, 20, yPos + 4);
      
      const lines = doc.splitTextToSize(item.text, pageWidth - 50);
      doc.text(lines, 28, yPos + 4);
      yPos += Math.max(12, lines.length * 5 + 4);
    });

    // Footer with branding
    yPos = pageHeight - 20;
    doc.setFillColor(30, 41, 59);
    doc.rect(0, yPos, pageWidth, 20, 'F');
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.text('UNIFIED SECURITY SOLUTIONS', pageWidth / 2, yPos + 8, { align: 'center' });
    doc.text(`Report Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPos + 14, { align: 'center' });

    const pdfBytes = doc.output('arraybuffer');
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

    // Upload PDF to get a URL
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfFile = new File([pdfBlob], `Incident_Maintenance_Report_${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).replace(' ', '_')}.pdf`);
    const { file_url: pdfUrl } = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });

    const emailPromises = recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'Unified Security Solutions',
        to: recipient.email,
        subject: `Board Report: Incident & Maintenance Summary - ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        body: `
<p>Dear Board Member,</p>

<p>Please find attached the <strong>Incident & Maintenance Summary Report</strong> for ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.</p>

<p><strong>Report Highlights:</strong></p>
<ul>
  <li>Total Incidents: ${currentIncidents.length} (${incidentChange > 0 ? '+' : ''}${incidentChange}% vs previous month)</li>
  <li>Critical Incidents: ${currentIncidents.filter(i => i.priority === 'critical').length}</li>
  <li>Total Maintenance Requests: ${currentMaintenance.length} (${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}% vs previous month)</li>
  <li>Urgent Maintenance: ${currentMaintenance.filter(m => m.urgency === 'critical' || m.urgency === 'high').length}</li>
</ul>

<p>The attached PDF contains detailed incident and maintenance logs, category breakdowns, and actionable recommendations for estate management.</p>

<p><strong>Download Report:</strong> <a href="${pdfUrl}">Click here to download PDF</a></p>

<p>Best regards,<br>
<strong>Unified Security Solutions</strong><br>
Professional Security Management</p>
        `
      })
    );

    await Promise.all(emailPromises);

    return Response.json({ 
      success: true, 
      reportsSent: recipients.length,
      period: currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      incidents: currentIncidents.length,
      maintenance: currentMaintenance.length
    });
  } catch (error) {
    console.error('Error generating incident/maintenance summary:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});