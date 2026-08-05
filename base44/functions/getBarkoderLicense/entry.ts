/**
 * getBarkoderLicense
 *
 * Returns the barKoder Web/WASM licence key to an authenticated app user so
 * the client SDK can call Barkoder.initialize(key). The key is stored as the
 * BARKODER_LICENSE_KEY secret and is never logged.
 *
 * We require an authenticated session so the key is not exposed anonymously.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const key = Deno.env.get("BARKODER_LICENSE_KEY") || "";
    if (!key) {
      return Response.json({ error: "Barkoder licence not configured" }, { status: 503 });
    }

    return Response.json({ key });
  } catch (error) {
    return Response.json({ error: error?.message || "Failed to load licence" }, { status: 500 });
  }
});