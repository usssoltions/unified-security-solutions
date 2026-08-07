import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true'
    }),
    react(),
  ],
  optimizeDeps: {
    // barkoder-wasm ships a UMD bundle; pre-bundle it so the dynamic import()
    // in documentScannerService resolves a stable ESM chunk instead of failing
    // to load the CJS module at runtime.
    include: ["barkoder-wasm"]
  }
});