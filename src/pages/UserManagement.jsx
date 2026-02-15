import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Plus, Search, Shield, Radio, UserCheck, Building } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PullToRefresh from "@/components/PullToRefresh";
import UserForm from "../components/users/UserForm";
import UserCard from "../components/users/UserCard";

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      return await base44.entities.User.list();
    },
    initialData: []
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId) => {
      await base44.entities.User.delete(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["allUsers"]);
    }
  });

  const handleEdit = (user) => {
    setEditingUser(user);
    setShowUserForm(true);
  };

  const handleDelete = async (userId) => {
    if (window.confirm("Are you sure you want to delete this user?")) {
      await deleteUserMutation.mutateAsync(userId);
    }
  };

  const filterUsers = (roleType) => {
    let filtered = users;
    
    if (roleType !== "all") {
      filtered = users.filter(u => u.role_type === roleType);
    }

    if (searchQuery) {
      filtered = filtered.filter(u => 
        u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.badge_number?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  const userStats = {
    total: users.length,
    admins: users.filter(u => u.role_type === "admin").length,
    dispatchers: users.filter(u => u.role_type === "dispatcher").length,
    guards: users.filter(u => u.role_type === "guard").length,
    clients: users.filter(u => u.role_type === "client").length
  };

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries({ queryKey: ['allUsers'] });
    }}>
      <div className="min-h-screen p-4 lg:p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <Users className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">User Management</h1>
            <p className="text-slate-400">Create and manage system users</p>
          </div>
        </div>

        <Button
          onClick={() => {
            setEditingUser(null);
            setShowUserForm(true);
          }}
          className="bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add User
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6">
            <div className="text-center">
              <Users className="w-8 h-8 text-sky-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{userStats.total}</p>
              <p className="text-sm text-slate-400">Total Users</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
          <CardContent className="pt-6">
            <div className="text-center">
              <Shield className="w-8 h-8 text-purple-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{userStats.admins}</p>
              <p className="text-sm text-slate-400">Admins</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-sky-500/10 to-sky-600/10 border-sky-500/20">
          <CardContent className="pt-6">
            <div className="text-center">
              <Radio className="w-8 h-8 text-sky-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{userStats.dispatchers}</p>
              <p className="text-sm text-slate-400">Dispatchers</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/10 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="text-center">
              <UserCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{userStats.guards}</p>
              <p className="text-sm text-slate-400">Guards</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/10 border-amber-500/20">
          <CardContent className="pt-6">
            <div className="text-center">
              <Building className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{userStats.clients}</p>
              <p className="text-sm text-slate-400">Clients</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search Bar */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by name, email, or badge number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-900 border-slate-700 text-white"
            />
          </div>
        </CardContent>
      </Card>

      {/* User Tabs */}
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="all">All Users</TabsTrigger>
          <TabsTrigger value="admin">Admins</TabsTrigger>
          <TabsTrigger value="dispatcher">Dispatchers</TabsTrigger>
          <TabsTrigger value="guard">Guards</TabsTrigger>
          <TabsTrigger value="client">Clients</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? (
              <p className="text-slate-400 col-span-full text-center py-8">Loading users...</p>
            ) : filterUsers("all").length === 0 ? (
              <p className="text-slate-400 col-span-full text-center py-8">No users found</p>
            ) : (
              filterUsers("all").map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="admin" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterUsers("admin").length === 0 ? (
              <p className="text-slate-400 col-span-full text-center py-8">No admins found</p>
            ) : (
              filterUsers("admin").map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="dispatcher" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterUsers("dispatcher").length === 0 ? (
              <p className="text-slate-400 col-span-full text-center py-8">No dispatchers found</p>
            ) : (
              filterUsers("dispatcher").map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="guard" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterUsers("guard").length === 0 ? (
              <p className="text-slate-400 col-span-full text-center py-8">No guards found</p>
            ) : (
              filterUsers("guard").map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="client" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filterUsers("client").length === 0 ? (
              <p className="text-slate-400 col-span-full text-center py-8">No clients found</p>
            ) : (
              filterUsers("client").map(user => (
                <UserCard
                  key={user.id}
                  user={user}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* User Form Modal */}
      {showUserForm && (
        <UserForm
          user={editingUser}
          onClose={() => {
            setShowUserForm(false);
            setEditingUser(null);
          }}
          onSuccess={() => {
            setShowUserForm(false);
            setEditingUser(null);
            queryClient.invalidateQueries(["allUsers"]);
          }}
        />
      )}
      </div>
    </PullToRefresh>
  );
}