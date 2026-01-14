import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Check, Circle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available", color: "bg-green-500" },
  { value: "busy", label: "Busy", color: "bg-yellow-500" },
  { value: "do_not_disturb", label: "Do Not Disturb", color: "bg-rose-500" },
  { value: "offline", label: "Offline", color: "bg-slate-500" }
];

export default function AvailabilitySelector({ user }) {
  const queryClient = useQueryClient();
  const currentStatus = user.ptt_availability || "available";
  const currentOption = AVAILABILITY_OPTIONS.find(opt => opt.value === currentStatus);

  const updateAvailability = useMutation({
    mutationFn: async (status) => {
      await base44.auth.updateMe({
        ptt_availability: status,
        availability_updated_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["allUsers"]);
    }
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost" 
          size="sm"
          className="gap-2 text-slate-300 hover:text-white"
        >
          <Circle className={`w-3 h-3 ${currentOption.color} rounded-full`} />
          {currentOption.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-slate-800 border-slate-700" align="end">
        {AVAILABILITY_OPTIONS.map(option => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => updateAvailability.mutate(option.value)}
            className="flex items-center gap-2 text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
          >
            <Circle className={`w-3 h-3 ${option.color} rounded-full`} />
            <span className="flex-1">{option.label}</span>
            {currentStatus === option.value && (
              <Check className="w-4 h-4 text-sky-400" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AvailabilityBadge({ status }) {
  const option = AVAILABILITY_OPTIONS.find(opt => opt.value === status) || AVAILABILITY_OPTIONS[0];
  
  return (
    <div className="flex items-center gap-1">
      <Circle className={`w-2 h-2 ${option.color} rounded-full`} />
      <span className="text-xs text-slate-400">{option.label}</span>
    </div>
  );
}