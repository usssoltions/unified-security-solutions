import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useVL360 } from "@/hooks/useVL360";
import VL360Shell from "@/components/vl360/VL360Shell";
import PersonnelSetup from "@/components/vl360/admin/PersonnelSetup";
import SiteCommsSetup from "@/components/vl360/admin/SiteCommsSetup";
import ControllerAssignments from "@/components/vl360/admin/ControllerAssignments";
import PhonePermissions from "@/components/vl360/admin/PhonePermissions";
import OperationalContacts from "@/components/vl360/admin/OperationalContacts";
import SetupChecks from "@/components/vl360/admin/SetupChecks";
import Offboarding from "@/components/vl360/admin/Offboarding";
import ModuleSettings from "@/components/vl360/admin/ModuleSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * VL360Admin — VoiceLink 360 administration (Customer Administrator scope,
 * enforced server-side): Personnel Setup, Site Communication Setup,
 * Controller Assignments, Telephone Permissions, Operational Contacts,
 * Setup Checks, Access & Offboarding, Module Settings.
 */
export default function VL360Admin() {
  const ctx = useVL360();
  const queryClient = useQueryClient();
  const isVlAdmin = ctx.data?.role === "customer_admin" || ctx.data?.can_manage === true;
  const isFullAdmin = ctx.data?.role === "customer_admin";

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["vl360_admin"],
    queryFn: async () => vl360Invoke({ action: "admin_list_users" }),
    enabled: !!ctx.data,
  });

  const refresh = () => { refetch(); ctx.refresh(); };

  if (!ctx.isLoading && ctx.data && !isFullAdmin && ctx.data.role !== "customer_admin") {
    // Gateway also enforces — the UI explains honestly.
  }

  return (
    <VL360Shell ctx={ctx} title="VL360 Administration" subtitle="VoiceLink 360 setup for your organisation">
      {!isFullAdmin ? (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="text-sm text-amber-200">Administration requires the Customer Administrator VoiceLink role. Your current role: {ctx.data?.role_label}.</p>
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-10"><div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <Tabs defaultValue="personnel" className="w-full">
          <TabsList className="bg-slate-800/50 flex-wrap h-auto gap-1 w-full">
            <TabsTrigger value="personnel">Personnel</TabsTrigger>
            <TabsTrigger value="sitecomms">Site Comms</TabsTrigger>
            <TabsTrigger value="controllers">Controllers</TabsTrigger>
            <TabsTrigger value="phone">Telephone</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="checks">Setup Checks</TabsTrigger>
            <TabsTrigger value="offboarding">Access</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="personnel" className="mt-4"><PersonnelSetup data={data} onChanged={refresh} /></TabsContent>
          <TabsContent value="sitecomms" className="mt-4"><SiteCommsSetup data={data} /></TabsContent>
          <TabsContent value="controllers" className="mt-4"><ControllerAssignments data={data} onChanged={refresh} /></TabsContent>
          <TabsContent value="phone" className="mt-4"><PhonePermissions data={data} onChanged={refresh} /></TabsContent>
          <TabsContent value="contacts" className="mt-4"><OperationalContacts /></TabsContent>
          <TabsContent value="checks" className="mt-4"><SetupChecks onChanged={refresh} /></TabsContent>
          <TabsContent value="offboarding" className="mt-4"><Offboarding data={data} onChanged={refresh} /></TabsContent>
          <TabsContent value="settings" className="mt-4"><ModuleSettings data={data} /></TabsContent>
        </Tabs>
      )}
    </VL360Shell>
  );
}