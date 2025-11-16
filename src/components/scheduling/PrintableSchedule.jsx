import React from "react";

export default function PrintableSchedule({ shifts = [], guards = [], month, year }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const statusColors = {
    scheduled: "#0ea5e9",
    open: "#f59e0b", 
    accepted: "#a855f7",
    active: "#10b981",
    completed: "#64748b",
    missed: "#ef4444",
    cancelled: "#7c2d12"
  };

  const getShiftsForDay = (day) => {
    const dayStart = new Date(year, month, day, 0, 0, 0);
    const dayEnd = new Date(year, month, day, 23, 59, 59);
    
    return shifts.filter(s => {
      if (!s || !s.start_time) return false;
      const shiftStart = new Date(s.start_time);
      return shiftStart >= dayStart && shiftStart <= dayEnd;
    });
  };

  // Create calendar grid
  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) {
    calendarDays.push(null); // Empty cells before month starts
  }
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  // Organize into weeks
  const weeks = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  const monthShifts = shifts.filter(s => {
    if (!s || !s.start_time) return false;
    const shiftMonth = new Date(s.start_time).getMonth();
    const shiftYear = new Date(s.start_time).getFullYear();
    return shiftMonth === month && shiftYear === year;
  });

  return (
    <div style={{ 
      padding: '30px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#0f172a',
      color: 'white',
      minHeight: '100vh'
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
            background-color: #0f172a !important;
          }
          .no-print {
            display: none !important;
          }
        }
        
        .calendar-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 30px;
        }
        
        .calendar-icon {
          width: 32px;
          height: 32px;
          background-color: #0ea5e9;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        }
        
        .month-title {
          font-size: 24px;
          font-weight: bold;
          color: white;
        }
        
        .day-names {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 8px;
          margin-bottom: 8px;
        }
        
        .day-name {
          text-align: center;
          font-size: 13px;
          color: #94a3b8;
          padding: 12px 0;
          font-weight: 500;
        }
        
        .calendar-grid {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 8px;
        }
        
        .calendar-cell {
          background-color: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          min-height: 100px;
          padding: 12px;
          position: relative;
        }
        
        .calendar-cell.empty {
          background-color: transparent;
          border: none;
        }
        
        .day-number {
          font-size: 14px;
          color: #e2e8f0;
          margin-bottom: 8px;
          font-weight: 500;
        }
        
        .shift-badge {
          background-color: #0ea5e9;
          color: white;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 11px;
          margin-bottom: 4px;
          display: block;
          font-weight: 600;
          text-align: center;
        }
        
        .legend {
          margin-top: 30px;
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
          align-items: center;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        
        .legend-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        
        .stats {
          margin-top: 20px;
          padding: 20px;
          background-color: #1e293b;
          border-radius: 12px;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }
        
        .stat-item {
          text-align: center;
        }
        
        .stat-value {
          font-size: 32px;
          font-weight: bold;
          color: white;
          display: block;
        }
        
        .stat-label {
          font-size: 13px;
          color: #94a3b8;
          margin-top: 4px;
        }
      `}</style>

      <div className="calendar-header">
        <div className="calendar-icon">📅</div>
        <span className="month-title">{monthNames[month]} {year}</span>
      </div>

      <div className="day-names">
        {dayNames.map(day => (
          <div key={day} className="day-name">{day}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {weeks.map((week, weekIdx) => (
          week.map((day, dayIdx) => {
            if (!day) {
              return <div key={`empty-${weekIdx}-${dayIdx}`} className="calendar-cell empty" />;
            }

            const dayShifts = getShiftsForDay(day);
            
            return (
              <div key={`${weekIdx}-${dayIdx}`} className="calendar-cell">
                <div className="day-number">{day}</div>
                {dayShifts.map(shift => (
                  <div
                    key={shift.id}
                    className="shift-badge"
                    style={{ backgroundColor: statusColors[shift.status] || '#64748b' }}
                  >
                    {shift.guard_name || 'Unassigned'}
                  </div>
                ))}
              </div>
            );
          })
        ))}
      </div>

      <div className="legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: statusColors.scheduled }} />
          <span>Scheduled</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: statusColors.active }} />
          <span>Active</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: statusColors.open }} />
          <span>Open</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: statusColors.completed }} />
          <span>Completed</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ backgroundColor: statusColors.missed }} />
          <span>Missed</span>
        </div>
      </div>

      <div className="stats no-print">
        <div className="stat-item">
          <span className="stat-value">{monthShifts.length}</span>
          <div className="stat-label">Total Shifts</div>
        </div>
        <div className="stat-item">
          <span className="stat-value">{guards.length}</span>
          <div className="stat-label">Guards</div>
        </div>
        <div className="stat-item">
          <span className="stat-value">
            {monthShifts.filter(s => s.status === 'active').length}
          </span>
          <div className="stat-label">Active Now</div>
        </div>
      </div>
    </div>
  );
}