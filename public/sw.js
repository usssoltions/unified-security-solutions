/* Shared platform service worker — deliberately NETWORK-THROUGH.
 *
 * Customer-specific PWA identity is handled entirely by the manifest link in
 * index.html (swapped early in <head> to the public getPwaManifest endpoint
 * from the ?brand=<pwa_slug> query parameter) — never by this service worker.
 *
 * This SW deliberately does NOT cache the app shell, the manifest or the
 * dynamic manifest endpoint: a caching SW could serve a stale generic shell
 * (with a stale /manifest.json link) and make Chrome install the wrong
 * branding. Offline data resilience is handled by the app's offlineDB layer,
 * not by shell caching. All registrations (all customers) share this one SW.
 *
 * It also replaces any stale caching SW from earlier deployments: on the
 * next update check Chrome swaps it in (SKIP_WAITING supported), the
 * controllerchange handler in ServiceWorkerRegistration reloads to the
 * fresh shell, and cached stale shells stop being served.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-through: no fetch handling — every request goes to the network.
self.addEventListener('fetch', () => {});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});
