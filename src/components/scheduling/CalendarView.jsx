import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// Badge is no longer used, so it's removed from imports
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CalendarView({ shifts, onDateSelect, onShiftClick, currentMonth, currentYear, onMonthChange }) {
  const [currentDate, setCurrentDate] = React.useState(new Date(currentYear, currentMonth, 1));

  // Sync with parent month/year
  React.useEffect(() => {
    setCurrentDate(new Date(currentYear, currentMonth, 1));
  }, [currentMonth, currentYear]);

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay(); // This corresponds to firstDayOfWeek in the outline

    return { daysInMonth, startingDayOfWeek };
  };

  const getShiftsForDate = (date) => {
    return shifts.filter(shift => {
      const shiftDate = new Date(shift.start_time);
      return shiftDate.toDateString() === date.toDateString();
    });
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);

  // Define month and day names
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const previousMonth = () => {
    const newDate = new Date(currentYear, currentMonth - 1, 1);
    setCurrentDate(newDate);
    onMonthChange && onMonthChange(newDate.getMonth(), newDate.getFullYear());
  };

  const nextMonth = () => {
    const newDate = new Date(currentYear, currentMonth + 1, 1);
    setCurrentDate(newDate);
    onMonthChange && onMonthChange(newDate.getMonth(), newDate.getFullYear());
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    onMonthChange && onMonthChange(today.getMonth(), today.getFullYear());
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-sky-400" />
            {monthNames[currentMonth]} {currentYear}
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={previousMonth}
              className="border-slate-600 text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={goToToday}
              className="border-slate-600 text-slate-300"
            >
              Today
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={nextMonth}
              className="border-slate-600 text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid grid-cols-7 gap-2">
          {/* Day headers */}
          {dayNames.map(day => (
            <div key={day} className="text-center text-xs font-semibold text-slate-400 py-2">
              {day}
            </div>
          ))}

          {/* Empty cells for days before month starts */}
          {Array.from({ length: startingDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const date = new Date(currentYear, currentMonth, day);
            const dayShifts = getShiftsForDate(date);
            const isToday = date.toDateString() === new Date().toDateString();

            return (
              <div
                key={day}
                onClick={() => onDateSelect && onDateSelect(date)}
                className={`aspect-square p-2 rounded-lg border transition-colors cursor-pointer ${
                  isToday
                    ? "bg-sky-500/20 border-sky-500"
                    : dayShifts.length > 0
                    ? "bg-slate-700/50 border-slate-600 hover:border-sky-500/50"
                    : "bg-slate-900/30 border-slate-700 hover:border-slate-600"
                }`}
              >
                <div className="text-sm font-semibold text-white mb-1">{day}</div>
                <div className="space-y-1">
                  {dayShifts.slice(0, 3).map((shift) => (
                    <div
                      key={shift.id || `${shift.guard_name}-${shift.start_time}`} // Use shift.id as key, fallback to a composite if not present
                      onClick={(e) => {
                        e.stopPropagation();
                        onShiftClick && onShiftClick(shift);
                      }}
                      className={`text-xs px-1.5 py-0.5 rounded truncate hover:opacity-80 transition-opacity ${
                        shift.status === "scheduled" ? "bg-sky-500 text-white" :
                        shift.status === "active" ? "bg-emerald-500 text-white" :
                        shift.status === "completed" ? "bg-slate-500 text-white" :
                        shift.status === "missed" ? "bg-rose-500 text-white" :
                        shift.status === "open" ? "bg-purple-500 text-white" :
                        "bg-amber-500 text-white" // Default for other statuses
                      }`}
                    >
                      {shift.guard_name || "Open"}
                    </div>
                  ))}
                  {dayShifts.length > 3 && (
                    <div className="text-xs text-slate-400 text-center">
                      +{dayShifts.length - 3}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-6 pt-4 border-t border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-sky-500" />
            <span className="text-xs text-slate-400">Scheduled</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500" />
            <span className="text-xs text-slate-400">Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-purple-500" />
            <span className="text-xs text-slate-400">Open</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-slate-500" />
            <span className="text-xs text-slate-400">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-rose-500" />
            <span className="text-xs text-slate-400">Missed</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}