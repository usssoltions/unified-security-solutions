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
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between p-2 sm:p-3 bg-slate-800/50 rounded-lg border border-slate-700">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400 flex-shrink-0" />
          <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-white truncate">
            {monthNames[currentMonth]} {currentYear}
          </h3>
        </div>
        <div className="flex gap-1 sm:gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={previousMonth}
            className="border-slate-600 text-slate-300 h-8 w-8 sm:h-9 sm:w-9 p-0"
          >
            <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={goToToday}
            className="border-slate-600 text-slate-300 text-[10px] sm:text-xs px-2 sm:px-3"
          >
            Today
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={nextMonth}
            className="border-slate-600 text-slate-300 h-8 w-8 sm:h-9 sm:w-9 p-0"
          >
            <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4" />
          </Button>
        </div>
      </div>
      
      <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="p-2 sm:p-4 lg:p-6">
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {/* Day headers */}
          {dayNames.map(day => (
            <div key={day} className="text-center text-[10px] sm:text-xs font-semibold text-slate-400 py-1 sm:py-2">
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
                className={`aspect-square p-1 sm:p-2 rounded-lg border transition-colors cursor-pointer ${
                  isToday
                    ? "bg-sky-500/20 border-sky-500"
                    : dayShifts.length > 0
                    ? "bg-slate-700/50 border-slate-600 hover:border-sky-500/50"
                    : "bg-slate-900/30 border-slate-700 hover:border-slate-600"
                }`}
              >
                <div className="text-[10px] sm:text-xs lg:text-sm font-semibold text-white mb-0.5 sm:mb-1">{day}</div>
                <div className="space-y-0.5 sm:space-y-1">
                  {dayShifts.slice(0, 2).map((shift) => (
                    <div
                      key={shift.id || `${shift.guard_name}-${shift.start_time}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onShiftClick && onShiftClick(shift);
                      }}
                      className={`text-[8px] sm:text-[10px] lg:text-xs px-1 sm:px-1.5 py-0.5 rounded truncate hover:opacity-80 transition-opacity ${
                        shift.status === "scheduled" ? "bg-sky-500 text-white" :
                        shift.status === "active" ? "bg-emerald-500 text-white" :
                        shift.status === "completed" ? "bg-slate-500 text-white" :
                        shift.status === "missed" ? "bg-rose-500 text-white" :
                        shift.status === "open" ? "bg-purple-500 text-white" :
                        "bg-amber-500 text-white"
                      }`}
                    >
                      {shift.guard_name?.split(' ')[0] || "Open"}
                    </div>
                  ))}
                  {dayShifts.length > 2 && (
                    <div className="text-[8px] sm:text-[10px] text-slate-400 text-center">
                      +{dayShifts.length - 2}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      </Card>

      {/* Legend */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-2 sm:p-3">
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded bg-sky-500" />
              <span className="text-[10px] sm:text-xs text-slate-400">Scheduled</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded bg-emerald-500" />
              <span className="text-[10px] sm:text-xs text-slate-400">Active</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded bg-purple-500" />
              <span className="text-[10px] sm:text-xs text-slate-400">Open</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded bg-slate-500" />
              <span className="text-[10px] sm:text-xs text-slate-400">Completed</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded bg-rose-500" />
              <span className="text-[10px] sm:text-xs text-slate-400">Missed</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}