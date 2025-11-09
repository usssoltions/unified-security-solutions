import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Shield, Radio, UserCheck, Building, Edit, Trash2, Mail, Phone, IdCard } from "lucide-react";

export default function UserCard({ user, onEdit, onDelete }) {
  const roleConfig = {
    admin: {
      icon: Shield,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
      borderColor: "border-purple-500/20",
      badgeColor: "bg-purple-500"
    },
    dispatcher: {
      icon: Radio,
      color: "text-sky-400",
      bgColor: "bg-sky-500/10",
      borderColor: "border-sky-500/20",
      badgeColor: "bg-sky-500"
    },
    guard: {
      icon: UserCheck,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      badgeColor: "bg-emerald-500"
    },
    client: {
      icon: Building,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      badgeColor: "bg-amber-500"
    }
  };

  const config = roleConfig[user.role_type] || roleConfig.guard;
  const RoleIcon = config.icon;

  return (
    <Card className={`${config.bgColor} ${config.borderColor} border`}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 ${config.bgColor} rounded-full flex items-center justify-center border ${config.borderColor}`}>
              <RoleIcon className={`w-6 h-6 ${config.color}`} />
            </div>
            <div>
              <h3 className="font-semibold text-white">{user.full_name}</h3>
              <Badge className={config.badgeColor}>
                {user.role_type?.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Mail className="w-4 h-4" />
            <span className="truncate">{user.email}</span>
          </div>
          
          {user.badge_number && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <IdCard className="w-4 h-4" />
              <span>{user.badge_number}</span>
            </div>
          )}
          
          {user.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Phone className="w-4 h-4" />
              <span>{user.phone}</span>
            </div>
          )}

          {user.is_clocked_in && (
            <div className="flex items-center gap-2 mt-2">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-400">Currently On Duty</span>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-3 border-t border-slate-700">
          <Button
            onClick={() => onEdit(user)}
            size="sm"
            variant="outline"
            className="flex-1 border-slate-600 text-slate-300"
          >
            <Edit className="w-4 h-4 mr-1" />
            Edit
          </Button>
          <Button
            onClick={() => onDelete(user.id)}
            size="sm"
            variant="outline"
            className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}