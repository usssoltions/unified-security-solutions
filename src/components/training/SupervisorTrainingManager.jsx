import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, Plus, Send, X, Trash2, Users, Sparkles, Loader2 } from "lucide-react";

export default function SupervisorTrainingManager({ user, onClose }) {
  const [view, setView] = useState("list"); // list, create, assign
  const [selectedModule, setSelectedModule] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "general",
    content: "",
    quiz_questions: [],
    duration_minutes: 10,
    passing_score: 80
  });
  const [newQuestion, setNewQuestion] = useState({ question: "", options: ["", "", "", ""], correct_answer: 0 });
  const [assignmentData, setAssignmentData] = useState({
    guards: [],
    reason: "",
    priority: "medium",
    due_date: ""
  });
  const [aiGenerating, setAiGenerating] = useState(false);
  const queryClient = useQueryClient();

  const { data: modules = [] } = useQuery({
    queryKey: ["trainingModules"],
    queryFn: () => base44.entities.TrainingModule.filter({ status: "active" }),
    initialData: []
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    }
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["trainingAssignments"],
    queryFn: () => base44.entities.TrainingAssignment.list("-created_date", 100),
    initialData: []
  });

  const createModuleMutation = useMutation({
    mutationFn: (data) => base44.entities.TrainingModule.create({
      ...data,
      created_by: user.id,
      created_by_name: user.full_name
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(["trainingModules"]);
      setView("list");
      setFormData({ title: "", description: "", category: "general", content: "", quiz_questions: [], duration_minutes: 10, passing_score: 80 });
    }
  });

  const assignTrainingMutation = useMutation({
    mutationFn: async (data) => {
      for (const guardId of data.guards) {
        const guard = guards.find(g => g.id === guardId);
        await base44.entities.TrainingAssignment.create({
          training_module_id: selectedModule.id,
          training_title: selectedModule.title,
          assigned_to: guardId,
          assigned_to_name: guard?.full_name,
          assigned_by: user.id,
          assigned_by_name: user.full_name,
          reason: data.reason,
          priority: data.priority,
          due_date: data.due_date,
          status: "pending"
        });

        await base44.entities.Alert.create({
          type: "assignment",
          priority: data.priority,
          title: "📚 Training Assignment",
          message: `New training required: ${selectedModule.title}. ${data.reason}`,
          guard_id: guardId,
          guard_name: guard?.full_name,
          status: "active"
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["trainingAssignments"]);
      setView("list");
      setAssignmentData({ guards: [], reason: "", priority: "medium", due_date: "" });
      setSelectedModule(null);
    }
  });

  const generateAITraining = async () => {
    setAiGenerating(true);
    try {
      const recentIncidents = await base44.entities.Incident.list("-reported_at", 20);
      
      const prompt = `Generate a security guard training module based on recent incidents:

Recent Incidents:
${recentIncidents.slice(0, 10).map(i => `- ${i.category}: ${i.description}`).join("\n")}

Create a focused training module with:
1. Title (clear and specific)
2. Description (2 sentences)
3. Training content (detailed procedures, 200-300 words)
4. 5 quiz questions with 4 options each
5. Indicate correct answer index (0-3)

Format as JSON.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            content: { type: "string" },
            quiz_questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_answer: { type: "number" }
                }
              }
            }
          }
        }
      });

      setFormData(prev => ({
        ...prev,
        title: response.title,
        description: response.description,
        content: response.content,
        quiz_questions: response.quiz_questions,
        category: "incident_response"
      }));
    } catch (error) {
      alert("Failed to generate AI training");
    } finally {
      setAiGenerating(false);
    }
  };

  const addQuestion = () => {
    if (!newQuestion.question || newQuestion.options.some(o => !o)) {
      alert("Please fill in all question fields");
      return;
    }
    setFormData(prev => ({
      ...prev,
      quiz_questions: [...prev.quiz_questions, { ...newQuestion }]
    }));
    setNewQuestion({ question: "", options: ["", "", "", ""], correct_answer: 0 });
  };

  if (view === "create") {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4 py-20">
          <Card className="max-w-4xl mx-auto bg-slate-800 border-slate-700">
            <CardHeader className="border-b border-slate-700">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Create Training Module</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setView("list")}>
                  <X />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <Button onClick={generateAITraining} disabled={aiGenerating} className="w-full bg-purple-600 hover:bg-purple-700">
                {aiGenerating ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />Generating...</> : <><Sparkles className="w-5 h-5 mr-2" />AI Generate from Recent Incidents</>}
              </Button>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-white font-medium block mb-2">Title *</label>
                  <Input value={formData.title} onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))} className="bg-slate-900 border-slate-700 text-white" />
                </div>

                <div>
                  <label className="text-white font-medium block mb-2">Category</label>
                  <Select value={formData.category} onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="safety">Safety</SelectItem>
                      <SelectItem value="incident_response">Incident Response</SelectItem>
                      <SelectItem value="patrol_procedures">Patrol Procedures</SelectItem>
                      <SelectItem value="equipment">Equipment</SelectItem>
                      <SelectItem value="emergency">Emergency</SelectItem>
                      <SelectItem value="customer_service">Customer Service</SelectItem>
                      <SelectItem value="compliance">Compliance</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-white font-medium block mb-2">Duration (minutes)</label>
                  <Input type="number" value={formData.duration_minutes} onChange={(e) => setFormData(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) }))} className="bg-slate-900 border-slate-700 text-white" />
                </div>

                <div className="col-span-2">
                  <label className="text-white font-medium block mb-2">Description</label>
                  <Textarea value={formData.description} onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-20" />
                </div>

                <div className="col-span-2">
                  <label className="text-white font-medium block mb-2">Training Content *</label>
                  <Textarea value={formData.content} onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))} className="bg-slate-900 border-slate-700 text-white h-32" />
                </div>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Quiz Questions</label>
                {formData.quiz_questions.map((q, i) => (
                  <div key={i} className="p-3 bg-slate-900 rounded-lg mb-2 border border-slate-700">
                    <div className="flex justify-between items-start">
                      <p className="text-white text-sm font-medium mb-2">{i + 1}. {q.question}</p>
                      <Button size="sm" variant="ghost" onClick={() => setFormData(prev => ({ ...prev, quiz_questions: prev.quiz_questions.filter((_, idx) => idx !== i) }))} className="text-rose-400">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    {q.options.map((opt, oi) => (
                      <p key={oi} className={`text-xs ${oi === q.correct_answer ? 'text-emerald-400' : 'text-slate-400'} ml-4`}>
                        {String.fromCharCode(65 + oi)}. {opt} {oi === q.correct_answer && '✓'}
                      </p>
                    ))}
                  </div>
                ))}

                <div className="p-4 bg-slate-900 rounded-lg border border-slate-700 space-y-3">
                  <Input placeholder="Question" value={newQuestion.question} onChange={(e) => setNewQuestion(prev => ({ ...prev, question: e.target.value }))} className="bg-slate-800 border-slate-700 text-white" />
                  {newQuestion.options.map((opt, i) => (
                    <Input key={i} placeholder={`Option ${String.fromCharCode(65 + i)}`} value={opt} onChange={(e) => setNewQuestion(prev => ({ ...prev, options: prev.options.map((o, idx) => idx === i ? e.target.value : o) }))} className="bg-slate-800 border-slate-700 text-white" />
                  ))}
                  <Select value={newQuestion.correct_answer.toString()} onValueChange={(v) => setNewQuestion(prev => ({ ...prev, correct_answer: parseInt(v) }))}>
                    <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                      <SelectValue placeholder="Correct answer" />
                    </SelectTrigger>
                    <SelectContent>
                      {newQuestion.options.map((_, i) => (
                        <SelectItem key={i} value={i.toString()}>Option {String.fromCharCode(65 + i)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={addQuestion} className="w-full bg-sky-600 hover:bg-sky-700">Add Question</Button>
                </div>
              </div>

              <Button onClick={() => createModuleMutation.mutate(formData)} disabled={!formData.title || !formData.content || createModuleMutation.isPending} className="w-full bg-emerald-600 hover:bg-emerald-700">
                Create Training Module
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (view === "assign" && selectedModule) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4 py-20">
          <Card className="max-w-2xl mx-auto bg-slate-800 border-slate-700">
            <CardHeader className="border-b border-slate-700">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Assign: {selectedModule.title}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => { setView("list"); setSelectedModule(null); }}>
                  <X />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              <div>
                <label className="text-white font-medium block mb-2">Select Guards *</label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {guards.map(guard => (
                    <label key={guard.id} className="flex items-center gap-2 p-2 bg-slate-900 rounded cursor-pointer hover:bg-slate-800">
                      <input type="checkbox" checked={assignmentData.guards.includes(guard.id)} onChange={(e) => setAssignmentData(prev => ({ ...prev, guards: e.target.checked ? [...prev.guards, guard.id] : prev.guards.filter(id => id !== guard.id) }))} className="w-4 h-4" />
                      <span className="text-white">{guard.full_name}</span>
                      {guard.badge_number && <Badge variant="outline" className="text-xs">{guard.badge_number}</Badge>}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Reason for Assignment *</label>
                <Textarea value={assignmentData.reason} onChange={(e) => setAssignmentData(prev => ({ ...prev, reason: e.target.value }))} placeholder="Based on recent incident..." className="bg-slate-900 border-slate-700 text-white h-20" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium block mb-2">Priority</label>
                  <Select value={assignmentData.priority} onValueChange={(v) => setAssignmentData(prev => ({ ...prev, priority: v }))}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-white font-medium block mb-2">Due Date</label>
                  <Input type="datetime-local" value={assignmentData.due_date} onChange={(e) => setAssignmentData(prev => ({ ...prev, due_date: e.target.value }))} className="bg-slate-900 border-slate-700 text-white" />
                </div>
              </div>

              <Button onClick={() => assignTrainingMutation.mutate(assignmentData)} disabled={assignmentData.guards.length === 0 || !assignmentData.reason || assignTrainingMutation.isPending} className="w-full bg-sky-600 hover:bg-sky-700">
                <Send className="w-5 h-5 mr-2" />
                Assign to {assignmentData.guards.length} Guard(s)
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 py-20">
        <Card className="max-w-6xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <GraduationCap className="w-6 h-6 text-sky-400" />
                Training Management
              </CardTitle>
              <div className="flex gap-2">
                <Button onClick={() => setView("create")} className="bg-sky-600 hover:bg-sky-700">
                  <Plus className="w-5 h-5 mr-2" />
                  Create Module
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            <div>
              <h3 className="text-white font-semibold mb-3">Training Modules</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {modules.map(module => {
                  const moduleAssignments = assignments.filter(a => a.training_module_id === module.id);
                  const completed = moduleAssignments.filter(a => a.status === "completed").length;
                  
                  return (
                    <Card key={module.id} className="bg-slate-900 border-slate-700">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="text-white font-medium">{module.title}</h4>
                            <p className="text-xs text-slate-400 mt-1">{module.description}</p>
                          </div>
                          <Badge className="bg-sky-600">{module.category}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mb-3">
                          <span>⏱️ {module.duration_minutes} min</span>
                          <span>📝 {module.quiz_questions?.length || 0} questions</span>
                          <span>✅ {module.passing_score}% pass</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            {moduleAssignments.length} assigned • {completed} completed
                          </span>
                          <Button size="sm" onClick={() => { setSelectedModule(module); setView("assign"); }} className="bg-purple-600 hover:bg-purple-700">
                            <Users className="w-4 h-4 mr-1" />
                            Assign
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-3">Recent Assignments</h3>
              <div className="space-y-2">
                {assignments.slice(0, 10).map(assignment => (
                  <div key={assignment.id} className="p-3 bg-slate-900 rounded-lg border border-slate-700 flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{assignment.training_title}</p>
                      <p className="text-xs text-slate-400">Assigned to {assignment.assigned_to_name} • {assignment.reason}</p>
                    </div>
                    <Badge className={assignment.status === "completed" ? "bg-emerald-600" : assignment.status === "failed" ? "bg-rose-600" : "bg-amber-600"}>
                      {assignment.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}