import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CreditCard, TrendingDown, CheckCircle2, Clock, AlertCircle, ExternalLink } from "lucide-react";

const PAYFAST_MERCHANT_ID = "10000100"; // Replace with actual merchant ID
const PAYFAST_MERCHANT_KEY = "46f0cd694581a"; // Replace with actual merchant key
const PAYFAST_URL = "https://sandbox.payfast.co.za/eng/process"; // Use https://www.payfast.co.za/eng/process for production

export default function ResidentPayments() {
  const [user, setUser] = useState(null);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentType, setPaymentType] = useState("levy");
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: levyAccount } = useQuery({
    queryKey: ["levy", user?.id],
    queryFn: async () => {
      const res = await base44.entities.LevyAccount.filter({ resident_id: user?.id });
      return res[0] || null;
    },
    enabled: !!user
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["my_payments", user?.id],
    queryFn: () => base44.entities.Payment.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const initiatePayment = async (amount, description, type) => {
    if (!amount || amount <= 0) { alert("Please enter a valid amount"); return; }

    // Create a pending payment record first
    const payment = await base44.entities.Payment.create({
      resident_id: user.id,
      resident_name: user.full_name,
      unit_number: user.unit_number,
      payment_type: type,
      amount: Number(amount),
      currency: "ZAR",
      status: "pending",
      description: description,
      reference: `PAY-${Date.now()}`
    });

    // Build PayFast form and submit
    const returnUrl = `${window.location.origin}/ResidentPayments?status=success&payment_id=${payment.id}`;
    const cancelUrl = `${window.location.origin}/ResidentPayments?status=cancelled&payment_id=${payment.id}`;
    const notifyUrl = `${window.location.origin}/api/payfast-notify`; // ITN url

    const form = document.createElement("form");
    form.method = "POST";
    form.action = PAYFAST_URL;

    const fields = {
      merchant_id: PAYFAST_MERCHANT_ID,
      merchant_key: PAYFAST_MERCHANT_KEY,
      return_url: returnUrl,
      cancel_url: cancelUrl,
      notify_url: notifyUrl,
      name_first: user.full_name?.split(" ")[0] || "",
      name_last: user.full_name?.split(" ").slice(1).join(" ") || "",
      email_address: user.email || "",
      m_payment_id: payment.id,
      amount: Number(amount).toFixed(2),
      item_name: description,
      item_description: `${user.unit_number} - ${description}`
    };

    Object.entries(fields).forEach(([key, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  };

  // Check for return from PayFast
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const paymentId = params.get("payment_id");

    if (status === "success" && paymentId) {
      base44.entities.Payment.update(paymentId, {
        status: "completed",
        paid_at: new Date().toISOString()
      }).then(() => {
        qc.invalidateQueries(["my_payments"]);
        qc.invalidateQueries(["levy"]);
        window.history.replaceState({}, "", "/ResidentPayments");
      });
    } else if (status === "cancelled" && paymentId) {
      base44.entities.Payment.update(paymentId, { status: "failed" }).then(() => {
        qc.invalidateQueries(["my_payments"]);
        window.history.replaceState({}, "", "/ResidentPayments");
      });
    }
  }, []);

  const statusColors = { pending: "bg-amber-600", completed: "bg-emerald-600", failed: "bg-rose-600", refunded: "bg-sky-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <h1 className="text-2xl font-bold text-white pt-2">Payments</h1>

        {/* Levy Account */}
        {levyAccount && (
          <Card className={`border-0 ${levyAccount.status === "overdue" ? "bg-gradient-to-r from-rose-700 to-rose-600" : "bg-gradient-to-r from-slate-700 to-slate-600"}`}>
            <CardContent className="p-5">
              <p className="text-white/70 text-sm mb-1">Monthly Levy</p>
              <p className="text-white text-3xl font-bold">R {levyAccount.balance_due?.toFixed(2) || "0.00"}</p>
              <p className="text-white/60 text-xs mt-1">Monthly: R{levyAccount.monthly_levy} | Status: {levyAccount.status}</p>
              {levyAccount.last_payment_date && (
                <p className="text-white/60 text-xs">Last paid: {new Date(levyAccount.last_payment_date).toLocaleDateString()} — R{levyAccount.last_payment_amount}</p>
              )}
              {levyAccount.balance_due > 0 && (
                <Button
                  className="mt-3 w-full bg-white text-slate-900 hover:bg-slate-100"
                  onClick={() => initiatePayment(levyAccount.balance_due, `Monthly Levy - Unit ${user?.unit_number}`, "levy")}
                >
                  <CreditCard className="w-4 h-4 mr-2" /> Pay R{levyAccount.balance_due?.toFixed(2)} via PayFast
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Custom Payment */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Make a Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {["levy", "fine", "service", "other"].map(t => (
                <button key={t} onClick={() => setPaymentType(t)} className={`p-2 rounded-lg text-sm font-medium capitalize transition-colors ${paymentType === t ? "bg-sky-500 text-white" : "bg-slate-700 text-slate-400 hover:bg-slate-600"}`}>{t}</button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">R</span>
              <Input
                type="number"
                placeholder="0.00"
                value={customAmount}
                onChange={e => setCustomAmount(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white pl-8"
              />
            </div>
            <Button
              className="w-full bg-sky-500 hover:bg-sky-600"
              onClick={() => initiatePayment(customAmount, `${paymentType} payment - Unit ${user?.unit_number}`, paymentType)}
              disabled={!customAmount}
            >
              <ExternalLink className="w-4 h-4 mr-2" /> Pay with PayFast
            </Button>
            <p className="text-slate-500 text-xs text-center">Secure payment via PayFast · Supports EFT, Credit/Debit Card, Instant EFT</p>
          </CardContent>
        </Card>

        {/* Payment History */}
        <div>
          <h2 className="text-white font-semibold mb-3">Payment History</h2>
          {payments.length === 0 ? (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-8 text-center text-slate-400">No payments yet</CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {payments.map(p => (
                <Card key={p.id} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white text-sm font-medium">{p.description}</p>
                      <p className="text-slate-400 text-xs">{new Date(p.created_date).toLocaleDateString()} · {p.reference}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold">R{p.amount?.toFixed(2)}</p>
                      <Badge className={statusColors[p.status]}>{p.status}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}