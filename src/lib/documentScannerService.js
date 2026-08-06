/**
 * USS Guard — Document Scanner Service (Phase 3)
 *
 * The single, central document-scanning engine for the whole platform.
 * One SDK instance, one camera, reusable across every module.
 *
 * Capabilities:
 *  - Lazy init + per-profile decoder/formatting configuration
 *  - Automatic document detection (auto profile enables all decoders,
 *    resolveDocument() routes to the correct processing profile)
 *  - Full SADL (SA Driver's Licence) field mapping
 *  - Vehicle licence disc + Smart ID + Passport MRZ mappers (prepared)
 *  - Generic QR + generic 1D/2D barcode pipelines
 *  - SADL driver photograph extraction
 *  - Verbatim raw JSON preserved for every scan
 *
 * Adding a new document type = add an entry to SCAN_PROFILES (+ a mapper
 * branch in extractMappedFields if needed). No component changes.
 *
 * Privacy: the licence key is never logged, surfaced in errors, or shown.
 */
import { processQR } from "@/lib/qrProcessor";
// The barKoder WASM binaries are copied into /public so they are served at a
// fixed absolute URL (works in the Vite dev server, the production build and
// the Android WebView wrapper). barKoder 1.7+ resolves the WASM relative to
// window.location.href unless an absolute wasmPath is supplied.
const WASM_SIMD_URL = "/barkoder.wasm";
const WASM_NO_SIMD_URL = "/barkoder_nosimd.wasm";

export const SDK_VERSION = "barkoder-wasm@1.7.0";

const DEBUG_LOG = [];
let barkoderInstance = null;
let barkoderSDKStatic = null;
let initPromise = null;
let currentProfileId = null;

/* ------------------------------------------------------------------ */
/* Persistent scanner container                                        */
/* ------------------------------------------------------------------ */
// barKoder captures `document.getElementById('barkoder-container')` ONCE,
// as a static class field at module-load time, and attaches the camera
// preview to that element on every scan. If that element is ever removed
// from the DOM (a React modal unmounting), the SDK keeps pointing at the
// detached node and the live feed never appears — the scanner hangs on
// "Starting camera…". To honour the SDK's documented div-id contract while
// surviving React remounts, we create ONE persistent #barkoder-container
// when this module loads (before the SDK is imported, so the SDK captures
// it) and reuse it for every scanner open: move it into the active
// scanner's host on mount, park it (hidden) in <body> on unmount, but
// NEVER destroy it. The SDK's cached reference therefore always points at
// a live element.
let scannerContainerEl = null;

export function ensureScannerContainer() {
  if (typeof document === "undefined") return null;
  if (scannerContainerEl && document.body.contains(scannerContainerEl)) return scannerContainerEl;
  const existing = document.getElementById("barkoder-container");
  if (existing) { scannerContainerEl = existing; return existing; }
  const el = document.createElement("div");
  el.id = "barkoder-container";
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.background = "#000";
  document.body.appendChild(el);
  scannerContainerEl = el;
  return el;
}

export function mountScannerContainer(hostEl) {
  const el = ensureScannerContainer();
  if (!el || !hostEl) return el;
  if (el.parentNode !== hostEl) hostEl.appendChild(el);
  el.style.position = "absolute";
  el.style.left = "0";
  el.style.top = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  return el;
}

export function unmountScannerContainer() {
  const el = scannerContainerEl || (typeof document !== "undefined" && document.getElementById("barkoder-container"));
  if (!el) return;
  if (el.parentNode !== document.body) document.body.appendChild(el);
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
}

// Create the persistent container as soon as this module loads — it must
// exist before the barKoder SDK module is imported (the SDK captures it).
ensureScannerContainer();

/* ------------------------------------------------------------------ */
/* Debug log (sanitized — no personal data, no key)                    */
/* ------------------------------------------------------------------ */
function logDebug(event, meta = {}) {
  DEBUG_LOG.push({ event, ...meta, ts: new Date().toISOString() });
}
export function getDebugLog() { return DEBUG_LOG.slice(); }
export function clearDebugLog() { DEBUG_LOG.length = 0; }

