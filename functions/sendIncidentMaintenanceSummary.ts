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

    // Generate PDF Report
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let yPos = 20;

    // Header with logo placeholder
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('UNIFIED SECURITY SOLUTIONS', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(12);
    doc.text('Professional Security Management', pageWidth / 2, 22, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Incident & Maintenance Summary Report', pageWidth / 2, 29, { align: 'center' });

    // Red line separator
    doc.setDrawColor(220, 38, 38);
    doc.setLineWidth(2);
    doc.line(0, 35, pageWidth, 35);

    yPos = 45;

    // Report Title
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Report Period: ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, 15, yPos);
    yPos += 15;

    // Executive Summary Box
    doc.setFillColor(241, 245, 249);
    doc.rect(15, yPos, pageWidth - 30, 30, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('EXECUTIVE SUMMARY', 20, yPos + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Total Incidents: ${currentIncidents.length} | Total Maintenance: ${currentMaintenance.length}`, 20, yPos + 16);
    doc.text(`vs Previous Month: Incidents ${prevIncidents.length} (${incidentChange > 0 ? '+' : ''}${incidentChange}%) | Maintenance ${prevMaintenance.length} (${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}%)`, 20, yPos + 23);
    yPos += 40;

    // Monthly Overview
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MONTHLY OVERVIEW', 15, yPos);
    yPos += 8;

    const metrics = [
      ['Total Incidents', currentIncidents.length.toString(), prevIncidents.length.toString(), `${incidentChange > 0 ? '+' : ''}${incidentChange}%`],
      ['Critical Incidents', currentIncidents.filter(i => i.priority === 'critical').length.toString(), prevIncidents.filter(i => i.priority === 'critical').length.toString(), '-'],
      ['Total Maintenance', currentMaintenance.length.toString(), prevMaintenance.length.toString(), `${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}%`],
      ['Urgent Maintenance', currentMaintenance.filter(m => m.urgency === 'critical' || m.urgency === 'high').length.toString(), '-', '-']
    ];

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Metric', 15, yPos);
    doc.text('Current', 80, yPos);
    doc.text('Previous', 120, yPos);
    doc.text('Change', 160, yPos);
    yPos += 5;

    doc.setDrawColor(220, 38, 38);
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 5;

    doc.setFont('helvetica', 'normal');
    metrics.forEach(row => {
      doc.text(row[0], 15, yPos);
      doc.text(row[1], 80, yPos);
      doc.text(row[2], 120, yPos);
      doc.text(row[3], 160, yPos);
      yPos += 6;
    });
    yPos += 5;

    // Category Breakdown - Incidents
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('INCIDENT CATEGORY BREAKDOWN', 15, yPos);
    yPos += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    Object.entries(incidentsByCategory).forEach(([cat, count]) => {
      doc.text(`${cat.replace(/_/g, ' ')}: ${count}`, 20, yPos);
      yPos += 6;
    });
    yPos += 5;

    // Category Breakdown - Maintenance
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('MAINTENANCE CATEGORY BREAKDOWN', 15, yPos);
    yPos += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    Object.entries(maintenanceByCategory).forEach(([cat, count]) => {
      doc.text(`${cat.replace(/_/g, ' ')}: ${count}`, 20, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Detailed Incident Log
    if (currentIncidents.length > 0) {
      doc.addPage();
      yPos = 20;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('DETAILED INCIDENT LOG', 15, yPos);
      yPos += 10;

      currentIncidents.forEach((incident, idx) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos - 5, pageWidth - 30, 35, 'F');
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${incident.title}`, 20, yPos);
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        yPos += 6;
        doc.text(`Priority: ${incident.priority} | Category: ${incident.category.replace(/_/g, ' ')} | Status: ${incident.status}`, 20, yPos);
        yPos += 5;
        doc.text(`Site: ${incident.site_name || 'N/A'} | Guard: ${incident.guard_name || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Reported: ${new Date(incident.reported_at).toLocaleDateString()}`, 20, yPos);
        yPos += 5;
        const desc = incident.description || 'No description';
        doc.text(`Description: ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`, 20, yPos);
        yPos += 12;
      });
    }

    // Detailed Maintenance Log
    if (currentMaintenance.length > 0) {
      doc.addPage();
      yPos = 20;
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('DETAILED MAINTENANCE LOG', 15, yPos);
      yPos += 10;

      currentMaintenance.forEach((maint, idx) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFillColor(248, 250, 252);
        doc.rect(15, yPos - 5, pageWidth - 30, 35, 'F');
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(`${idx + 1}. ${maint.title}`, 20, yPos);
        
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        yPos += 6;
        doc.text(`Urgency: ${maint.urgency} | Category: ${maint.category.replace(/_/g, ' ')} | Status: ${maint.status}`, 20, yPos);
        yPos += 5;
        doc.text(`Site: ${maint.site_name || 'N/A'} | Guard: ${maint.guard_name || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Reported: ${new Date(maint.reported_at).toLocaleDateString()}`, 20, yPos);
        yPos += 5;
        const desc = maint.description || 'No description';
        doc.text(`Description: ${desc.substring(0, 100)}${desc.length > 100 ? '...' : ''}`, 20, yPos);
        yPos += 12;
      });
    }

    // Action Items Page
    doc.addPage();
    yPos = 20;
    doc.setFillColor(254, 242, 242);
    doc.rect(15, yPos - 5, pageWidth - 30, 50, 'F');
    doc.setTextColor(153, 27, 27);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('ACTION ITEMS FOR ESTATE MANAGEMENT', 20, yPos);
    yPos += 10;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const actionItems = [
      `Review ${currentIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').length} high-priority incidents`,
      `${currentMaintenance.filter(m => m.status !== 'completed').length} pending maintenance requests require scheduling`,
      `Focus areas: ${Object.entries(incidentsByCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, count]) => `${cat} (${count})`).join(', ')}`,
      'Review guard reports for patterns and additional context',
      'Consider additional security measures at high-incident sites'
    ];

    actionItems.forEach(item => {
      doc.text(`• ${item}`, 20, yPos);
      yPos += 6;
    });

    // Footer
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });

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