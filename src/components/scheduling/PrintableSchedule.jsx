import React from "react";
import { Badge } from "@/components/ui/badge";

export default function PrintableSchedule({ shifts, guards, month, year }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const statusColors = {
    scheduled: "#0ea5e9",
    open: "#f59e0b",
    accepted: "#a855f7",
    active: "#10b981",
    completed: "#22c55e",
    missed: "#f43f5e",
    cancelled: "#ef4444"
  };

  // Group shifts by guard
  const shiftsByGuard = {};
  guards.forEach(guard => {
    shiftsByGuard[guard.id] = {
      name: guard.full_name,
      shifts: shifts.filter(s => s.guard_id === guard.id)
    };
  });

  const getShiftsForDay = (guardId, day) => {
    const dayStart = new Date(year, month, day, 0, 0, 0);
    const dayEnd = new Date(year, month, day, 23, 59, 59);
    
    return shifts.filter(s => {
      const shiftStart = new Date(s.start_time);
      return s.guard_id === guardId && 
             shiftStart >= dayStart && 
             shiftStart <= dayEnd;
    });
  };

  return (
    <div className="printable-schedule" style={{ 
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: 'white',
      color: 'black'
    }}>
      <style>{`
        @media print {
          @page { 
            size: landscape; 
            margin: 0.5cm;
          }
          body { 
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .printable-schedule {
            page-break-after: avoid;
          }
          .no-print {
            display: none !important;
          }
        }
        
        .calendar-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        
        .calendar-table th,
        .calendar-table td {
          border: 1px solid #ddd;
          padding: 8px;
          text-align: center;
          vertical-align: top;
        }
        
        .calendar-table th {
          background-color: #1e293b;
          color: white;
          font-weight: bold;
          padding: 12px;
        }
        
        .calendar-table .guard-name {
          background-color: #334155;
          color: white;
          font-weight: bold;
          text-align: left;
          padding: 10px;
          position: sticky;
          left: 0;
        }
        
        .calendar-table .day-header {
          background-color: #475569;
          color: white;
          font-size: 12px;
        }
        
        .shift-cell {
          min-height: 40px;
          position: relative;
        }
        
        .shift-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 10px;
          margin: 2px;
          color: white;
          font-weight: bold;
        }
        
        .header-section {
          text-align: center;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 3px solid #1e293b;
        }
        
        .header-section h1 {
          font-size: 28px;
          margin: 0 0 10px 0;
          color: #1e293b;
        }
        
        .header-section p {
          font-size: 14px;
          color: #64748b;
          margin: 5px 0;
        }
        
        .legend {
          margin-top: 20px;
          padding: 15px;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
        }
        
        .legend-title {
          font-weight: bold;
          margin-bottom: 10px;
          color: #1e293b;
        }
        
        .legend-items {
          display: flex;
          flex-wrap: wrap;
          gap: 15px;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .legend-color {
          width: 30px;
          height: 15px;
          border-radius: 3px;
        }
      `}</style>

      <div className="header-section">
        <h1>SecureGuard Shift Schedule</h1>
        <p style={{ fontSize: '18px', fontWeight: 'bold', color: '#334155' }}>
          {monthNames[month]} {year}
        </p>
        <p>Generated on: {new Date().toLocaleDateString()} at {new Date().toLocaleTimeString()}</p>
        <p>Total Guards: {guards.length} | Total Shifts: {shifts.filter(s => {
          const shiftMonth = new Date(s.start_time).getMonth();
          const shiftYear = new Date(s.start_time).getFullYear();
          return shiftMonth === month && shiftYear === year;
        }).length}</p>
      </div>

      <table className="calendar-table">
        <thead>
          <tr>
            <th style={{ width: '150px' }}>Guard Name</th>
            {Array.from({ length: daysInMonth }, (_, i) => (
              <th key={i} className="day-header">
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {guards.map(guard => (
            <tr key={guard.id}>
              <td className="guard-name">
                {guard.full_name}
                <br />
                <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#cbd5e1' }}>
                  {guard.badge_number}
                </span>
              </td>
              {Array.from({ length: daysInMonth }, (_, day) => {
                const dayShifts = getShiftsForDay(guard.id, day + 1);
                return (
                  <td key={day} className="shift-cell">
                    {dayShifts.map(shift => (
                      <div
                        key={shift.id}
                        className="shift-badge"
                        style={{ 
                          backgroundColor: statusColors[shift.status] || '#64748b',
                          fontSize: '9px',
                          display: 'block',
                          margin: '2px 0'
                        }}
                      >
                        {new Date(shift.start_time).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false
                        })}
                        <br />
                        <span style={{ fontSize: '8px' }}>
                          {shift.site_name?.substring(0, 10)}
                        </span>
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
        <div className="legend-title">Status Legend:</div>
        <div className="legend-items">
          {Object.entries(statusColors).map(([status, color]) => (
            <div key={status} className="legend-item">
              <div className="legend-color" style={{ backgroundColor: color }} />
              <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>
                {status.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}