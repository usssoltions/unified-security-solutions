import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Package, AlertCircle, Wrench, Calendar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AssetForm from "../components/assets/AssetForm";
import AssetCard from "../components/assets/AssetCard";
import ServiceReminders from "../components/assets/ServiceReminders";

export default function AssetManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);

  const { data: assets } = useQuery({
    queryKey: ["assets"],
    queryFn: async () => await base44.entities.Asset.list("-created_date"),
    initialData: []
  });

  const getDueForService = () => {
    const today = new Date();
    return assets.filter(asset => {
      if (!asset.next_service_date) return false;
      const serviceDate = new Date(asset.next_service_date);
      const daysUntil = Math.floor((serviceDate - today) / (1000 * 60 * 60 * 24));
      return daysUntil <= 30 && daysUntil >= 0;
    });
  };

  const getOverdue = () => {
    const today = new Date();
    return assets.filter(asset => {
      if (!asset.next_service_date) return false;
      const serviceDate = new Date(asset.next_service_date);
      return serviceDate < today;
    });
  };

  const dueForService = getDueForService();
  const overdue = getOverdue();

  const statusColors = {
    active: "bg-emerald-500",
    maintenance: "bg-amber-500",
    retired: "bg-slate-500",
    lost: "bg-rose-500"
  };

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Asset Management</h1>
            <p className="text-slate-400">Track equipment, vehicles, and service schedules</p>
          </div>
        </div>

        <Button
          onClick={() => {
            setSelectedAsset(null);
            setShowForm(true);
          }}
          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Asset
        </Button>
      </div>

      {/* Alert Cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-6 flex items-center gap-4">
            <Package className="w-10 h-10 text-emerald-400" />
            <div>
              <p className="text-sm text-slate-400">Total Assets</p>
              <p className="text-2xl font-bold text-white">{assets.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardContent className="pt-6 flex items-center gap-4">
            <Calendar className="w-10 h-10 text-amber-400" />
            <div>
              <p className="text-sm text-amber-400">Due for Service</p>
              <p className="text-2xl font-bold text-white">{dueForService.length}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardContent className="pt-6 flex items-center gap-4">
            <AlertCircle className="w-10 h-10 text-rose-400" />
            <div>
              <p className="text-sm text-rose-400">Overdue Service</p>
              <p className="text-2xl font-bold text-white">{overdue.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="bg-slate-800/50">
          <TabsTrigger value="all">All Assets</TabsTrigger>
          <TabsTrigger value="reminders">Service Reminders</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onEdit={() => {
                  setSelectedAsset(asset);
                  setShowForm(true);
                }}
              />
            ))}
            {assets.length === 0 && (
              <Card className="col-span-full bg-slate-800/50 border-slate-700">
                <CardContent className="pt-12 pb-12 text-center">
                  <Package className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-white mb-2">No Assets Yet</h3>
                  <p className="text-slate-400">Click "Add Asset" to start tracking your equipment</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="reminders" className="mt-6">
          <ServiceReminders
            dueForService={dueForService}
            overdue={overdue}
            onAssetClick={(asset) => {
              setSelectedAsset(asset);
              setShowForm(true);
            }}
          />
        </TabsContent>

        <TabsContent value="vehicles" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets
              .filter(a => a.category === "vehicle")
              .map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={() => {
                    setSelectedAsset(asset);
                    setShowForm(true);
                  }}
                />
              ))}
          </div>
        </TabsContent>

        <TabsContent value="equipment" className="mt-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assets
              .filter(a => a.category === "equipment")
              .map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onEdit={() => {
                    setSelectedAsset(asset);
                    setShowForm(true);
                  }}
                />
              ))}
          </div>
        </TabsContent>
      </Tabs>

      {showForm && (
        <AssetForm
          asset={selectedAsset}
          onClose={() => {
            setShowForm(false);
            setSelectedAsset(null);
          }}
          onSuccess={() => {
            setShowForm(false);
            setSelectedAsset(null);
            queryClient.invalidateQueries(["assets"]);
          }}
        />
      )}
    </div>
  );
}