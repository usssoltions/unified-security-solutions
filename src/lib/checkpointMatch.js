/**
 * USS Guard — checkpoint QR matching (patrol scan flow).
 *
 * Matches a decoded QR payload against ONE site's checkpoint list. Used by
 * the guard checkpoint scanner so a patrol checkpoint QR routes to checkpoint
 * matching BEFORE any structured identity-document parsing or review screen.
 *
 * Matching rules:
 *  - SITE-SCOPED: only the checkpoints passed in (the active shift's site)
 *    can ever match — a checkpoint from another site can never match.
 *  - Comparison trims accidental surrounding whitespace on both the decoded
 *    value and the stored value; the stored supplier QR values (e.g. "OR|<ID>")
 *    are otherwise compared exactly — never normalised, never lowercased.
 *  - Supports plain payloads and JSON payloads carrying qr_code/checkpoint_id.
 *  - Returns the matched checkpoint object, or null when nothing matches
 *    (the caller must NEVER fall back to the first checkpoint).
 */
export function matchCheckpoint(checkpoints, rawPayload) {
  const raw = String(rawPayload ?? "").trim();
  if (!raw || !Array.isArray(checkpoints) || checkpoints.length === 0) return null;

  const norm = (v) => String(v ?? "").trim();

  // JSON payloads: try the structured checkpoint references first.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const candidates = [obj.qr_code, obj.checkpoint_id, obj.id]
        .map((v) => norm(v))
        .filter(Boolean);
      for (const cand of candidates) {
        const hit = checkpoints.find(
          (cp) => cp && (norm(cp.qr_code) === cand || norm(cp.id) === cand)
        );
        if (hit) return hit;
      }
      return null; // structured payload that references no checkpoint here
    }
  } catch (_) { /* plain-text payload — fall through */ }

  // Plain payload: exact (trimmed) match on the stored supplier QR value,
  // the checkpoint id, or the checkpoint name.
  return (
    checkpoints.find(
      (cp) =>
        cp &&
        (norm(cp.qr_code) === raw || norm(cp.id) === raw || norm(cp.name) === raw)
    ) || null
  );
}