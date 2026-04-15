import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Bell, AlertTriangle, Info, Calendar } from "lucide-react";

export default function ResidentAnnouncements() {
  const [user, setUser] = useState(null);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements_active"],
    queryFn: () => base44.entities.Announcement.filter({ published: true }),
    initialData: []
  });

  const markReadMutation = useMutation({
    mutationFn: (ann) => {
      if (ann.read_by?.includes(user?.id)) return Promise.resolve();
      return base44.entities.Announcement.update(ann.id, { read_by: [...(ann.read_by || []), user.id] });
    },
    onSuccess: () => qc.invalidateQueries(["announcements_active"])
  });

  const priorityConfig = {
    urgent: { color: "bg-rose-600", icon: AlertTriangle, border: "border-rose-500/30" },
    high: { color: "bg-orange-600", icon: Bell, border: "border-orange-500/30" },
    normal: { color: "bg-sky-600", icon: Megaphone, border: "border-slate-700" },
    low: { color: "bg-slate-600", icon: Info, border: "border-slate-700" },
  };

  const catColors = {
    news: "bg-sky-700", maintenance: "bg-amber-700", event: "bg-purple-700",
    security: "bg-rose-700", emergency: "bg-red-700", other: "bg-slate-700"
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <h1 className="text-2xl font-bold text-white pt-2">Announcements</h1>

        {announcements.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <Megaphone className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No announcements yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {announcements.map(a => {
              const pCfg = priorityConfig[a.priority] || priorityConfig.normal;
              const Icon = pCfg.icon;
              const isRead = a.read_by?.includes(user?.id);

              return (
                <Card
                  key={a.id}
                  className={`border ${pCfg.border} ${isRead ? "bg-slate-800/30" : "bg-slate-800"} cursor-pointer transition-colors`}
                  onClick={() => !isRead && user && markReadMutation.mutate(a)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl ${pCfg.color} flex items-center justify-center flex-shrink-0`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`font-semibold ${isRead ? "text-slate-400" : "text-white"}`}>{a.title}</p>
                          {!isRead && <span className="w-2 h-2 bg-sky-400 rounded-full" />}
                          <Badge className={catColors[a.category] || "bg-slate-700"}>{a.category}</Badge>
                        </div>
                        <p className={`text-sm mt-1 ${isRead ? "text-slate-500" : "text-slate-300"}`}>{a.body}</p>
                        <p className="text-slate-500 text-xs mt-2 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(a.published_at || a.created_date).toLocaleDateString()} · {a.created_by_name || "Estate Management"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}