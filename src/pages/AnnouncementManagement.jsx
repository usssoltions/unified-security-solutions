import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Megaphone, Plus, X, Send, Eye, Trash2, Globe, Users } from "lucide-react";

export default function AnnouncementManagement() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    title: "", body: "", category: "news", priority: "normal",
    target_audience: "all", send_whatsapp: false, send_email: true, send_push: true
  });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: announcements = [] } = useQuery({
    queryKey: ["all_announcements"],
    queryFn: () => base44.entities.Announcement.list("-created_date", 50),
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      return await base44.entities.Announcement.create({
        ...data,
        created_by: user.id,
        created_by_name: user.full_name,
        published: true,
        published_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      qc.invalidateQueries(["all_announcements"]);
      setShowForm(false);
      setForm({ title: "", body: "", category: "news", priority: "normal", target_audience: "all", send_whatsapp: false, send_email: true, send_push: true });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Announcement.delete(id),
    onSuccess: () => qc.invalidateQueries(["all_announcements"])
  });

  const categoryColors = { news: "bg-sky-600", maintenance: "bg-amber-600", event: "bg-purple-600", security: "bg-rose-600", emergency: "bg-red-700", advertisement: "bg-pink-600", promotion: "bg-emerald-600", other: "bg-slate-600" };
  const priorityColors = { low: "bg-slate-600", normal: "bg-sky-600", high: "bg-orange-600", urgent: "bg-rose-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-3xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Megaphone className="w-6 h-6 text-sky-400" /> Announcements
            </h1>
            <p className="text-slate-400 text-sm">Broadcast news, alerts & campaigns to residents</p>
          </div>
          <Button onClick={() => setShowForm(true)} className="bg-sky-500 hover:bg-sky-600">
            <Plus className="w-4 h-4 mr-2" /> New
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Create Announcement</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Title *" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Textarea placeholder="Message body *" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} className="bg-slate-900 border-slate-700 text-white" rows={5} />
              <div className="grid grid-cols-2 gap-3">
                <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    {["news", "maintenance", "event", "security", "emergency", "advertisement", "promotion", "other"].map(c => (
                      <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Select value={form.target_audience} onValueChange={v => setForm({ ...form, target_audience: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Target audience" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="residents">Residents Only</SelectItem>
                  <SelectItem value="guards">Guards Only</SelectItem>
                  <SelectItem value="vendors">Vendors Only</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.send_push} onChange={e => setForm({ ...form, send_push: e.target.checked })} className="w-4 h-4" />
                  Push Notification
                </label>
                <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.send_email} onChange={e => setForm({ ...form, send_email: e.target.checked })} className="w-4 h-4" />
                  Email
                </label>
                <label className="flex items-center gap-2 text-slate-300 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.send_whatsapp} onChange={e => setForm({ ...form, send_whatsapp: e.target.checked })} className="w-4 h-4" />
                  WhatsApp
                </label>
              </div>
              {(form.send_whatsapp || form.send_email) && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                  ⚠️ WhatsApp & Email notifications require the Builder+ plan with backend functions enabled.
                </div>
              )}
              <Button className="w-full bg-sky-500 hover:bg-sky-600" onClick={() => createMutation.mutate(form)} disabled={!form.title || !form.body || createMutation.isPending}>
                <Send className="w-4 h-4 mr-2" /> {createMutation.isPending ? "Publishing..." : "Publish Announcement"}
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {announcements.length === 0 ? (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-8 text-center">
                <Megaphone className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">No announcements yet</p>
              </CardContent>
            </Card>
          ) : announcements.map(a => (
            <Card key={a.id} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 pr-3">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="text-white font-semibold">{a.title}</p>
                      <Badge className={categoryColors[a.category]}>{a.category}</Badge>
                      <Badge className={priorityColors[a.priority]}>{a.priority}</Badge>
                    </div>
                    <p className="text-slate-400 text-sm line-clamp-2">{a.body}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {a.target_audience}</span>
                      <span>{new Date(a.published_at || a.created_date).toLocaleDateString()}</span>
                      <span className="flex items-center gap-1"><Eye className="w-3 h-3" /> {a.read_by?.length || 0} read</span>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(a.id)} className="text-rose-400 hover:text-rose-300">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}