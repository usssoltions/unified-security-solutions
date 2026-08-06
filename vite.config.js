import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// barKoder 1.7.0's getCompiledWasm() (a) selects the SIMD build via a runtime
// probe — which fails to instantiate on several Android WebView versions — and
// (b) compiles via WebAssembly.compileStreaming(), which REQUIRES the
// "application/wasm" MIME type. The Base44 CDN serves .wasm as
// "application/octet-stream", so compileStreaming throws with no fallback and
// EVERY scanner (QR / driver's licence / vehicle disc / SA ID) fails to init.
// This plugin patches the bundled SDK at build time (survives fresh npm
// installs): force the universally-compatible no-SIMD build, and fall back to
// ArrayBuffer + WebAssembly.compile when streaming compilation fails on MIME.
function patchBarkoderWasm() {
  return {
    name: 'patch-barkoder-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('barkoder-wasm')) return null;
      let patched = code;
      // 1) Force the no-SIMD build regardless of the runtime SIMD probe.
      const simdPick = '(has_SIMD)?Module.locateFile("barkoder.wasm"):Module.locateFile("barkoder_nosimd.wasm")';
      if (patched.includes(simdPick)) {
        patched = patched.replace(simdPick, 'Module.locateFile("barkoder_nosimd.wasm")');
      }
      // 2) Tolerate non-application/wasm MIME (e.g. octet-stream) via ArrayBuffer fallback.
      const stream = 'const globalCompiledModule=await WebAssembly.compileStreaming(wasmResponse);return globalCompiledModule;';
      if (patched.includes(stream)) {
        patched = patched.replace(stream, 'let globalCompiledModule;try{globalCompiledModule=await WebAssembly.compileStreaming(wasmResponse);}catch(_mimeErr){const _resp=await fetch(wasmUrl);globalCompiledModule=await WebAssembly.compile(await _resp.arrayBuffer());}return globalCompiledModule;');
      }
      // 3) Camera enumeration is left UNPATCHED — this is the documented barKoder
      // flow. populateCameraPicker() calls Barkoder.getCameras() (enumerateDevices)
      // and then startCamera() opens the rear camera via getUserMedia
      // ({ facingMode: "environment" }). Stubbing getCameras() out (seeding an
      // empty camera list) deviated from the SDK's documented flow and caused the
      // camera to stall on devices where the open depends on enumeration
      // completing. Per the barKoder README, leave it as-is.
      return patched === code ? null : { code: patched, map: null };
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    patchBarkoderWasm(),
    react(),
  ],
  optimizeDeps: {
    // Route barkoder-wasm through the plugin pipeline (instead of esbuild
    // pre-bundling, which bypasses user plugins) so the MIME/SIMD patch above
    // also applies during local development / the app preview.
    exclude: ['barkoder-wasm']
  }
});