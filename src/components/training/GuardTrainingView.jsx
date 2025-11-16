import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Clock, CheckCircle2, XCircle, ChevronRight } from "lucide-react";

export default function GuardTrainingView({ user }) {
  const [activeTraining, setActiveTraining] = useState(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [startTime, setStartTime] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const queryClient = useQueryClient();

  const { data: assignments = [] } = useQuery({
    queryKey: ["myTrainings", user.id],
    queryFn: () => base44.entities.TrainingAssignment.filter({
      assigned_to: user.id,
      status: { $in: ["pending", "in_progress"] }
    }, "-created_date"),
    refetchInterval: 10000,
    initialData: []
  });

  const { data: completedCount = 0 } = useQuery({
    queryKey: ["completedTrainings", user.id],
    queryFn: async () => {
      const completed = await base44.entities.TrainingAssignment.filter({
        assigned_to: user.id,
        status: "completed"
      });
      return completed.length;
    }
  });

  const completeTrainingMutation = useMutation({
    mutationFn: async ({ assignmentId, answers, module }) => {
      const correctAnswers = module.quiz_questions.filter((q, i) => q.correct_answer === answers[i]).length;
      const score = Math.round((correctAnswers / module.quiz_questions.length) * 100);
      const passed = score >= module.passing_score;
      const timeSpent = Math.round((Date.now() - startTime) / 60000);

      await base44.entities.TrainingAssignment.update(assignmentId, {
        status: passed ? "completed" : "failed",
        completed_at: new Date().toISOString(),
        quiz_answers: answers,
        score,
        passed,
        time_spent_minutes: timeSpent,
        feedback: passed ? "Great job! Training completed successfully." : "Please review the material and try again."
      });

      return { score, passed, correctAnswers, total: module.quiz_questions.length };
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["myTrainings"]);
      queryClient.invalidateQueries(["completedTrainings"]);
    }
  });

  const startTraining = async (assignment) => {
    const module = await base44.entities.TrainingModule.get(assignment.training_module_id);
    setActiveTraining({ ...assignment, module });
    setCurrentQuestion(0);
    setAnswers([]);
    setStartTime(Date.now());
    setShowResults(false);

    if (assignment.status === "pending") {
      await base44.entities.TrainingAssignment.update(assignment.id, {
        status: "in_progress",
        started_at: new Date().toISOString()
      });
      queryClient.invalidateQueries(["myTrainings"]);
    }
  };

  const handleAnswer = (answerIndex) => {
    const newAnswers = [...answers, answerIndex];
    setAnswers(newAnswers);

    if (currentQuestion < activeTraining.module.quiz_questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else {
      completeTrainingMutation.mutate({
        assignmentId: activeTraining.id,
        answers: newAnswers,
        module: activeTraining.module
      });
      setShowResults(true);
    }
  };

  const priorityColors = {
    low: "bg-slate-600",
    medium: "bg-amber-600",
    high: "bg-orange-600",
    urgent: "bg-rose-600"
  };

  if (activeTraining && !showResults) {
    const question = activeTraining.module.quiz_questions[currentQuestion];
    const progress = ((currentQuestion + 1) / activeTraining.module.quiz_questions.length) * 100;

    return (
      <Card className="bg-slate-800 border-slate-700 max-w-2xl mx-auto">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white">{activeTraining.training_title}</CardTitle>
            <Badge className="bg-sky-600">
              Question {currentQuestion + 1} / {activeTraining.module.quiz_questions.length}
            </Badge>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden mt-3">
            <div className="h-full bg-sky-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          <p className="text-white text-lg font-medium">{question.question}</p>
          
          <div className="space-y-2">
            {question.options.map((option, index) => (
              <Button
                key={index}
                onClick={() => handleAnswer(index)}
                className="w-full justify-start text-left h-auto py-4 bg-slate-900 hover:bg-sky-600 border border-slate-700"
              >
                <span className="font-bold mr-3">{String.fromCharCode(65 + index)}.</span>
                {option}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (showResults && completeTrainingMutation.data) {
    const { score, passed, correctAnswers, total } = completeTrainingMutation.data;

    return (
      <Card className="bg-slate-800 border-slate-700 max-w-2xl mx-auto">
        <CardHeader className="text-center border-b border-slate-700">
          <div className={`w-24 h-24 mx-auto mb-4 rounded-full flex items-center justify-center ${passed ? "bg-emerald-500" : "bg-rose-500"}`}>
            {passed ? <CheckCircle2 className="w-12 h-12 text-white" /> : <XCircle className="w-12 h-12 text-white" />}
          </div>
          <CardTitle className="text-white text-2xl">
            {passed ? "Training Completed!" : "Training Not Passed"}
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6 text-center space-y-4">
          <div className="text-6xl font-bold text-white">{score}%</div>
          <p className="text-slate-400">
            {correctAnswers} out of {total} questions correct
          </p>
          <p className="text-sm text-slate-400">
            Passing score: {activeTraining.module.passing_score}%
          </p>

          {passed ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <p className="text-emerald-400 font-medium">Excellent work! Training completed successfully.</p>
            </div>
          ) : (
            <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
              <p className="text-rose-400 font-medium">Please review the training material and try again.</p>
            </div>
          )}

          <Button onClick={() => { setActiveTraining(null); setShowResults(false); }} className="bg-sky-600 hover:bg-sky-700">
            Back to Training List
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-r from-sky-500/10 to-purple-500/10 border-sky-500/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-sky-600 rounded-full flex items-center justify-center">
                <GraduationCap className="w-8 h-8 text-white" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{completedCount}</p>
                <p className="text-sm text-slate-400">Trainings Completed</p>
              </div>
            </div>
            {assignments.length > 0 && (
              <Badge className="bg-amber-600 text-lg py-2 px-4">
                {assignments.length} Pending
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {assignments.length === 0 ? (
        <Card className="bg-slate-800 border-slate-700">
          <CardContent className="p-12 text-center">
            <GraduationCap className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No pending training assignments</p>
          </CardContent>
        </Card>
      ) : (
        assignments.map(assignment => (
          <Card key={assignment.id} className="bg-slate-800 border-slate-700 hover:border-sky-500/50 transition-colors">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-white font-semibold text-lg">{assignment.training_title}</h3>
                  <p className="text-sm text-slate-400 mt-1">Assigned by {assignment.assigned_by_name}</p>
                  {assignment.reason && (
                    <p className="text-sm text-amber-400 mt-2 italic">{assignment.reason}</p>
                  )}
                </div>
                <Badge className={priorityColors[assignment.priority]}>
                  {assignment.priority}
                </Badge>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-400 mb-4">
                {assignment.due_date && (
                  <span>
                    <Clock className="w-3 h-3 inline mr-1" />
                    Due: {new Date(assignment.due_date).toLocaleDateString()}
                  </span>
                )}
              </div>

              <Button onClick={() => startTraining(assignment)} className="w-full bg-sky-600 hover:bg-sky-700">
                {assignment.status === "pending" ? "Start Training" : "Continue Training"}
                <ChevronRight className="w-5 h-5 ml-2" />
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}