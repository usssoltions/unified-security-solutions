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
      // 3) Re-bind the preview container on every scan. barKoder captures
      // DOM_elements.container = document.getElementById('barkoder-container')
      // ONCE, as a static class field at module-load time, and addPreview() then
      // appends the camera preview to that cached element. When the scanner
      // component unmounts and remounts (or a different scan type opens), the new
      // <div id="barkoder-container"> is a different element, but the SDK keeps
      // pointing at the old, now-detached div — a detached div still passes the
      // `tagName==='DIV'` check, so addPreview() happily attaches the live feed to
      // a div that is no longer on screen. The feed never appears and the scanner
      // hangs on "Starting camera…". Re-query the current container at the top of
      // addPreview() (which runs on every startScanner) and require it to still be
      // in the document; fall back to document.body only when it is genuinely gone.
      const addPreviewHead = "static addPreview(){var container_exists=(this.container!=undefined&&this.container!=null&&typeof this.container==='object'&&this.container.tagName==='DIV');if(!container_exists)this.container=document.body;this.container.appendChild(this.cameraPreview);";
      const addPreviewFix = "static addPreview(){this.container=document.getElementById('barkoder-container')||this.container;var container_exists=(this.container!=undefined&&this.container!=null&&typeof this.container==='object'&&this.container.tagName==='DIV'&&document.body.contains(this.container));if(!container_exists)this.container=document.body;this.container.appendChild(this.cameraPreview);";
      if (patched.includes(addPreviewHead)) {
        patched = patched.replace(addPreviewHead, addPreviewFix);
      }
      // 4) Camera enumeration is left UNPATCHED — this is the documented barKoder
      // flow. populateCameraPicker() calls Barkoder.getCameras() (enumerateDevices)
      // and then startCamera() opens the rear camera via getUserMedia
      // ({ facingMode: "environment" }). Per the barKoder README, leave it as-is.
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