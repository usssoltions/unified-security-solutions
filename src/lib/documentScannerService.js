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

function simdSupported() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,11,0
    ]));
  } catch (_) { return false; }
}
function wasmAssetUrl(file) {
  const base = new URL("./", window.location.href).href.replace(/\/$/, "");
  return base + "/" + file;
}
// Some static hosts serve .wasm with the wrong MIME (application/octet-stream),
// which makes WebAssembly.compileStreaming throw "Incorrect response MIME
// type". Patch it once to fall back to ArrayBuffer compilation on that error,
// so the SDK initializes regardless of how the host serves the file.
function patchCompileStreamingOnce() {
  if (window.__barkoderWasmMimePatched) return;
  const orig = WebAssembly.compileStreaming.bind(WebAssembly);
  WebAssembly.compileStreaming = async (response) => {
    try { return await orig(response); }
    catch (_) {
      const r = await response;
      const buf = await r.arrayBuffer();
      return WebAssembly.compile(buf);
    }
  };
  window.__barkoderWasmMimePatched = true;
}

export const SDK_VERSION = "barkoder-wasm@1.7.0";

const DEBUG_LOG = [];
let barkoderInstance = null;
let barkoderSDKStatic = null;
let initPromise = null;
let currentProfileId = null;

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
    formatting: "Automatic", supportsPhoto: false, mapper: "auto",
    status: "active", instruction: "Align the document / barcode inside the frame",
  },
  drivers_licence: {
    id: "drivers_licence", label: "Driver's Licence",
    decoders: ["PDF417"], formatting: "SADL", supportsPhoto: true, mapper: "sadl",
    status: "active", instruction: "Align the PDF417 barcode on the back of the licence inside the frame",
  },
  vehicle_disc: {
    id: "vehicle_disc", label: "Vehicle Licence Disc",
    decoders: ["PDF417"], formatting: "Automatic", supportsPhoto: false, mapper: "vehicle_disc",
    status: "active", instruction: "Align the barcode on the vehicle licence disc inside the frame",
  },
  sa_id: {
    id: "sa_id", label: "SA ID Card / Book",
    decoders: ["PDF417", "Code39"], formatting: "Automatic", supportsPhoto: false, mapper: "sa_id",
    status: "active", instruction: "Align the PDF417 barcode on the SA ID card inside the frame",
  },
  passport_mr: {
    id: "passport_mr", label: "Passport (MRZ)",
    decoders: ["PDF417"], formatting: null, supportsPhoto: false, mapper: "mrz",
    status: "planned", instruction: "Align the MRZ at the bottom of the passport inside the frame",
  },
  qr: {
    id: "qr", label: "QR Code",
    decoders: ["QR"], formatting: null, supportsPhoto: false, mapper: "qr",
    status: "active", instruction: "Align the QR code inside the frame",
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
  if (msg.includes("license") || msg.includes("licence") || msg.includes("key"))
    return { type: "license_error", message: raw || "barKoder licence is invalid, expired, or not authorised for this domain." };
  if (msg.includes("wasm") || msg.includes("webassembly"))
    return { type: "wasm_error", message: raw || "Failed to load the barKoder WebAssembly engine." };
  return { type: "init_error", message: raw || "barKoder scanner failed to initialize." };
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
    try {
      const mod = await import("barkoder-wasm");
      // The barKoder UMD assigns module.exports the SDK object (or a Promise
      // that resolves to it). Handle default, namespace, and thenable shapes.
      let candidate = (mod && mod.default) ? mod.default : mod;
      if (candidate && typeof candidate.then === "function") {
        try { candidate = await candidate; } catch (_) { /* fall through to not-initialized */ }
      }
      if (!candidate || typeof candidate.initialize !== "function") {
        throw new Error("barKoder module loaded but exposed no `initialize` (got " + (candidate === undefined ? "undefined" : typeof candidate) + ").");
      }
      SDK = candidate; barkoderSDKStatic = SDK; console.log("[barKoder] wasm_loaded");
    } catch (e) {
      const reason = String(e?.message || e).slice(0, 240);
      logDebug("wasm_load_error", { reason });
      console.error("[barKoder] wasm_load_error", e);
      throw { type: "wasm_error", message: "Failed to load the barKoder WebAssembly engine: " + reason };
    }

    let Barkoder;
    try { const wasmFile = simdSupported() ? "barkoder.wasm" : "barkoder_nosimd.wasm";
    const wasmPath = wasmAssetUrl(wasmFile);
    patchCompileStreamingOnce();
    console.log("[barKoder] initialize wasmPath=", wasmPath, "simd=", simdSupported());
    Barkoder = await SDK.initialize(key, { wasmPath });
    console.log("[barKoder] sdk_initialized (license OK, wasm:" + (simdSupported() ? "simd" : "nosimd") + ")"); }
    catch (e) { logDebug("init_error", { reason: classifyInitError(e).type, msg: String(e?.message||e).slice(0,240) }); console.error("[barKoder] init_error", e); throw classifyInitError(e); }

    Barkoder.setCameraResolution(Barkoder.constants.CameraResolution.FHD);
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
    if (profile.mapper === "sadl") {
      const setter = bk.setCustomOption || barkoderSDKStatic?.setCustomOption;
      if (typeof setter === "function") setter.call(bk, "SADL_decode_ID", 1);
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
 * Enumerates video devices directly via navigator.mediaDevices.enumerateDevices,
 * bypassing the SDK's getCameras(). The SDK's getCameras() calls
 * navigator.permissions.query({name:"camera"}), which hangs indefinitely on some
 * Android WebView versions — and since startCamera builds its getUserMedia
 * constraint from the camera id directly (deviceId:{exact:...}), we don't need
 * the SDK's internal camera list. Returns [] on any failure/timeout (never throws).
 */
export async function enumerateCamerasSafe(timeoutMs = 5000) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") return [];
  let timer;
  const timed = new Promise((resolve) => { timer = setTimeout(() => resolve([]), timeoutMs); });
  try {
    const devices = await Promise.race([navigator.mediaDevices.enumerateDevices(), timed]);
    clearTimeout(timer);
    const list = (devices || []).filter((d) => d.kind === "videoinput")
      .map((d) => ({ id: d.deviceId, deviceId: d.deviceId, label: d.label || "", facingMode: "" }));
    return list;
  } catch (_) { clearTimeout(timer); return []; }
}

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
export function startScanner(callback) {
  if (!barkoderInstance) throw { type: "not_initialized", message: "Scanner is not initialized." };
  console.log("[barKoder] startScanner (continuous)");
  barkoderInstance.startScanner(callback);
}
export function stopScanner() { if (barkoderInstance) { try { barkoderInstance.stopScanner(); console.log("[barKoder] stopScanner"); } catch (_) {} } }
export function toggleFlash() { if (barkoderInstance) { try { barkoderInstance.changeFlashState(); } catch (_) {} } }

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
    } catch (_) { malformedJSON = true; /* SDK's own formattedJSON was unparseable */ }
  }
  if (!formattedJSON && textualData) {
    try {
      const obj = JSON.parse(textualData);
      if (obj && typeof obj === "object") formattedJSON = obj;
    } catch (_) { /* textualData isn't JSON — normal for PDF417/Code39/plain-text QR */ }
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

function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function pickField(flat, ...needles) {
  const keys = Object.keys(flat);
  for (const n of needles) {
    const nn = norm(n);
    if (!nn) continue;
    const key = keys.find((k) => norm(k).includes(nn));
    if (key !== undefined && flat[key] != null && flat[key] !== "") return String(flat[key]);
  }
  return "";
}

function looksLikeSADL(flat) {
  const keys = Object.keys(flat).map((k) => norm(k));
  return keys.some((k) => /surname|forename|firstname|lastname|idnumber|dateofbirth|dob|driverlicence|driverlicense|licensenumber|licencenumber|vehiclecode|vehicleclass|prdp/.test(k));
}

/* ------------------------------------------------------------------ */
/* Mappers — parsed JSON → entity fields                               */
/* ------------------------------------------------------------------ */
export function extractMappedFields(formattedJSON, profileId) {
  const profile = getProfile(profileId);
  if (!formattedJSON) return null;
  const flat = flattenFields(formattedJSON);

  if (profile.mapper === "sadl") {
    const surname = pickField(flat, "surname", "last name", "last names", "family name");
    const firstNames = pickField(flat, "forename", "first name", "first names", "given name", "names");
    const initials = pickField(flat, "initials");
    const idNumber = pickField(flat, "id number", "identity number", "idnumber", "id no", "sa id");
    const name = [firstNames, surname].filter(Boolean).join(" ").trim() || surname || firstNames;
    return {
      visitor_name: name,
      visitor_id_number: idNumber,
      surname, first_names: firstNames, initials,
      driver_licence_number: pickField(flat, "license number", "licence number", "license no", "licence no", "dl no", "driver licence", "driver license"),
      date_of_birth: pickField(flat, "date of birth", "birth", "dob"),
      gender: pickField(flat, "sex", "gender"),
      nationality: pickField(flat, "nationality"),
      country: pickField(flat, "country"),
      issue_date: pickField(flat, "issue date", "date of issue"),
      expiry_date: pickField(flat, "expiry date", "date of expiry", "expiry"),
      vehicle_classes: pickField(flat, "vehicle code", "vehicle codes", "vehicle class", "vehicle classes", "class", "code", "categories"),
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
    const surname = pickField(flat, "surname", "last name", "last names", "family name");
    const firstNames = pickField(flat, "names", "first names", "forename", "given name", "first name", "full names");
    const idNumber = pickField(flat, "id number", "identity number", "idnumber", "id no", "sa id");
    const name = [firstNames, surname].filter(Boolean).join(" ").trim() || surname || firstNames;
    return {
      visitor_name: name,
      visitor_id_number: idNumber,
      surname,
      first_names: firstNames,
      date_of_birth: pickField(flat, "date of birth", "birth", "dob"),
      gender: pickField(flat, "sex", "gender"),
      nationality: pickField(flat, "nationality"),
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
  const keys = Object.keys(flat).map((k) => norm(k));
  const has = (re) => keys.some((k) => re.test(k));

  const isLicence = has(/driverlicence|driverlicense|licencenumber|licensenumber|vehiclecode|vehicleclass|prdp|restriction/);
  const isVehicle = has(/registration|regno|vin|chassis|enginenumber|engineno|discnumber|licencedisc/) || (has(/make/) && has(/model/));
  const isSAID = has(/idnumber|identitynumber|idno/) && has(/surname|firstname|lastname|forename|names/);

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
  const mappedFields = parsed.formattedJSON ? extractMappedFields(parsed.formattedJSON, profileId) : null;

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
export function resetInstance() {
  stopScanner();
  barkoderInstance = null;
  initPromise = null;
  currentProfileId = null;
}

export { logDebug };