/**
 * USS Guard — Network Diagnostics (Phase 3 — Temporary Diagnostic Mode)
 *
 * A development/admin-only diagnostic that logs significant network requests
 * (timestamp, module, operation, approximate request/response size,
 * foreground/background state) to a ring buffer and the browser console.
 *
 * It works by wrapping window.fetch — since the Base44 SDK uses fetch
 * internally, this captures ALL API traffic (entity queries, function
 * invokes, auth calls, integrations) without modifying any component.
 *
 * PRIVACY: logs URL + sizes only — NEVER request/response bodies, tokens,
 * licence keys, ID numbers, or other sensitive data.
 *
 * TOGGLE:  localStorage.setItem('uss_net_diag', '1')  → enable
 *          localStorage.setItem('uss_net_diag', '0')  → disable
 *          Or call enableDiagnostics() / disableDiagnostics() programmatically.
 *
 * The diagnostic is DISABLED by default in production. It adds zero overhead
 * when disabled (the original fetch is restored).
 */

const BUFFER_SIZE = 500;
let _buffer = [];
let _enabled = false;
let _origFetch = null;
let _totalBytes = { up: 0, down: 0, count: 0 };

function isDiagEnabled() {
  try {
    return localStorage.getItem("uss_net_diag") === "1";
  } catch (_) {
    return false;
  }
}

function classifyUrl(url) {
  // Map a fetch URL to a module/operation label — no sensitive params logged
  const u = String(url || "");
  if (u.includes("/api/entities/") || u.includes("/entities/")) {
    const m = u.match(/\/(?:api\/entities\/|entities\/)([^/?]+)/);
    return { module: "Entity", operation: m ? m[1] : "unknown" };
  }
  if (u.includes("/api/functions/") || u.includes("/functions/")) {
    const m = u.match(/\/(?:api\/functions\/|functions\/)([^/?]+)/);
    return { module: "Function", operation: m ? m[1] : "unknown" };
  }
  if (u.includes("/api/auth") || u.includes("/auth")) return { module: "Auth", operation: "me" };
  if (u.includes("onesignal.com")) return { module: "Push", operation: "onesignal" };
  if (u.includes("barkoder") || u.includes(".wasm")) return { module: "Scanner", operation: "asset" };
  if (u.includes("cdn.onesignal")) return { module: "Push", operation: "sdk" };
  return { module: "Other", operation: "fetch" };
}

function approxRequestSize(init) {
  if (!init) return 0;
  if (init.body instanceof Blob) return init.body.size;
  if (init.body instanceof ArrayBuffer) return init.body.byteLength;
  if (typeof init.body === "string") return init.body.length;
  if (init.body instanceof FormData) return -1; // can't measure easily
  return 0;
}

function logEntry(entry) {
  _buffer.push(entry);
  if (_buffer.length > BUFFER_SIZE) _buffer.shift();
  if (entry.respSize > 50000 || entry.reqSize > 50000) {
    // Only log large requests to console to avoid spam
    console.log(
      `[NET] ${entry.ts} ${entry.module}/${entry.operation} ` +
      `↑${formatSize(entry.reqSize)} ↓${formatSize(entry.respSize)} ` +
      `(${entry.fg ? "FG" : "BG"})`
    );
  }
}

function formatSize(bytes) {
  if (bytes < 0) return "?";
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / 1048576).toFixed(2) + "MB";
}

/**
 * Enable the fetch wrapper. Safe to call multiple times.
 */
export function enableDiagnostics() {
  if (_enabled) return;
  _enabled = true;
  try { localStorage.setItem("uss_net_diag", "1"); } catch (_) {}
  _origFetch = window.fetch;
  _totalBytes = { up: 0, down: 0, count: 0 };

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const { module, operation } = classifyUrl(url);
    const reqSize = approxRequestSize(init);
    const fg = document.visibilityState === "visible";
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

    const response = await _origFetch.call(window, input, init);

    // Measure response size without consuming the body — clone reads it
    try {
      const clone = response.clone();
      const blob = await clone.blob();
      const respSize = blob.size;
      _totalBytes.up += Math.max(0, reqSize);
      _totalBytes.down += respSize;
      _totalBytes.count++;
      logEntry({ ts, module, operation, reqSize: Math.max(0, reqSize), respSize, fg });
    } catch (_) {
      logEntry({ ts, module, operation, reqSize: Math.max(0, reqSize), respSize: 0, fg });
    }

    return response;
  };
  console.log("[NET DIAG] Enabled — fetch wrapper active");
}

/**
 * Disable the fetch wrapper and restore the original fetch.
 */
export function disableDiagnostics() {
  if (!_enabled) return;
  _enabled = false;
  try { localStorage.setItem("uss_net_diag", "0"); } catch (_) {}
  if (_origFetch) {
    window.fetch = _origFetch;
    _origFetch = null;
  }
  console.log("[NET DIAG] Disabled — fetch restored");
}

/**
 * Get the current diagnostic buffer (most recent entries first).
 */
export function getDiagnosticLog() {
  return _buffer.slice().reverse();
}

/**
 * Get cumulative totals: { count, upBytes, downBytes }.
 */
export function getDiagnosticTotals() {
  return {
    count: _totalBytes.count,
    upBytes: _totalBytes.up,
    downBytes: _totalBytes.down,
    upFormatted: formatSize(_totalBytes.up),
    downFormatted: formatSize(_totalBytes.down),
  };
}

/** Clear the buffer and reset totals. */
export function clearDiagnosticLog() {
  _buffer = [];
  _totalBytes = { up: 0, down: 0, count: 0 };
}

/**
 * Auto-enable on module load if the flag is already set (e.g. the admin
 * toggled it in a previous session). No-op if disabled.
 */
export function initDiagnostics() {
  if (isDiagEnabled()) enableDiagnostics();
}