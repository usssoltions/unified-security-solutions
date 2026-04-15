import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Plus, Search, AlertTriangle, CheckCircle2, X } from "lucide-react";

export default function LevyManagement() {
  const [user, setUser] = useState(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [debitAmount, setDebitAmount] = useState("");
  const [description, setDescription] = useState("");
  const [newForm, setNewForm] = useState({ resident_id: "", resident_name: "", unit_number: "", monthly_levy: "" });
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: accounts = [] } = useQuery({ queryKey: ["all_levy_mgmt"], queryFn: () => base44.entities.LevyAccount.list(), initialData: [] });
  const { data: residents = [] } = useQuery({ queryKey: ["residents_list"], queryFn: () => base44.entities.Resident.list(), initialData: [] });
  const { data: payments = [] } = useQuery({ queryKey: ["all_payments_mgmt"], queryFn: () => base44.entities.Payment.list("-created_date", 100), initialData: [] });

  const createAccountMutation = useMutation({
    mutationFn: (data) => base44.entities.LevyAccount.create({ ...data, monthly_levy: parseFloat(data.monthly_levy), balance_due: parseFloat(data.monthly_levy) }),
    onSuccess: () => { qc.invalidateQueries(["all_levy_mgmt"]); setShowForm(false); }
  });

  const creditMutation = useMutation({
    mutationFn: async ({ account, amount, desc }) => {
      const newBalance = (account.balance_due || 0) - parseFloat(amount);
      const statement = [...(account.statements || []), { date: new Date().toLocaleDateString(), description: desc || "Payment received", credit: parseFloat(amount), debit: 0, balance: newBalance }];
      return await base44.entities.LevyAccount.update(account.id, {
        balance_due: Math.max(0, newBalance),
        last_payment_date: new Date().toISOString().split("T")[0],
        last_payment_amount: parseFloat(amount),
        status: newBalance <= 0 ? "current" : account.status,
        statements: statement
      });
    },
    onSuccess: () => { qc.invalidateQueries(["all_levy_mgmt"]); setSelectedAccount(null); setCreditAmount(""); }
  });

  const debitMutation = useMutation({
    mutationFn: async ({ account, amount, desc }) => {
      const newBalance = (account.balance_due || 0) + parseFloat(amount);
      const statement = [...(account.statements || []), { date: new Date().toLocaleDateString(), description: desc || "Charge added", debit: parseFloat(amount), credit: 0, balance: newBalance }];
      return await base44.entities.LevyAccount.update(account.id, {
        balance_due: newBalance,
        status: newBalance > account.monthly_levy ? "overdue" : "current",
        statements: statement
      });
    },
    onSuccess: () => { qc.invalidateQueries(["all_levy_mgmt"]); setSelectedAccount(null); setDebitAmount(""); }
  });

  const filtered = accounts.filter(a =>
    !search || a.unit_number?.includes(search) || a.resident_name?.toLowerCase().includes(search.toLowerCase())
  );

  const overdueAccounts = filtered.filter(a => a.status === "overdue");
  const currentAccounts = filtered.filter(a => a.status === "current");
  const totalOutstanding = accounts.reduce((sum, a) => sum + (a.balance_due || 0), 0);
  const totalRevenue = payments.filter(p => p.status === "completed" && p.payment_type === "levy").reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-4xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-emerald-400" /> Levy Management
          </h1>
          <Button onClick={() => setShowForm(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-2" /> Add Account
          </Button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-rose-400">R{totalOutstanding.toFixed(2)}</p>
              <p className="text-xs text-slate-400">Outstanding</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-amber-400">{overdueAccounts.length}</p>
              <p className="text-xs text-slate-400">Overdue</p>
            </CardContent>
          </Card>
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <p className="text-xl font-bold text-emerald-400">R{totalRevenue.toFixed(2)}</p>
              <p className="text-xs text-slate-400">Collected</p>
            </CardContent>
          </Card>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">New Levy Account</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <select
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2.5"
                onChange={e => {
                  const r = residents.find(r => r.id === e.target.value);
                  if (r) setNewForm({ ...newForm, resident_id: r.id, resident_name: r.full_name, unit_number: r.unit_number });
                }}
              >
                <option value="">Select resident...</option>
                {residents.map(r => <option key={r.id} value={r.id}>{r.full_name} – Unit {r.unit_number}</option>)}
              </select>
              <Input placeholder="Unit number" value={newForm.unit_number} onChange={e => setNewForm({ ...newForm, unit_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input type="number" placeholder="Monthly levy (R)" value={newForm.monthly_levy} onChange={e => setNewForm({ ...newForm, monthly_levy: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Button className="w-full bg-emerald-600" onClick={() => createAccountMutation.mutate(newForm)} disabled={!newForm.unit_number || !newForm.monthly_levy}>Create Account</Button>
            </CardContent>
          </Card>
        )}

        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input placeholder="Search unit or resident..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 bg-slate-800 border-slate-700 text-white" />
        </div>

        <Tabs defaultValue="overdue">
          <TabsList className="grid grid-cols-2 bg-slate-800/50">
            <TabsTrigger value="overdue">Overdue ({overdueAccounts.length})</TabsTrigger>
            <TabsTrigger value="all">All ({filtered.length})</TabsTrigger>
          </TabsList>
          {["overdue", "all"].map(tab => (
            <TabsContent key={tab} value={tab} className="space-y-2 mt-4">
              {(tab === "overdue" ? overdueAccounts : filtered).map(a => (
                <Card key={a.id} className={`border ${a.status === "overdue" ? "border-rose-500/30 bg-rose-500/5" : "border-slate-700 bg-slate-800/50"}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">Unit {a.unit_number}</p>
                      <p className="text-slate-400 text-sm">{a.resident_name}</p>
                      <p className="text-slate-500 text-xs">Monthly: R{a.monthly_levy}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <p className={`font-bold ${a.balance_due > 0 ? "text-rose-400" : "text-emerald-400"}`}>R{a.balance_due?.toFixed(2)}</p>
                      <Badge className={a.status === "overdue" ? "bg-rose-600" : "bg-emerald-600"}>{a.status}</Badge>
                      <Button size="sm" className="bg-sky-600 hover:bg-sky-700 h-6 text-xs" onClick={() => setSelectedAccount(a)}>Manage</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          ))}
        </Tabs>

        {/* Account Management Modal */}
        {selectedAccount && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-md bg-slate-800 border-slate-700">
              <CardHeader className="border-b border-slate-700 pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white">Unit {selectedAccount.unit_number}</CardTitle>
                  <Button variant="ghost" size="icon" onClick={() => setSelectedAccount(null)}><X /></Button>
                </div>
                <p className="text-slate-400 text-sm">{selectedAccount.resident_name} • Balance: R{selectedAccount.balance_due?.toFixed(2)}</p>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="space-y-2">
                  <p className="text-emerald-400 font-medium text-sm">Record Payment (Credit)</p>
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Amount" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                    <Button className="bg-emerald-600" onClick={() => creditMutation.mutate({ account: selectedAccount, amount: creditAmount, desc: description || "Payment received" })} disabled={!creditAmount}>Credit</Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-amber-400 font-medium text-sm">Add Charge (Debit)</p>
                  <Input placeholder="Description (e.g. Fine, Special levy)" value={description} onChange={e => setDescription(e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                  <div className="flex gap-2">
                    <Input type="number" placeholder="Amount" value={debitAmount} onChange={e => setDebitAmount(e.target.value)} className="bg-slate-900 border-slate-700 text-white" />
                    <Button className="bg-amber-600" onClick={() => debitMutation.mutate({ account: selectedAccount, amount: debitAmount, desc: description })} disabled={!debitAmount}>Debit</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}