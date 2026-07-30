/**
 * barKoder Web/WASM Scanner — Service Module (Phase 1 proof-of-concept)
 *
 * Single reusable service responsible for:
 *  - reading the licence key from the environment (never logged or exposed);
 *  - lazy-loading + initializing the SDK (one instance per session);
 *  - configuring decoders (PDF417 + QR only) and SADL formatting;
 *  - starting/stopping scanning;
 *  - parsing results;
 *  - extracting the SADL driver photograph via the official helper;
 *  - cleaning up the camera + DOM resources.
 *
 * IMPORTANT: This module never persists personal data. Results live only in
 * component state for Phase 1. The licence key is never printed to the console,
 * surfaced in errors, or shown in the UI.
 */

const DEBUG_LOG = [];
let barkoderInstance = null;
let barkoderSDKStatic = null;
let initPromise = null;

/* ------------------------------------------------------------------ */
/* Debug log (developer-only, sanitized — no personal data, no key)   */
/* ------------------------------------------------------------------ */

function logDebug(event, meta = {}) {
  DEBUG_LOG.push({ event, ...meta, ts: new Date().toISOString() });
}

export function getDebugLog() {
  return DEBUG_LOG.slice();
}

export function clearDebugLog() {
  DEBUG_LOG.length = 0;
}

/* ------------------------------------------------------------------ */
/* Licence handling                                                    */
/* ------------------------------------------------------------------ */

/**
 * Returns the licence key if configured, otherwise null.
 * Never logs or surfaces partial values.
 */
export function getLicenseKey() {
  const raw = import.meta.env?.VITE_BARKODER_LICENSE_KEY;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  return raw.trim();
}

export function isLicenseConfigured() {
  return getLicenseKey() !== null;
}

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */

function classifyInitError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("license") || msg.includes("licence") || msg.includes("key")) {
    return { type: "license_error", message: "barKoder licence is invalid, expired, or not authorised for this domain." };
  }
  if (msg.includes("wasm") || msg.includes("webassembly")) {
    return { type: "wasm_error", message: "Failed to load the barKoder WebAssembly engine." };
  }
  return { type: "init_error", message: "barKoder scanner failed to initialize." };
}

/* ------------------------------------------------------------------ */
/* Initialization (once per session)                                   */
/* ------------------------------------------------------------------ */

export async function initializeBarkoder() {
  if (barkoderInstance) return barkoderInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const key = getLicenseKey();
    if (!key) {
      throw {
        type: "license_missing",
        message: "barKoder licence key is not configured. Set VITE_BARKODER_LICENSE_KEY before using the scanner."
      };
    }

    // Secure context required for camera + WASM streaming
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw { type: "insecure_context", message: "A secure HTTPS context is required for camera access and WASM streaming." };
    }

    let SDK;
    try {
      // Dynamic import so the SDK reads the #barkoder-container element only
      // after the scanner component has mounted it in the DOM.
      SDK = (await import("barkoder-wasm")).default;
      barkoderSDKStatic = SDK;
    } catch (e) {
      logDebug("wasm_load_error");
      throw { type: "wasm_error", message: "Failed to load the barKoder WebAssembly asset." };
    }

    let Barkoder;
    try {
      Barkoder = await SDK.initialize(key);
    } catch (e) {
      logDebug("init_error", { reason: classifyInitError(e).type });
      throw classifyInitError(e);
    }

    // --- Configure decoders: PDF417 + QR only (driver's licence + QR) ---
    Barkoder.setEnabledDecoders(
      Barkoder.constants.Decoders.PDF417,
      Barkoder.constants.Decoders.QR
    );

    // --- Enable the official South African Driver's Licence (SADL) parser ---
    // Constants.Formatting.SADL === 4
    try {
      Barkoder.setFormatting(Barkoder.constants.Formatting.SADL);
    } catch (_) {
      logDebug("sadl_formatting_unavailable");
    }

    // Optional beta option for SA ID decode (best-effort, not required for DL)
    try {
      const setter = Barkoder.setCustomOption || barkoderSDKStatic?.setCustomOption;
      if (typeof setter === "function") setter.call(Barkoder, "SADL_decode_ID", 1);
    } catch (_) { /* optional */ }

    // --- Camera + decoding settings ---
    Barkoder.setCameraResolution(Barkoder.constants.CameraResolution.FHD);
    Barkoder.setDecodingSpeed(Barkoder.constants.DecodingSpeed.Normal);
    // Single-result mode: stop after the first valid decode
    Barkoder.setContinuous(false);

    // --- On-screen UI controls (provided by the SDK overlay) ---
    Barkoder.setFlashEnabled(true);   // torch button available when supported
    Barkoder.setZoomEnabled(false);
    Barkoder.setCloseEnabled(false);
    Barkoder.setCameraPickerEnabled(false); // we render our own camera selector

    barkoderInstance = Barkoder;
    logDebug("sdk_initialized");
    logDebug("wasm_loaded");
    return Barkoder;
  })();

  return initPromise;
}

