import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard, Plus, X, TrendingDown, AlertCircle, CheckCircle2 } from "lucide-react";

export default function EstateLevy() {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ resident_id: "", resident_name: "", unit_number: "", monthly_levy: "", balance_due: "" });
  const [recordPayment, setRecordPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const qc = useQueryClient();

  const { data: levyAccounts = [] } = useQuery({ queryKey: ["all_levy"], queryFn: () => base44.entities.LevyAccount.list(), initialData: [] });
  const { data: residents = [] } = useQuery({ queryKey: ["all_residents"], queryFn: () => base44.entities.Resident.list(), initialData: [] });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.LevyAccount.create({ ...data, monthly_levy: Number(data.monthly_levy), balance_due: Number(data.balance_due) || Number(data.monthly_levy), status: "current" }),
    onSuccess: () => { qc.invalidateQueries(["all_levy"]); setShowForm(false); setForm({ resident_id: "", resident_name: "", unit_number: "", monthly_levy: "", balance_due: "" }); }
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async ({ account, amount }) => {
      const numAmount = Number(amount);
      const newBalance = Math.max(0, (account.balance_due || 0) - numAmount);
      await base44.entities.LevyAccount.update(account.id, {
        balance_due: newBalance,
        last_payment_date: new Date().toISOString().split("T")[0],
        last_payment_amount: numAmount,
        status: newBalance <= 0 ? "current" : "overdue",
        statements: [...(account.statements || []), {
          date: new Date().toISOString().split("T")[0],
          description: "Payment received",
          credit: numAmount,
          debit: 0,
          balance: newBalance
        }]
      });
      await base44.entities.Payment.create({
        resident_id: account.resident_id,
        resident_name: account.resident_name,
        unit_number: account.unit_number,
        payment_type: "levy",
        amount: numAmount,
        status: "completed",
        paid_at: new Date().toISOString(),
        description: `Levy payment - Unit ${account.unit_number}`
      });
    },
    onSuccess: () => { qc.invalidateQueries(["all_levy"]); setRecordPayment(null); setPaymentAmount(""); }
  });

  const updateLevy = useMutation({
    mutationFn: ({ id, amount }) => base44.entities.LevyAccount.update(id, {
      balance_due: amount,
      status: amount <= 0 ? "current" : "overdue"
    }),
    onSuccess: () => qc.invalidateQueries(["all_levy"])
  });

  const statusColors = { current: "bg-emerald-600", overdue: "bg-rose-600", suspended: "bg-amber-600" };
  const totalOutstanding = levyAccounts.reduce((s, a) => s + (a.balance_due || 0), 0);
  const overdue = levyAccounts.filter(a => a.status === "overdue");

  const handleResidentSelect = (residentId) => {
    const r = residents.find(res => res.id === residentId);
    if (r) setForm(f => ({ ...f, resident_id: r.id, resident_name: r.full_name, unit_number: r.unit_number }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">Levy Management</h1>
          <Button onClick={() => setShowForm(true)} className="bg-emerald-500 hover:bg-emerald-600"><Plus className="w-4 h-4 mr-2" />Add Account</Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-rose-400 text-xl font-bold">R{totalOutstanding.toFixed(2)}</p>
              <p className="text-slate-400 text-xs">Total Outstanding</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-rose-400 text-xl font-bold">{overdue.length}</p>
              <p className="text-slate-400 text-xs">Overdue</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-emerald-400 text-xl font-bold">{levyAccounts.length - overdue.length}</p>
              <p className="text-slate-400 text-xs">Current</p>
            </CardContent>
          </Card>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Add Levy Account</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select onValueChange={handleResidentSelect}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white"><SelectValue placeholder="Select resident" /></SelectTrigger>
                <SelectContent>
                  {residents.map(r => <SelectItem key={r.id} value={r.id}>{r.full_name} — Unit {r.unit_number}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <Input type="number" placeholder="Monthly levy (R) *" value={form.monthly_levy} onChange={e => setForm({ ...form, monthly_levy: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                <Input type="number" placeholder="Opening balance (R)" value={form.balance_due} onChange={e => setForm({ ...form, balance_due: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              </div>
              <Button className="w-full bg-emerald-500 hover:bg-emerald-600" onClick={() => createMutation.mutate(form)} disabled={!form.resident_id || !form.monthly_levy || createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Account"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Record Payment Modal */}
        {recordPayment && (
          <Card className="bg-slate-800 border-emerald-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-sm">Record Payment — {recordPayment.resident_name}</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setRecordPayment(null)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-slate-400 text-sm">Outstanding: R{recordPayment.balance_due?.toFixed(2)}</p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R</span>
                <Input type="number" placeholder="Amount paid" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="bg-slate-900 border-slate-700 text-white pl-8" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 border-slate-600" onClick={() => setRecordPayment(null)}>Cancel</Button>
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={!paymentAmount || recordPaymentMutation.isPending}
                  onClick={() => recordPaymentMutation.mutate({ account: recordPayment, amount: paymentAmount })}>
                  {recordPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {levyAccounts.map(a => (
            <Card key={a.id} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold">{a.resident_name}</p>
                    <p className="text-slate-400 text-sm">Unit {a.unit_number}</p>
                    <p className="text-slate-400 text-xs">Monthly: R{a.monthly_levy} | Balance due: <span className={a.balance_due > 0 ? "text-rose-400" : "text-emerald-400"}>R{a.balance_due?.toFixed(2)}</span></p>
                    {a.last_payment_date && <p className="text-slate-500 text-xs">Last payment: {a.last_payment_date} — R{a.last_payment_amount}</p>}
                  </div>
                  <Badge className={statusColors[a.status]}>{a.status}</Badge>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 flex-1" onClick={() => setRecordPayment(a)}>
                    <CreditCard className="w-3 h-3 mr-1" /> Record Payment
                  </Button>
                  <Button size="sm" variant="outline" className="border-amber-500 text-amber-400" onClick={() => { const m = Number(a.monthly_levy); updateLevy.mutate({ id: a.id, amount: (a.balance_due || 0) + m }); }}>
                    + Levy
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {levyAccounts.length === 0 && <p className="text-slate-400 text-center py-8">No levy accounts yet</p>}
        </div>
      </div>
    </div>
  );
}