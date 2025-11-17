import React from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, startOfWeek, endOfWeek } from "date-fns";

export default function PrintableSchedule({ shifts = [], guards = [], month, year, siteName }) {
  const monthStart = startOfMonth(new Date(year, month));
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getShiftsForDay = (date) => {
    return (shifts || []).filter((shift) => {
      const shiftDate = new Date(shift.start_time);
      return (
        shiftDate.getDate() === date.getDate() &&
        shiftDate.getMonth() === date.getMonth() &&
        shiftDate.getFullYear() === date.getFullYear()
      );
    });
  };

  const statusColors = {
    scheduled: "#3b82f6",
    active: "#10b981",
    completed: "#6b7280",
    missed: "#ef4444",
    cancelled: "#f59e0b"
  };

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const stats = {
    total: (shifts || []).length,
    guards: new Set((shifts || []).map(s => s.guard_id)).size,
    active: (shifts || []).filter(s => s.status === 'active').length
  };

  return (
    <div className="print-container">
      <style>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }
          
          body {
            margin: 0;
            padding: 0;
            background: white !important;
          }

          /* Hide everything except print container */
          body > div:not(.print-wrapper) {
            display: none !important;
          }

          header, nav, aside, footer, .no-print {
            display: none !important;
          }

          .print-wrapper {
            display: block !important;
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }

          .print-container {
            width: 100%;
            height: 100%;
            padding: 0;
            margin: 0;
            font-family: Arial, sans-serif;
            page-break-after: avoid;
          }

          .header {
            text-align: center;
            margin-bottom: 8mm;
            padding-bottom: 4mm;
            border-bottom: 2px solid #1e293b;
          }

          .header h1 {
            font-size: 18pt;
            font-weight: bold;
            color: #0f172a;
            margin: 0 0 2mm 0;
          }

          .header-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 3mm;
            font-size: 9pt;
            color: #475569;
          }

          .stats {
            display: flex;
            gap: 8mm;
          }

          .stat-item {
            display: flex;
            align-items: center;
            gap: 2mm;
          }

          .calendar-grid {
            width: 100%;
            border-collapse: collapse;
            background: white;
          }

          .calendar-grid th {
            background: #1e293b;
            color: white;
            font-weight: 600;
            font-size: 9pt;
            padding: 3mm;
            text-align: center;
            border: 1px solid #94a3b8;
          }

          .calendar-grid td {
            border: 1px solid #cbd5e1;
            vertical-align: top;
            padding: 2mm;
            height: 22mm;
            width: 14.28%;
            background: white;
          }

          .day-number {
            font-weight: 600;
            font-size: 9pt;
            color: #0f172a;
            margin-bottom: 1mm;
          }

          .other-month .day-number {
            color: #94a3b8;
          }

          .shift-badge {
            font-size: 6pt;
            padding: 1mm 1.5mm;
            margin: 0.5mm 0;
            border-radius: 1mm;
            color: white;
            font-weight: 500;
            display: block;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .legend {
            display: flex;
            justify-content: center;
            gap: 6mm;
            margin-top: 4mm;
            padding-top: 3mm;
            border-top: 1px solid #cbd5e1;
            font-size: 7pt;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 1.5mm;
          }

          .legend-color {
            width: 3mm;
            height: 3mm;
            border-radius: 0.5mm;
          }
        }

        /* Screen styles */
        @media screen {
          .print-container {
            background: white;
            padding: 20px;
            max-width: 1400px;
            margin: 0 auto;
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
          }

          .header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 3px solid #1e293b;
          }

          .header h1 {
            font-size: 28px;
            font-weight: bold;
            color: #0f172a;
            margin: 0 0 10px 0;
          }

          .header-info {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 15px;
            font-size: 14px;
            color: #475569;
          }

          .stats {
            display: flex;
            gap: 30px;
          }

          .stat-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .calendar-grid {
            width: 100%;
            border-collapse: collapse;
            background: white;
          }

          .calendar-grid th {
            background: #1e293b;
            color: white;
            font-weight: 600;
            font-size: 14px;
            padding: 12px;
            text-align: center;
            border: 1px solid #94a3b8;
          }

          .calendar-grid td {
            border: 1px solid #cbd5e1;
            vertical-align: top;
            padding: 8px;
            min-height: 100px;
            height: 100px;
            background: white;
          }

          .day-number {
            font-weight: 600;
            font-size: 14px;
            color: #0f172a;
            margin-bottom: 4px;
          }

          .other-month {
            background: #f8fafc;
          }

          .other-month .day-number {
            color: #94a3b8;
          }

          .shift-badge {
            font-size: 10px;
            padding: 3px 6px;
            margin: 2px 0;
            border-radius: 3px;
            color: white;
            font-weight: 500;
            display: block;
            text-align: center;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .legend {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 2px solid #cbd5e1;
            font-size: 12px;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .legend-color {
            width: 16px;
            height: 16px;
            border-radius: 3px;
          }
        }
      `}</style>

      <div className="header">
        <h1>Guard Schedule - {siteName || 'All Sites'}</h1>
        <div className="header-info">
          <div className="stats">
            <div className="stat-item">
              <strong>Total Shifts:</strong> {stats.total}
            </div>
            <div className="stat-item">
              <strong>Guards:</strong> {stats.guards}
            </div>
            <div className="stat-item">
              <strong>Active:</strong> {stats.active}
            </div>
          </div>
          <div>
            <strong>{format(monthStart, 'MMMM yyyy')}</strong>
          </div>
        </div>
      </div>

      <table className="calendar-grid">
        <thead>
          <tr>
            <th>Sunday</th>
            <th>Monday</th>
            <th>Tuesday</th>
            <th>Wednesday</th>
            <th>Thursday</th>
            <th>Friday</th>
            <th>Saturday</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((day, dayIndex) => {
                const dayShifts = getShiftsForDay(day);
                const isOtherMonth = day.getMonth() !== month;
                
                return (
                  <td key={dayIndex} className={isOtherMonth ? 'other-month' : ''}>
                    <div className="day-number">{day.getDate()}</div>
                    {dayShifts.map((shift, shiftIndex) => (
                      <div
                        key={shiftIndex}
                        className="shift-badge"
                        style={{ backgroundColor: statusColors[shift.status] || '#64748b' }}
                      >
                        {shift.guard_name?.split(' ')[0] || 'Guard'}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="legend">
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: statusColors.scheduled }} />
          <span>Scheduled</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: statusColors.active }} />
          <span>Active</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: statusColors.completed }} />
          <span>Completed</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: statusColors.missed }} />
          <span>Missed</span>
        </div>
        <div className="legend-item">
          <div className="legend-color" style={{ backgroundColor: statusColors.cancelled }} />
          <span>Cancelled</span>
        </div>
      </div>
    </div>
  );
}