/* ------------------------------------------------------------------ */
/* Camera helpers                                                      */
/* ------------------------------------------------------------------ */

export async function getCameras() {
  const bk = await initializeBarkoder();
  const cams = await bk.getCameras();
  return cams || [];
}

export async function setCameraId(id) {
  const bk = await initializeBarkoder();
  bk.setCameraId(id);
}

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

export function startScanner(callback) {
  if (!barkoderInstance) {
    throw { type: "not_initialized", message: "Scanner is not initialized." };
  }
  barkoderInstance.startScanner(callback);
}

export function stopScanner() {
  if (barkoderInstance) {
    try { barkoderInstance.stopScanner(); } catch (_) {}
  }
}

export function toggleFlash() {
  if (barkoderInstance) {
    try { barkoderInstance.changeFlashState(); } catch (_) {}
  }
}

/* ------------------------------------------------------------------ */
/* Result parsing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Normalises the raw SDK result into a stable structure.
 * Does NOT assume SADL field names — preserves the complete parsed object.
 */
export function parseResult(rawResult) {
  // The SDK may deliver a single result at the top level or inside a results array.
  const single = (rawResult?.results && rawResult.results.length > 0)
    ? rawResult.results[0]
    : rawResult;

  const barcodeType = single?.barcodeTypeName || rawResult?.barcodeTypeName || "Unknown";
  const textualData = single?.textualData ?? rawResult?.textualData ?? "";
  const timestamp = new Date().toISOString();

  let formattedJSON = null;
  let formattedText = textualData;
  let malformedJSON = false;

  if (textualData) {
    try {
      const obj = JSON.parse(textualData);
      if (obj && typeof obj === "object") {
        formattedJSON = obj; // preserve complete original parsed object
        formattedText = textualData;
      }
    } catch (_) {
      formattedJSON = null;
      malformedJSON = !!textualData; // looked like JSON-ish but failed to parse
    }
  }

  return {
    barcodeType,
    textualData,
    formattedJSON,
    formattedText,
    // binaryData is not exposed by this SDK version; record presence only.
    binaryDataPresent: !!(single?.binaryData || rawResult?.binaryData),
    timestamp,
    parsed: !!formattedJSON,
    malformedJSON,
    rawResultKeys: rawResult ? Object.keys(rawResult) : []
  };
}

/**
 * Extracts the embedded SADL driver photograph using the official SDK helper.
 * Returns a data URL (PNG) or null when no photograph is present.
 */
export async function getSadlPhoto(textualData) {
  if (!textualData) return null;
  const bk = await initializeBarkoder();
  try {
    const imageData = await bk.getSADLImage(textualData);
    if (!imageData) return null;
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */

export function resetInstance() {
  stopScanner();
  barkoderInstance = null;
  initPromise = null;
}

export { logDebug };