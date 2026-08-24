import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Vote, Plus, CheckCircle, Clock, Loader2, BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import moment from "moment";

export default function EstateVoting() {
  const [user, setUser] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [voting, setVoting] = useState(null);
  const [formData, setFormData] = useState({
    title: "", description: "", question_type: "yes_no",
    options: [{ text: "Yes" }, { text: "No" }],
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const u = await base44.auth.me();
      setUser(u);
      const cid = u.customer_id;
      if (!cid) { setLoading(false); return; }
      const qs = await base44.entities.VotingQuestion.filter({ customer_id: cid }).catch(() => []);
      setQuestions(qs.sort((a, b) => new Date(b.created_date) - new Date(a.created_date)));
    } catch (e) {
      console.error("Failed to load voting questions:", e);
    } finally {
      setLoading(false);
    }
  };

  const hasVoted = (q) => q.voted_user_ids?.includes(user?.id);

  const handleSave = async () => {
    if (!formData.title) return;
    setSaving(true);
    try {
      await base44.entities.VotingQuestion.create({
        ...formData,
        customer_id: user.customer_id,
        options: formData.options.map(o => ({ text: o.text, votes: 0 })),
        total_votes: 0,
        voted_user_ids: [],
        status: "open",
        open_date: new Date().toISOString(),
        created_by_name: user.full_name || user.display_name,
      });
      setShowForm(false);
      setFormData({ title: "", description: "", question_type: "yes_no", options: [{ text: "Yes" }, { text: "No" }] });
      await loadData();
    } catch (e) {
      console.error("Failed to create vote:", e);
      alert("Failed to create vote: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const castVote = async (question, optionIdx) => {
    if (hasVoted(question) || question.status !== "open") return;
    setVoting(question.id);
    try {
      const options = question.options.map((o, i) => ({
        ...o,
        votes: (o.votes || 0) + (i === optionIdx ? 1 : 0),
      }));
      await base44.entities.VotingQuestion.update(question.id, {
        options,
        total_votes: (question.total_votes || 0) + 1,
        voted_user_ids: [...(question.voted_user_ids || []), user.id],
      });
      await loadData();
    } catch (e) {
      console.error("Failed to cast vote:", e);
      alert("Failed to cast vote: " + e.message);
    } finally {
      setVoting(null);
    }
  };

  const closeVote = async (q) => {
    try {
      await base44.entities.VotingQuestion.update(q.id, { status: "closed" });
      await loadData();
    } catch (e) {
      console.error("Failed to close vote:", e);
    }
  };

  const addOption = () => setFormData({ ...formData, options: [...formData.options, { text: "" }] });
  const updateOption = (idx, text) => {
    const options = [...formData.options];
    options[idx].text = text;
    setFormData({ ...formData, options });
  };
  const removeOption = (idx) => {
    if (formData.options.length <= 2) return;
    setFormData({ ...formData, options: formData.options.filter((_, i) => i !== idx) });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-sky-500 rounded-xl flex items-center justify-center">
              <Vote className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Voting</h1>
              <p className="text-slate-400 text-sm">Resident polls &amp; estate decisions</p>
            </div>
          </div>
          <Button className="bg-sky-500 hover:bg-sky-600" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-2" /> New Vote
          </Button>
        </div>

        {questions.length === 0 ? (
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-12 text-center">
              <Vote className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No voting questions yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {questions.map(q => {
              const voted = hasVoted(q);
              const total = q.total_votes || 0;
              return (
                <Card key={q.id} className="bg-slate-900 border-slate-800">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm">{q.title}</p>
                        {q.description && <p className="text-slate-400 text-xs mt-1">{q.description}</p>}
                      </div>
                      <Badge className={`text-xs ml-2 shrink-0 ${
                        q.status === "open" ? "bg-emerald-500/20 text-emerald-400" :
                        q.status === "closed" ? "bg-slate-500/20 text-slate-400" : "bg-amber-500/20 text-amber-400"
                      }`}>{q.status}</Badge>
                    </div>

                    {q.status === "open" && !voted ? (
                      <div className="space-y-2 mt-3">
                        {q.options?.map((opt, idx) => (
                          <button key={idx} onClick={() => castVote(q, idx)} disabled={voting === q.id}
                            className="w-full flex items-center gap-3 p-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-all text-left active:scale-[0.99] disabled:opacity-50">
                            <div className="w-6 h-6 rounded-full border-2 border-slate-600 flex items-center justify-center shrink-0" />
                            <span className="text-slate-200 text-sm">{opt.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2 mt-3">
                        {q.options?.map((opt, idx) => {
                          const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0;
                          return (
                            <div key={idx} className="relative">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-slate-300 text-xs">{opt.text}</span>
                                <span className="text-slate-400 text-xs">{opt.votes || 0} ({pct}%)</span>
                              </div>
                              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-800">
                          <span className="text-slate-500 text-xs flex items-center gap-1">
                            <BarChart3 className="w-3 h-3" /> {total} total votes
                            {voted && <Badge className="ml-2 text-xs bg-emerald-500/20 text-emerald-400">You voted</Badge>}
                          </span>
                          {q.status === "open" && (user?.role_type === "admin" || user?.role_type === "estate_manager" || user?.role_type === "dispatcher") && (
                            <Button size="sm" variant="ghost" className="text-rose-400 hover:bg-rose-500/10 text-xs h-7"
                              onClick={() => closeVote(q)}>Close Vote</Button>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader><DialogTitle className="text-white">New Voting Question</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-slate-300 text-sm">Title *</Label>
              <Input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Description</Label>
              <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="bg-slate-800 border-slate-700 text-white mt-1 min-h-[60px]" />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Question Type</Label>
              <Select value={formData.question_type} onValueChange={(v) => {
                if (v === "yes_no") setFormData({ ...formData, question_type: v, options: [{ text: "Yes" }, { text: "No" }] });
                else setFormData({ ...formData, question_type: v, options: [{ text: "Option 1" }, { text: "Option 2" }] });
              }}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  <SelectItem value="yes_no" className="text-white">Yes / No</SelectItem>
                  <SelectItem value="single_choice" className="text-white">Single Choice</SelectItem>
                  <SelectItem value="multiple_choice" className="text-white">Multiple Choice</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formData.question_type !== "yes_no" && (
              <div>
                <Label className="text-slate-300 text-sm">Options</Label>
                <div className="space-y-2 mt-1">
                  {formData.options.map((opt, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input value={opt.text} onChange={(e) => updateOption(idx, e.target.value)}
                        className="bg-slate-800 border-slate-700 text-white flex-1" placeholder={`Option ${idx + 1}`} />
                      {formData.options.length > 2 && (
                        <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => removeOption(idx)}>×</Button>
                      )}
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 text-xs" onClick={addOption}>
                    <Plus className="w-3 h-3 mr-1" /> Add Option
                  </Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)} className="border-slate-700 text-slate-300">Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !formData.title} className="bg-sky-500 hover:bg-sky-600">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Create Vote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}