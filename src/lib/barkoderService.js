/**
 * barKoder Web/WASM Scanner — Service Module (Phase 2: generic document scanner)
 *
 * Single reusable service responsible for:
 *  - reading the licence key from the environment (never logged or exposed);
 *  - lazy-loading + initializing the SDK (one instance per session);
 *  - configuring decoders + formatting per SCAN PROFILE (driver's licence, QR, …);
 *  - starting/stopping scanning;
 *  - parsing results;
 *  - extracting the SADL driver photograph via the official helper;
 *  - mapping parsed licence fields into app entity fields (Visitor, …);
 *  - cleaning up the camera + DOM resources.
 *
 * Adding a new document type = add an entry to SCAN_PROFILES (+ a mapper if needed).
 * No component changes are required to support a new barcode-based document.
 *
 * Privacy: this module never persists personal data. The licence key is never
 * printed to the console, surfaced in errors, or shown in the UI.
 */

const DEBUG_LOG = [];
let barkoderInstance = null;
let barkoderSDKStatic = null;
let initPromise = null;
let currentProfileId = null;

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
/* Scan profiles — the single place new document types are declared    */
/* ------------------------------------------------------------------ */

export const SCAN_PROFILES = {
  drivers_licence: {
    id: "drivers_licence",
    label: "Driver's Licence",
    decoders: ["PDF417"],
    formatting: "SADL",
    supportsPhoto: true,
    mapper: "sadl",
    status: "active",
    instruction: "Align the PDF417 barcode on the back of the licence inside the frame",
  },
  sa_id: {
    id: "sa_id",
    label: "SA Smart ID Card",
    decoders: ["PDF417"],
    formatting: "SADL",
    supportsPhoto: true,
    mapper: "sadl",
    status: "planned",
    instruction: "Align the barcode on the smart ID card inside the frame",
  },
  vehicle_disc: {
    id: "vehicle_disc",
    label: "Vehicle Licence Disc",
    decoders: ["PDF417"],
    formatting: null,
    supportsPhoto: false,
    mapper: "vehicle_disc",
    status: "planned",
    instruction: "Align the barcode on the vehicle licence disc inside the frame",
  },
  qr: {
    id: "qr",
    label: "QR Code",
    decoders: ["QR"],
    formatting: null,
    supportsPhoto: false,
    mapper: "qr",
    status: "active",
    instruction: "Align the QR code inside the frame",
  },
};

export function getProfile(profileId) {
  return SCAN_PROFILES[profileId] || SCAN_PROFILES.drivers_licence;
}

/* ------------------------------------------------------------------ */
/* Licence handling                                                    */
/* ------------------------------------------------------------------ */

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

    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw { type: "insecure_context", message: "A secure HTTPS context is required for camera access and WASM streaming." };
    }

    let SDK;
    try {
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

    // Sensible defaults; per-profile decoder/formatting applied in configureForProfile()
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

  if (profile.status !== "active") {
    return { profile, supported: false };
  }

  const D = bk.constants.Decoders;
  const decoderArgs = (profile.decoders || [])
    .map((name) => D[name])
    .filter((v) => v !== undefined && v !== null);

  try {
    if (decoderArgs.length) bk.setEnabledDecoders(...decoderArgs);
  } catch (_) { /* some SDK versions take an array */ }

  try {
    if (profile.formatting === "SADL") {
      bk.setFormatting(bk.constants.Formatting.SADL);
    }
  } catch (_) {
    logDebug("formatting_unavailable", { formatting: profile.formatting });
  }

  // Optional beta option for SA ID decode
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

export function getCurrentProfileId() {
  return currentProfileId;
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

export function parseResult(rawResult) {
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
        formattedJSON = obj;
        formattedText = textualData;
      }
    } catch (_) {
      formattedJSON = null;
      malformedJSON = !!textualData;
    }
  }

  return {
    barcodeType,
    textualData,
    formattedJSON,
    formattedText,
    binaryDataPresent: !!(single?.binaryData || rawResult?.binaryData),
    timestamp,
    parsed: !!formattedJSON,
    malformedJSON,
    rawResultKeys: rawResult ? Object.keys(rawResult) : []
  };
}

/* ------------------------------------------------------------------ */
/* Field mapping — parsed JSON → app entity fields                     */
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

/**
 * Maps parsed barKoder JSON into a normalized object ready to merge into an
 * entity record. Returns null when there is nothing to map.
 *
 * For the driver's licence profile, returns:
 *   { visitor_name, visitor_id_number, _dob, _sex, _licence_number, _vehicle_class, _raw }
 */
export function extractMappedFields(formattedJSON, profileId) {
  const profile = getProfile(profileId);
  if (!formattedJSON) return null;

  const flat = flattenFields(formattedJSON);

  if (profile.mapper === "sadl") {
    const surname = pickField(flat, "surname");
    const forenames = pickField(flat, "forename", "first name", "initials", "given name", "names");
    const idNumber = pickField(flat, "id number", "identity number", "id_number", "idnumber", "id no");
    const dob = pickField(flat, "date of birth", "birth", "dob");
    const sex = pickField(flat, "sex", "gender");
    const licenceNumber = pickField(flat, "licence number", "license number", "licence no", "license no", "dl no");
    const vehicleClass = pickField(flat, "class", "code", "vehicle category");

    const name = [forenames, surname].filter(Boolean).join(" ").trim() || surname || forenames || "";

    return {
      visitor_name: name,
      visitor_id_number: idNumber,
      _dob: dob,
      _sex: sex,
      _licence_number: licenceNumber,
      _vehicle_class: vehicleClass,
      _raw: flat,
    };
  }

  if (profile.mapper === "vehicle_disc") {
    return {
      vehicle_registration: pickField(flat, "registration", "reg no", "number plate"),
      _raw: flat,
    };
  }

  if (profile.mapper === "qr") {
    const payload = typeof formattedJSON === "string"
      ? formattedJSON
      : (formattedJSON?.textualData || JSON.stringify(formattedJSON));
    return { _qr_payload: payload, _raw: flat };
  }

  return { _raw: flat };
}

/* ------------------------------------------------------------------ */
/* SADL photograph extraction                                          */
/* ------------------------------------------------------------------ */

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
  currentProfileId = null;
}

export { logDebug };