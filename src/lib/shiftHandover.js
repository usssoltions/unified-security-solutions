// Device-local acknowledgement of one completed shift's SDK sign-out action.
// No credentials, names, GPS, customer settings or server records are stored.
const receiptKey = (user) => `uss:shift-handover:${user.customer_id || ""}:${user.id}`;
const sessionFingerprint = async (token) => {
  if (!token) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
};

export async function hasShiftSignOutReceipt(user, shift, sessionToken, storage = window.localStorage) {
  if (!user?.id || !shift?.id || !shift.clock_out?.timestamp) return false;
  try {
    const receipt = JSON.parse(storage.getItem(receiptKey(user)) || "null");
    const currentSession = await sessionFingerprint(sessionToken);
    return !!currentSession && !!receipt?.signed_out_session &&
      receipt.shift_id === shift.id && receipt.clock_out_at === shift.clock_out.timestamp &&
      receipt.signed_out_session !== currentSession;
  } catch {
    return false; // Missing/unavailable storage never bypasses the handover gate.
  }
}

export async function signOutCompletedShift(user, shift, logout, sessionToken, storage = window.localStorage) {
  if (!user?.id || !shift?.id || shift.status !== "completed" || !shift.clock_out?.timestamp || shift.guard_id !== user.id || shift.customer_id !== user.customer_id) {
    throw new Error("The completed shift could not be confirmed. Reload your shift status and try again.");
  }
  const signedOutSession = await sessionFingerprint(sessionToken);
  if (!signedOutSession) throw new Error("Your sign-in session could not be verified. Reload and try again.");
  // The SDK owns credential removal and cookie logout. A receipt is accepted
  // only after a DIFFERENT authenticated session, never in the session closing.
  await logout();
  storage.setItem(receiptKey(user), JSON.stringify({
    shift_id: shift.id,
    clock_out_at: shift.clock_out.timestamp,
    signed_out_session: signedOutSession,
  }));
}