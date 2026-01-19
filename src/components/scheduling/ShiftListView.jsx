import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  User,
  MapPin,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  Edit2,
  Share2,
  Mail,
  MessageSquare,
  Printer,
  Download
} from "lucide-react";

export default function ShiftListView({ 
  shifts, 
  guards, 
  sites,
  onShiftClick, 
  selectedShifts = [], 
  onSelectShift, 
  onSelectAll 
}) {
  const [expandedGuards, setExpandedGuards] = useState(new Set());

  // Group shifts by guard
  const shiftsByGuard = shifts.reduce((acc, shift) => {
    const guardId = shift.guard_id || 'unassigned';
    if (!acc[guardId]) {
      acc[guardId] = [];
    }
    acc[guardId].push(shift);
    return acc;
  }, {});

  const toggleGuardExpand = (guardId) => {
    const newExpanded = new Set(expandedGuards);
    if (newExpanded.has(guardId)) {
      newExpanded.delete(guardId);
    } else {
      newExpanded.add(guardId);
    }
    setExpandedGuards(newExpanded);
  };

  const selectAllGuardShifts = (guardShifts) => {
    const allSelected = guardShifts.every(s => selectedShifts.includes(s.id));
    guardShifts.forEach(shift => {
      if (allSelected) {
        onSelectShift(shift.id, false);
      } else {
        onSelectShift(shift.id, true);
      }
    });
  };

  const statusColors = {
    scheduled: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
    missed: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    open: "bg-purple-500/20 text-purple-400 border-purple-500/30"
  };

  return (
    <div className="space-y-3 w-full overflow-x-hidden">
      {/* Select All */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={shifts.length > 0 && selectedShifts.length === shifts.length}
                onCheckedChange={(checked) => onSelectAll(checked)}
              />
              <span className="text-sm sm:text-base text-white font-medium">
                {selectedShifts.length > 0 ? `${selectedShifts.length} selected` : 'Select all'}
              </span>
            </div>
            <span className="text-xs sm:text-sm text-slate-400">
              Total: {shifts.length} shifts
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Shifts grouped by guard */}
      {Object.entries(shiftsByGuard).map(([guardId, guardShifts]) => {
        const guard = guards.find(g => g.id === guardId);
        const isExpanded = expandedGuards.has(guardId);
        const guardSelectedCount = guardShifts.filter(s => selectedShifts.includes(s.id)).length;
        const allGuardShiftsSelected = guardSelectedCount === guardShifts.length;

        return (
          <Card key={guardId} className="bg-slate-800/50 border-slate-700 overflow-hidden">
            <CardHeader 
              className="p-3 sm:p-4 cursor-pointer hover:bg-slate-700/30 transition-colors"
              onClick={() => toggleGuardExpand(guardId)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <Checkbox
                    checked={allGuardShiftsSelected}
                    onCheckedChange={() => selectAllGuardShifts(guardShifts)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-shrink-0"
                  />
                  <div className="w-8 h-8 sm:w-10 sm:h-10 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-white text-sm sm:text-base truncate">
                      {guard?.full_name || 'Unassigned'}
                    </CardTitle>
                    <p className="text-xs text-slate-400 truncate">
                      {guardShifts.length} shifts
                      {guardSelectedCount > 0 && ` • ${guardSelectedCount} selected`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {isExpanded ? (
                    <CheckSquare className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
                  ) : (
                    <Square className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400" />
                  )}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="p-0 border-t border-slate-700">
                <div className="divide-y divide-slate-700">
                  {guardShifts.map((shift) => {
                    const isSelected = selectedShifts.includes(shift.id);
                    const site = sites.find(s => s.id === shift.site_id);

                    return (
                      <div
                        key={shift.id}
                        className={`p-3 sm:p-4 hover:bg-slate-700/20 transition-colors ${
                          isSelected ? 'bg-sky-500/10' : ''
                        }`}
                      >
                        <div className="flex items-start gap-2 sm:gap-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => onSelectShift(shift.id, checked)}
                            className="mt-1 flex-shrink-0"
                          />
                          <div 
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => onShiftClick(shift)}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <MapPin className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                <span className="font-medium text-white text-sm truncate">
                                  {site?.name || shift.site_name}
                                </span>
                              </div>
                              <Badge 
                                className={`${statusColors[shift.status]} border text-xs whitespace-nowrap flex-shrink-0`}
                              >
                                {shift.status}
                              </Badge>
                            </div>
                            
                            <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-400">
                              <Clock className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                              <span className="truncate">
                                {new Date(shift.start_time).toLocaleDateString('en-US', { 
                                  month: 'short', 
                                  day: 'numeric',
                                  year: 'numeric'
                                })}
                              </span>
                              <span>•</span>
                              <span className="truncate">
                                {new Date(shift.start_time).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                                {' - '}
                                {new Date(shift.end_time).toLocaleTimeString('en-US', { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </span>
                            </div>

                            {shift.notes && (
                              <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                                {shift.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}

      {shifts.length === 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-8 text-center">
            <Clock className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No shifts found for the selected filters</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}