import React from "react";
import { useSearchParams } from "react-router-dom";
import CustomerConsole from "@/components/reseller/CustomerConsole";

/**
 * CustomerManagement — route surface for the per-customer management console.
 * The customer id is taken from the `?customer=` query param (set when the
 * reseller/customer card is tapped). Access is gated by ProtectedPage + the
 * role allowlist; the underlying entity reads are RLS-scoped to the caller.
 */
export default function CustomerManagement() {
  const [params] = useSearchParams();
  const customerId = params.get("customer");
  if (!customerId) {
    return <div className="text-center py-20 text-slate-400">No customer selected.</div>;
  }
  return <CustomerConsole customerId={customerId} />;
}