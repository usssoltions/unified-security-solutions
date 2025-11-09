import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Users, 
  UserPlus, 
  Shield, 
  Radio, 
  User, 
  Mail,
  Phone,
  Search,
  Eye
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function UserManagement() {
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      return await base44.entities.User.list();
    },
    initialData: []
  });

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.badge_number?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesRole = roleFilter === "all" || user.role_type === roleFilter;
    
    return matchesSearch && matchesRole;
  });

  const roleConfig = {
    admin: { color: "bg-purple-500", icon: Shield, label: "Admin" },
    dispatcher: { color: "bg-sky-500", icon: Radio, label: "Dispatcher" },
    guard: { color: "bg-emerald-500", icon: Shield, label: "Guard" },
    client: { color: "bg-amber-500", icon: User, label: "Client" }
  };

  const getRoleStats = () => {
    return {
      total: users.length,
      admin: users.filter(u => u.role_type === "admin").length,
      dispatcher: users.filter(u => u.role_type === "dispatcher").length,
      guard: users.filter(u => u.role_type === "guard").length,
      client: users.filter(u => u.role_type === "client").length
    };
  };

  const stats = getRoleStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">User Management</h1>
            <p className="text-slate-400">Manage system users and roles</p>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Total Users</p>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="bg-purple-500/10 border-purple-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-purple-400 mb-1">Admins</p>
            <p className="text-2xl font-bold text-white">{stats.admin}</p>
          </CardContent>
        </Card>
        <Card className="bg-sky-500/10 border-sky-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-sky-400 mb-1">Dispatchers</p>
            <p className="text-2xl font-bold text-white">{stats.dispatcher}</p>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500/10 border-emerald-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-emerald-400 mb-1">Guards</p>
            <p className="text-2xl font-bold text-white">{stats.guard}</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="p-4">
            <p className="text-xs text-amber-400 mb-1">Clients</p>
            <p className="text-2xl font-bold text-white">{stats.client}</p>
          </CardContent>
        </Card>
      </div>

      {/* Info Banner */}
      <Card className="bg-sky-500/10 border-sky-500/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <UserPlus className="w-5 h-5 text-sky-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sky-400 font-semibold mb-1">How to Add New Users</h3>
              <p className="text-sm text-slate-300 mb-2">
                Users must be invited through the Base44 Dashboard. This page displays existing users.
              </p>
              <p className="text-xs text-slate-400">
                To invite: Dashboard → Users → Invite User → Enter email & role → Send invitation
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by name, email, or badge number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-900/50 border-slate-700 text-white"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full md:w-48 bg-slate-900/50 border-slate-700 text-white">
                <SelectValue placeholder="Filter by role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="dispatcher">Dispatcher</SelectItem>
                <SelectItem value="guard">Guard</SelectItem>
                <SelectItem value="client">Client</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <div className="grid gap-4">
        {filteredUsers.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-12 text-center">
              <Users className="w-12 h-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">No users found</p>
            </CardContent>
          </Card>
        ) : (
          filteredUsers.map((user) => {
            const config = roleConfig[user.role_type] || roleConfig.guard;
            const RoleIcon = config.icon;
            
            return (
              <Card key={user.id} className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-12 h-12 ${config.color} rounded-full flex items-center justify-center flex-shrink-0`}>
                        <RoleIcon className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-white font-semibold">{user.full_name || "Unnamed User"}</h3>
                          <Badge className={config.color}>
                            {config.label}
                          </Badge>
                          {user.is_clocked_in && (
                            <Badge className="bg-emerald-500">
                              <div className="w-2 h-2 bg-white rounded-full animate-pulse mr-1" />
                              On Duty
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-1 text-sm">
                          {user.email && (
                            <div className="flex items-center gap-2 text-slate-400">
                              <Mail className="w-4 h-4" />
                              <span>{user.email}</span>
                            </div>
                          )}
                          {user.phone && (
                            <div className="flex items-center gap-2 text-slate-400">
                              <Phone className="w-4 h-4" />
                              <span>{user.phone}</span>
                            </div>
                          )}
                          {user.badge_number && (
                            <div className="flex items-center gap-2 text-slate-400">
                              <Shield className="w-4 h-4" />
                              <span>Badge: {user.badge_number}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-slate-500 text-xs mt-2">
                            <span>Joined: {new Date(user.created_date).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon"
                      className="text-slate-400 hover:text-white"
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}