/* ------------------------------------------------------------------ */
/* Scan profiles — the single registry of document types               */
/* ------------------------------------------------------------------ */
export const SCAN_PROFILES = {
  auto: {
    id: "auto", label: "Auto Detect",
    decoders: ["PDF417", "QR", "Datamatrix", "Aztec", "Code128", "Code93", "Code39"],
    // SADL formatting is the South-African PDF417 parser family (DL + ID + disc).
    // It only applies to PDF417; QR/1D barcodes still return their raw payload.
    formatting: "SADL", supportsPhoto: false, mapper: "auto",
    status: "active", instruction: "Align the document / barcode inside the frame",
  },
  drivers_licence: {
    id: "drivers_licence", label: "Driver's Licence",
    decoders: ["PDF417"], formatting: "SADL", supportsPhoto: true, mapper: "sadl",
    status: "active", instruction: "Align the PDF417 barcode on the back of the licence inside the frame",
  },
  vehicle_disc: {
    id: "vehicle_disc", label: "Vehicle Licence Disc",
    // SA vehicle licence disc (MVL) is parsed by the SADL formatter + the
    // SADL_decode_vehicle_disk custom option (barKoder docs).
    decoders: ["PDF417"], formatting: "SADL", supportsPhoto: false, mapper: "vehicle_disc",
    status: "active", instruction: "Align the barcode on the vehicle licence disc inside the frame",
  },
  sa_id: {
    id: "sa_id", label: "SA ID Card / Book",
    // SA ID card/book PDF417 is parsed by the SADL formatter + the
    // SADL_decode_ID custom option (barKoder docs). Code39 kept as a fallback
    // for the older ID book 1D barcode (raw 13-digit ID -> backstop parser).
    decoders: ["PDF417", "Code39"], formatting: "SADL", supportsPhoto: false, mapper: "sa_id",
    status: "active", instruction: "Align the PDF417 barcode on the SA ID card inside the frame",
  },
  passport_mr: {
    id: "passport_mr", label: "Passport (MRZ)",
    decoders: ["PDF417"], formatting: null, supportsPhoto: false, mapper: "mrz",
    status: "planned", instruction: "Align the MRZ at the bottom of the passport inside the frame",
  },
  qr: {
    id: "qr", label: "QR / Barcode",
    // Universal gate scanner: QR + 2D + common 1D (incl. product barcodes) +
    // PDF417. Formatting stays Disabled so the raw payload is returned verbatim
    // and passed straight into the QR access workflow.
    decoders: ["QR", "Datamatrix", "Aztec", "PDF417", "Code128", "Code93", "Code39", "Ean13", "Ean8", "UpcA", "UpcE"],
    formatting: null, supportsPhoto: false, mapper: "qr",
    status: "active", instruction: "Align the QR code or barcode inside the frame",
  },
  resident_qr: { id: "resident_qr", label: "Resident QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "resident", status: "active", instruction: "Align the resident QR code inside the frame" },
  visitor_qr: { id: "visitor_qr", label: "Visitor QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "visitor", status: "active", instruction: "Align the visitor QR code inside the frame" },
  contractor_qr: { id: "contractor_qr", label: "Contractor QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "contractor", status: "active", instruction: "Align the contractor QR code inside the frame" },
  staff_qr: { id: "staff_qr", label: "Staff QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "staff", status: "active", instruction: "Align the staff QR code inside the frame" },
  courier_qr: { id: "courier_qr", label: "Courier QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "courier", status: "active", instruction: "Align the courier QR code inside the frame" },
  delivery_qr: { id: "delivery_qr", label: "Delivery QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "delivery", status: "active", instruction: "Align the delivery QR code inside the frame" },
  access_qr: { id: "access_qr", label: "Access QR", decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr", qrType: "access", status: "active", instruction: "Align the access QR code inside the frame" },
  asset_barcode: { id: "asset_barcode", label: "Asset Barcode", decoders: ["Code128", "Code39", "DataMatrix"], formatting: null, supportsPhoto: false, mapper: "generic_barcode", status: "active", instruction: "Align the asset barcode inside the frame" },
  parcel_barcode: { id: "parcel_barcode", label: "Parcel Barcode", decoders: ["Code128", "Code39"], formatting: null, supportsPhoto: false, mapper: "generic_barcode", status: "active", instruction: "Align the parcel barcode inside the frame" },
  vin_barcode: { id: "vin_barcode", label: "VIN Barcode", decoders: ["Code39", "Code128", "DataMatrix"], formatting: null, supportsPhoto: false, mapper: "generic_barcode", status: "active", instruction: "Align the VIN barcode inside the frame" },
};

export function getProfile(profileId) {
  return SCAN_PROFILES[profileId] || SCAN_PROFILES.auto;
}

/* ------------------------------------------------------------------ */
/* Licence handling                                                    */
/* ------------------------------------------------------------------ */
let resolvedKey = null;
let keyPromise = null;

export function getLicenseKey() {
  const raw = import.meta.env?.VITE_BARKODER_LICENSE_KEY;
  if (typeof raw === "string" && raw.trim().length > 0) return raw.trim();
  return resolvedKey;
}
export function isLicenseConfigured() { return getLicenseKey() !== null; }

/**
 * Resolves the licence key: Vite env first, then the authenticated
 * getBarkoderLicense backend function (which reads the BARKODER_LICENSE_KEY
 * secret). Cached for the session.
 */
async function resolveLicenseKey() {
  const envKey = import.meta.env?.VITE_BARKODER_LICENSE_KEY;
  if (typeof envKey === "string" && envKey.trim().length > 0) return envKey.trim();
  if (resolvedKey) return resolvedKey;
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    try {
      const { base44 } = await import("@/api/base44Client");
      const { data } = await base44.functions.invoke("getBarkoderLicense", {});
      if (data?.key) {
        resolvedKey = data.key;
        logDebug("license_loaded", { source: "backend" });
        console.log("[barKoder] license_loaded (backend)");
        return resolvedKey;
      }
      throw new Error("No key returned");
    } catch (e) {
      logDebug("license_load_failed", { reason: String(e?.message || e) });
      console.error("[barKoder] license_load_failed", e?.message || e);
      keyPromise = null;
      throw { type: "license_missing", message: "barKoder licence key is not configured. Set BARKODER_LICENSE_KEY (app secret) or VITE_BARKODER_LICENSE_KEY." };
    }
  })();
  return keyPromise;
}

/* ------------------------------------------------------------------ */
/* Error classification                                                */
/* ------------------------------------------------------------------ */
function classifyInitError(err) {
  const raw = String(err?.message || err || "");
  const msg = raw.toLowerCase();
  const detail = raw ? ` [${raw.slice(0, 180)}]` : "";
  if (msg.includes("license") || msg.includes("licence") || msg.includes("key"))
    return { type: "license_error", message: "barKoder licence is invalid, expired, or not authorised for this domain." + detail };
  if (msg.includes("wasm") || msg.includes("webassembly"))
    return { type: "wasm_error", message: "Failed to load the barKoder WebAssembly engine." + detail };
  return { type: "init_error", message: "barKoder scanner failed to initialize." + detail };
}

/* ------------------------------------------------------------------ */
/* Initialization (once per session)                                   */
/* ------------------------------------------------------------------ */
export async function initializeBarkoder() {
  if (barkoderInstance) return barkoderInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const key = await resolveLicenseKey();
    if (!key) throw { type: "license_missing", message: "barKoder licence key is not configured. Set BARKODER_LICENSE_KEY (app secret) or VITE_BARKODER_LICENSE_KEY." };
    if (typeof window !== "undefined" && !window.isSecureContext)
      throw { type: "insecure_context", message: "A secure HTTPS context is required for camera access and WASM streaming." };

    let SDK;
    try { SDK = (await import("barkoder-wasm")).default; barkoderSDKStatic = SDK; console.log("[barKoder] wasm_loaded"); }
    catch (e) { logDebug("wasm_load_error"); console.error("[barKoder] wasm_load_error", e); throw { type: "wasm_error", message: "Failed to load the barKoder WebAssembly asset." }; }

    let Barkoder;
    try {
      // Always use the no-SIMD build — it is universally compatible across the
      // Android WebView and avoids instantiation failures that occur on devices
      // that report SIMD support but reject the SIMD binary at runtime.
      Barkoder = await SDK.initialize(key, { wasmPath: WASM_NO_SIMD_URL, useMainThreadOnly: true });
      console.log("[barKoder] sdk_initialized (license OK)", { wasm: WASM_NO_SIMD_URL, mainThread: true });
    }
    catch (e) { logDebug("init_error", { reason: classifyInitError(e).type }); console.error("[barKoder] init_error", e); throw classifyInitError(e); }

    // NOTE: setCameraResolution(FHD) was removed — it forces 1920×1080 and on
    // several Android rear cameras getUserMedia rejects with OverconstrainedError,
    // so the feed never starts and the scanner hangs on "Starting camera…". The
    // SDK default resolution is the one barKoder tested with and the one that
    // worked for SADL originally.
    Barkoder.setDecodingSpeed(Barkoder.constants.DecodingSpeed.Normal);
    Barkoder.setContinuous(false);
    Barkoder.setFlashEnabled(true);
    Barkoder.setZoomEnabled(false);
    Barkoder.setCloseEnabled(false);
    Barkoder.setCameraPickerEnabled(false);

    barkoderInstance = Barkoder;
    logDebug("sdk_initialized");
    logDebug("wasm_loaded");
    return Barkoder;
  })();

  return initPromise;
}

/* ------------------------------------------------------------------ */
/* Per-profile configuration                                           */
/* ------------------------------------------------------------------ */
export async function configureForProfile(profileId) {
  const bk = await initializeBarkoder();
  const profile = getProfile(profileId);
  if (profile.status !== "active") return { profile, supported: false };

  const D = bk.constants.Decoders;
  const decoderArgs = (profile.decoders || []).map((n) => D[n]).filter((v) => v !== undefined && v !== null);
  try { if (decoderArgs.length) bk.setEnabledDecoders(...decoderArgs); } catch (_) { /* some versions take an array */ }

  try {
    if (profile.formatting) {
      const fmt = bk.constants.Formatting[profile.formatting];
      if (fmt !== undefined && fmt !== null) bk.setFormatting(fmt);
      console.log("[barKoder] setFormatting", profile.formatting, "=>", fmt);
      logDebug("formatting_set", { formatting: profile.formatting, value: fmt });
    } else {
      bk.setFormatting(bk.constants.Formatting.Disabled);
      console.log("[barKoder] setFormatting Disabled");
      logDebug("formatting_set", { formatting: "Disabled" });
    }
  } catch (_) { logDebug("formatting_unavailable", { formatting: profile.formatting }); }

  try {
    // SADL formatting is the South-African PDF417 parser family. The SA ID and
    // SA Vehicle Licence Disc parsers are BETA custom options that must be
    // enabled explicitly alongside SADL formatting (barKoder docs):
    //   setCustomOption("SADL_decode_ID", 1)            -> SA ID card/book parser
    //   setCustomOption("SADL_decode_vehicle_disk", 1) -> SA vehicle licence disc parser
    // Both are harmless for a DL scan (the base SADL parser still handles it),
    // and they let a single SADL-configured profile parse any SA PDF417 document.
    if (profile.formatting === "SADL") {
      const setter = bk.setCustomOption || barkoderSDKStatic?.setCustomOption;
      if (typeof setter === "function") {
        setter.call(bk, "SADL_decode_ID", 1);
        setter.call(bk, "SADL_decode_vehicle_disk", 1);
        console.log("[barKoder] SADL custom options enabled (decode_ID + decode_vehicle_disk)");
        logDebug("sadl_options_enabled", { profile: profileId });
      }
    }
  } catch (_) { /* optional */ }

  currentProfileId = profileId;
  logDebug("profile_configured", { profile: profileId });
  return { profile, supported: true };
}

export function getCurrentProfileId() { return currentProfileId; }

/* ------------------------------------------------------------------ */
/* Camera helpers                                                      */
/* ------------------------------------------------------------------ */
export async function getCameras() { const bk = await initializeBarkoder(); return (await bk.getCameras()) || []; }
export async function setCameraId(id) { const bk = await initializeBarkoder(); bk.setCameraId(id); }

/**
 * Picks the primary rear camera, hiding duplicate telephoto/macro back cameras
 * that some Android devices (e.g. Cubot King Kong ES) expose as "camera 0/1/2".
 * Prefers a remembered choice, then the back camera with the lowest index
 * (typically the primary wide rear module).
 */
export function pickPrimaryRearCamera(cameras) {
  if (!cameras || cameras.length === 0) return null;
  const isBack = (c) => /back|rear|environment/i.test(c.label || "") || /back|rear|environment/i.test(c.facingMode || "");
  const back = cameras.filter(isBack);
  const pool = back.length ? back : cameras;
  try {
    const remembered = localStorage.getItem("barkoder_camera_id");
    if (remembered) {
      const m = pool.find((c) => String(c.id || c.deviceId) === remembered);
      if (m) return m;
    }
  } catch (_) {}
  const idxOf = (c) => {
    const m = /camera\s*(\d+)/i.exec(c.label || "");
    return m ? parseInt(m[1], 10) : 9999;
  };
  return pool.slice().sort((a, b) => idxOf(a) - idxOf(b))[0];
}

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */
// Guards against two startScanner() calls racing (e.g. React StrictMode
// double-mount). The barKoder SDK hangs if startScanner is invoked while a
// previous camera session is still opening.
let scannerActive = false;
export function isScannerActive() { return scannerActive; }

export function startScanner(callback) {
  if (!barkoderInstance) throw { type: "not_initialized", message: "Scanner is not initialized." };
  if (scannerActive) { console.warn("[barKoder] startScanner ignored — camera already starting"); return; }
  scannerActive = true;
  console.log("[barKoder] startScanner (engine reused, continuous)");
  logDebug("startScanner", { reused: true });
  barkoderInstance.startScanner(callback);
}
export function stopScanner() {
  if (barkoderInstance) { try { barkoderInstance.stopScanner(); } catch (_) {} }
  scannerActive = false;
  console.log("[barKoder] stopScanner (camera released, engine kept in memory)");
  logDebug("stopScanner");
}
export function toggleFlash() { if (barkoderInstance) { try { barkoderInstance.changeFlashState(); } catch (_) {} } }

/**
 * The SDK selects the rear camera on its own via getUserMedia
 * ({ facingMode: "environment" }) and manages its own cached camera id
 * (CAMED_CAMERA_ID_KEY). We deliberately do NOT inject a deviceId here: a
 * stale localStorage id from a previous device/session would make
 * getUserMedia({ deviceId: { exact: <gone> } }) reject with NotFoundError and
 * the camera would never open. Let the SDK's defaults handle camera choice.
 */
export async function applyRememberedCamera() { /* no-op — SDK defaults to rear camera */ }

/**
 * After the camera is already running (permission granted), enumerate the
 * physical cameras and pick the best rear autofocus module. This avoids the
 * redundant getUserMedia permission round-trip that hangs the Android WebView
 * when getCameras() is called before startScanner. The choice is persisted for
 * the next open — it does NOT restart the active scan.
 */
export async function autoSelectRearCamera() {
  try {
    const bk = await initializeBarkoder();
    if (!bk.getCameras) return;
    const cameras = await bk.getCameras();
    if (!cameras || !cameras.length) return;
    // Only refine when the device actually labels cameras as back/rear. When
    // labels are generic ("Camera 0/1/2" with no facing info — common on the
    // Android WebView), picking by index could select a FRONT camera, so we
    // trust the SDK's facingMode:"environment" default instead of guessing.
    const isBack = (c) => /back|rear|environment/i.test(c.label || "");
    const back = cameras.filter(isBack);
    if (!back.length) {
      console.log("[barKoder] no back-labelled cameras; keeping SDK environment default");
      logDebug("camera_default_kept", { total: cameras.length });
      return;
    }
    const best = pickPrimaryRearCamera(cameras);
    if (!best?.id) return;
    const active = bk.getActiveCamera ? bk.getActiveCamera() : null;
    if (active === best.id) return;
    bk.setCameraId(best.id);
    try { localStorage.setItem("barkoder_camera_id", best.id); } catch (_) {}
    console.log("[barKoder] auto-selected rear camera", best.label || best.id, "of", cameras.length);
    logDebug("camera_auto_selected", { label: best.label || best.id, total: cameras.length });
  } catch (e) { console.warn("[barKoder] autoSelectRearCamera failed:", e?.message || e); logDebug("camera_auto_select_failed", { reason: String(e?.message || e) }); }
}

/* ------------------------------------------------------------------ */
/* Result parsing                                                      */
/* ------------------------------------------------------------------ */
export function parseResult(rawResult) {
  const single = (rawResult?.results && rawResult.results.length > 0) ? rawResult.results[0] : rawResult;
  const barcodeType = single?.barcodeTypeName || rawResult?.barcodeTypeName || "Unknown";
  const textualData = single?.textualData ?? rawResult?.textualData ?? "";
  // The barKoder SDK exposes structured (SADL/AAMVA/GS1) data as a JSON STRING
  // in `formattedJSON` (see BKResult in barkoder-umd.d.ts). textualData is the
  // raw barcode payload and is NOT JSON for SADL — so we must read formattedJSON
  // first, not parse textualData.
  const formattedJSONStr = single?.formattedJSON ?? rawResult?.formattedJSON ?? null;
  const formattedText = single?.formattedText ?? rawResult?.formattedText ?? null;
  const timestamp = new Date().toISOString();

  let formattedJSON = null;
  let malformedJSON = false;
  if (typeof formattedJSONStr === "string" && formattedJSONStr.length > 0) {
    try {
      const obj = JSON.parse(formattedJSONStr);
      if (obj && typeof obj === "object") formattedJSON = obj;
    } catch (_) { /* formattedJSON not JSON; fall through to textualData */ }
  }
  if (!formattedJSON && textualData) {
    try {
      const obj = JSON.parse(textualData);
      if (obj && typeof obj === "object") formattedJSON = obj;
    } catch (_) { malformedJSON = !!textualData; }
  }

  return {
    barcodeType, textualData, formattedJSON, formattedText,
    binaryDataPresent: !!(single?.binaryData || rawResult?.binaryData),
    timestamp, parsed: !!formattedJSON, malformedJSON,
    rawResultKeys: rawResult ? Object.keys(rawResult) : [],
    formattedJSONSource: typeof formattedJSONStr === "string" ? "sdk" : (formattedJSON ? "textual" : "none"),
    // Original SDK formatted-JSON string (verbatim) — required by getSadlPhoto(),
    // which calls Barkoder.getSADLImage(jsonString) to extract the 200x250 photo.
    formattedJSONRaw: (typeof formattedJSONStr === "string" && formattedJSONStr.length > 0)
      ? formattedJSONStr
      : (formattedJSON ? JSON.stringify(formattedJSON) : null),
  };
}

/* ------------------------------------------------------------------ */
/* Field flattening + matching                                         */
/* ------------------------------------------------------------------ */
function flattenFields(formattedJSON) {
  if (!formattedJSON || typeof formattedJSON !== "object") return {};
  if (Array.isArray(formattedJSON.Fields)) {
    const out = {};
    formattedJSON.Fields.forEach((f) => {
      const k = f?.Field ?? f?.Name ?? f?.name;
      const v = f?.Value ?? f?.value;
      if (k) out[String(k)] = v;
    });
    return out;
  }
  return { ...formattedJSON };
}

function pickField(flat, ...needles) {
  const keys = Object.keys(flat);
  for (const n of needles) {
    const key = keys.find((k) => k.toLowerCase().includes(n));
    if (key !== undefined && flat[key] != null && flat[key] !== "") return String(flat[key]);
  }
  return "";
}

function looksLikeSADL(flat) {
  const keys = Object.keys(flat).map((k) => k.toLowerCase());
  return keys.some((k) => /surname|forename|id number|date of birth|driver licence|licence number/.test(k));
}

/* ------------------------------------------------------------------ */
/* Mappers — parsed JSON → entity fields                               */
/* ------------------------------------------------------------------ */
export function extractMappedFields(formattedJSON, profileId) {
  const profile = getProfile(profileId);
  if (!formattedJSON) return null;
  const flat = flattenFields(formattedJSON);

  if (profile.mapper === "sadl") {
    const surname = pickField(flat, "surname");
    const firstNames = pickField(flat, "forename", "first name", "first names", "given name", "names");
    const initials = pickField(flat, "initials");
    const idNumber = pickField(flat, "id number", "identity number", "id_number", "idnumber", "id no", "sa id");
    const name = [firstNames, surname].filter(Boolean).join(" ").trim() || surname || firstNames;
    return {
      visitor_name: name,
      visitor_id_number: idNumber,
      surname, first_names: firstNames, initials,
      driver_licence_number: pickField(flat, "licence number", "license number", "licence no", "license no", "dl no", "driver licence"),
      date_of_birth: pickField(flat, "date of birth", "birth", "dob"),
      gender: pickField(flat, "sex", "gender"),
      nationality: pickField(flat, "nationality"),
      country: pickField(flat, "country"),
      issue_date: pickField(flat, "issue date", "date of issue"),
      expiry_date: pickField(flat, "expiry date", "date of expiry", "expiry"),
      vehicle_classes: pickField(flat, "vehicle class", "vehicle classes", "class", "code", "categories"),
      restrictions: pickField(flat, "restriction"),
      prdp: pickField(flat, "prdp"),
      licence_status: pickField(flat, "licence status", "status"),
      _raw: flat,
    };
  }

  if (profile.mapper === "vehicle_disc") {
    return {
      registration_number: pickField(flat, "registration", "reg no", "number plate", "licence number"),
      vin: pickField(flat, "vin", "chassis"),
      engine_number: pickField(flat, "engine number", "engine no"),
      licence_number: pickField(flat, "licence number", "license number", "disc number"),
      make: pickField(flat, "make"),
      model: pickField(flat, "model"),
      colour: pickField(flat, "colour", "color"),
      expiry_date: pickField(flat, "expiry", "expiry date"),
      owner: pickField(flat, "owner", "title holder"),
      province: pickField(flat, "province"),
      _raw: flat,
    };
  }

  if (profile.mapper === "sa_id") {
    const surname = pickField(flat, "surname");
    const firstNames = pickField(flat, "names", "first names", "forename", "given name", "first name", "full names");
    let idNumber = pickField(flat, "id number", "identity number", "idnumber", "id no", "sa id");
    let dob = pickField(flat, "date of birth", "birth", "dob");
    let gender = pickField(flat, "sex", "gender");
    let nationality = pickField(flat, "nationality");
    // SA ID numbers encode DOB (YYMMDD), gender (seq >= 5000 = male) and
    // citizenship (digit 11: 0 = SA citizen, 1 = permanent resident).
    if (idNumber && /^\d{13}$/.test(idNumber)) {
      const yy = idNumber.slice(0, 2), mm = idNumber.slice(2, 4), dd = idNumber.slice(4, 6);
      const seq = parseInt(idNumber.slice(6, 10), 10);
      const citizen = idNumber.slice(10, 11);
      if (!dob) dob = `${parseInt(yy, 10) <= 30 ? "20" + yy : "19" + yy}-${mm}-${dd}`;
      if (!gender) gender = seq >= 5000 ? "Male" : "Female";
      if (!nationality) nationality = citizen === "0" ? "South African" : "";
    }
    const name = [firstNames, surname].filter(Boolean).join(" ").trim() || surname || firstNames;
    return {
      visitor_name: name,
      visitor_id_number: idNumber,
      surname,
      first_names: firstNames,
      date_of_birth: dob,
      gender,
      nationality,
      country: pickField(flat, "country", "country of birth", "country of issue"),
      initials: pickField(flat, "initials"),
      _raw: flat,
    };
  }

  if (profile.mapper === "mrz") {
    return { _mrz_raw: pickField(flat, "mrz") || JSON.stringify(formattedJSON), _raw: flat };
  }

  if (profile.mapper === "qr") {
    return { _qr_payload: typeof formattedJSON === "string" ? formattedJSON : (formattedJSON?.textualData || JSON.stringify(formattedJSON)), _raw: flat };
  }

  if (profile.mapper === "generic_barcode") {
    return { barcode_value: typeof formattedJSON === "string" ? formattedJSON : JSON.stringify(formattedJSON), _raw: flat };
  }

  return { _raw: flat };
}

/* ------------------------------------------------------------------ */
/* Automatic document detection                                        */
/* ------------------------------------------------------------------ */
const QR_SUBTYPES = ["resident_qr", "visitor_qr", "contractor_qr", "staff_qr", "courier_qr", "delivery_qr", "access_qr"];

export function resolveDocument(rawResult, caller, hintProfileId) {
  const parsed = parseResult(rawResult);
  console.log("[barKoder] resolveDocument", { barcodeType: parsed.barcodeType, hasJSON: !!parsed.formattedJSON, textLen: (parsed.textualData || "").length, hint: hintProfileId });
  const flat = parsed.formattedJSON ? flattenFields(parsed.formattedJSON) : {};
  const bt = (parsed.barcodeType || "").toLowerCase();
  const keys = Object.keys(flat).map((k) => k.toLowerCase());
  const has = (re) => keys.some((k) => re.test(k));

  // NB: "licence number" alone is NOT DL-specific — SA vehicle licence discs
  // also carry a "Licence Number" field. Require a DL-only field instead so a
  // disc isn't mis-routed to the driver's-licence parser in auto mode.
  const isLicence = has(/driver licence|driver license|vehicle class|prdp|restriction|licence status/);
  const isVehicle = has(/registration|reg no|\bvin\b|chassis|engine number|engine no|\bmake\b|\bmodel\b|disc number|licence disc/);
  const isSAID = has(/id number|identity number|idnumber|id no/) && has(/surname|names|forename|first name/);

  let profileId;
  let parserUsed = null;

  if (hintProfileId && hintProfileId !== "auto" && getProfile(hintProfileId).status === "active") {
    profileId = hintProfileId;
  } else if (parsed.formattedJSON && isLicence) {
    profileId = "drivers_licence"; parserUsed = "SADL";
  } else if (parsed.formattedJSON && isVehicle) {
    profileId = "vehicle_disc"; parserUsed = "PDF417";
  } else if (parsed.formattedJSON && isSAID) {
    profileId = "sa_id"; parserUsed = "SAID";
  } else if (bt === "pdf417" || bt === "pdf417micro") {
    profileId = "vehicle_disc"; parserUsed = "PDF417";
  } else if (bt === "qr" || bt === "qrmicro") {
    profileId = "qr"; parserUsed = "QR";
  } else if (["datamatrix", "aztec", "azteccompact", "code128", "code39", "code93", "codabar", "ean13", "ean8", "upca", "upce"].includes(bt)) {
    profileId = "generic_barcode"; parserUsed = "BARCODE";
  } else {
    profileId = "generic_barcode"; parserUsed = "BARCODE";
  }

  if (!parserUsed) {
    if (profileId === "drivers_licence") parserUsed = "SADL";
    else if (profileId === "vehicle_disc") parserUsed = "PDF417";
    else if (profileId === "sa_id") parserUsed = "SAID";
    else if (profileId === "qr") parserUsed = "QR";
    else parserUsed = "BARCODE";
  }

  const profile = getProfile(profileId);
  let mappedFields = parsed.formattedJSON ? extractMappedFields(parsed.formattedJSON, profileId) : null;

  // QR / generic barcode: the raw textual payload IS the result — never flag it as malformed.
  if (profileId === "qr" || profileId === "generic_barcode") {
    if (parsed.textualData) { parsed.parsed = true; parsed.malformedJSON = false; }
  }
  // SA ID backstop (older SDKs without the SA-ID parser): pull the 13-digit ID
  // number out of the raw PDF417 text and derive DOB/gender/citizenship from it.
  if (profileId === "sa_id" && !mappedFields && parsed.textualData) {
    const id = (parsed.textualData.match(/\b\d{13}\b/) || [])[0];
    if (id) {
      const yy = id.slice(0, 2), mm = id.slice(2, 4), dd = id.slice(4, 6);
      const seq = parseInt(id.slice(6, 10), 10);
      const citizen = id.slice(10, 11);
      mappedFields = {
        visitor_name: "", surname: "", first_names: "", initials: "",
        visitor_id_number: id,
        date_of_birth: `${parseInt(yy, 10) <= 30 ? "20" + yy : "19" + yy}-${mm}-${dd}`,
        gender: seq >= 5000 ? "Male" : "Female",
        nationality: citizen === "0" ? "South African" : "",
        _raw: {},
      };
      parsed.parsed = true; parsed.malformedJSON = false;
    }
  }
  // Vehicle disc backstop: decoded but unstructured on older SDKs — still counts
  // as parsed (raw preserved). SDK 1.7.0+ returns structured formattedJSON (MVL).
  if (profileId === "vehicle_disc" && !parsed.formattedJSON && parsed.textualData) {
    parsed.parsed = true; parsed.malformedJSON = false;
  }

  let qrInfo = null;
  if (profileId === "qr" && parsed.textualData) {
    qrInfo = processQR(parsed.textualData, caller);
  }

  return { parsed, profileId, profile, mappedFields, parserUsed, qrInfo };
}

/* ------------------------------------------------------------------ */
/* SADL photograph extraction                                          */
/* ------------------------------------------------------------------ */
/**
 * Extracts the SADL driver's-licence photograph.
 *
 * Barkoder.getSADLImage(jsonString) parses the *formatted* JSON (not the raw
 * PDF417 text), reads Fields[15]=Image Width, Fields[16]=Image Height,
 * Fields[17]=ImageRawBase64, decodes the base64 grayscale bytes and returns an
 * ImageData (200x250 RGBA). We render it to a canvas → PNG data URL.
 *
 * @param {string} formattedJsonString  the SDK's formattedJSON string (SADL)
 */
export async function getSadlPhoto(formattedJsonString) {
  if (!formattedJsonString) return null;
  const bk = await initializeBarkoder();
  try {
    const imageData = await bk.getSADLImage(formattedJsonString);
    if (!imageData) { console.warn("[barKoder] getSADLImage returned no ImageData"); return null; }
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const url = canvas.toDataURL("image/png");
    console.log("[barKoder] SADL photo extracted", { w: imageData.width, h: imageData.height, urlLen: url.length });
    return url;
  } catch (e) { console.warn("[barKoder] getSADLImage failed:", e?.message || e); return null; }
}

/* ------------------------------------------------------------------ */
/* Cleanup                                                             */
/* ------------------------------------------------------------------ */
// Full teardown — only for app shutdown / logout. Normal scanner close should
// call stopScanner() only (keeps the WASM engine compiled for fast re-open).
export function resetInstance() {
  stopScanner();
  barkoderInstance = null;
  initPromise = null;
  currentProfileId = null;
}

export { logDebug };