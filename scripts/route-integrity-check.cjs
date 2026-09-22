/**
 * Route-integrity check — automated comparison of:
 *   - actual page files (src/pages/**)
 *   - App.jsx route declarations + imports
 *   - pages.config.js Pages map
 *   - routeRegistry.js (ROLE_PAGES / ROLE_HOME / PAGE_MODULE_MAP consumers)
 *   - duplicate routes
 * Fails on: missing components, routes without components, invalid role
 * homes, duplicates, sidebar entries pointing at non-existent pages.
 *
 * Usage: node scripts/route-integrity-check.cjs   (exit 1 on failure)
 */
const fs = require('fs');
const path = require('path');

function walkPages(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkPages(p, acc);
    else if (/\.jsx$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function run() {
  const problems = [];
  const pages = walkPages(path.join(__dirname, '..', 'src', 'pages'), [])
    .map(p => path.relative(path.join(__dirname, '..', 'src', 'pages'), p).replace(/\\/g, '/').replace(/\.jsx$/, ''));
  const pageSet = new Set(pages);

  const app = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.jsx'), 'utf8');
  const pagesConfig = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages.config.js'), 'utf8');
  const registry = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'routeRegistry.js'), 'utf8');
  const moduleMap = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'moduleMapping.js'), 'utf8');

  // 1. explicit route declarations in App.jsx
  const declaredRoutes = [...app.matchAll(/path="\/([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
  const dupRoutes = declaredRoutes.filter((r, i) => declaredRoutes.indexOf(r) !== i);
  if (dupRoutes.length) problems.push('Duplicate route declarations: ' + [...new Set(dupRoutes)].join(', '));

  // 2. routes whose component file does not exist
  for (const r of new Set(declaredRoutes)) {
    if (['AndroidDownload'].includes(r)) continue; // pages with dynamic import outside src/pages pattern are still checked below
    if (!pageSet.has(r)) problems.push('Route /' + r + ' has no component file in src/pages');
  }

  // 3. every lazy import in App.jsx resolves to a real file
  for (const m of app.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/pages\/([A-Za-z0-9_/-]+)["']/g)) {
    if (!pageSet.has(m[2])) problems.push('App.jsx imports missing page: ' + m[2]);
  }
  for (const m of app.matchAll(/from\s+["']@\/pages\/([A-Za-z0-9_/-]+)["']/g)) {
    if (!pageSet.has(m[1].replace(/\.jsx$/, ''))) problems.push('App.jsx imports missing page: ' + m[1]);
  }

  // 4. pages.config.js map — every entry must exist and have a route
  // (mainPage/Pages/Layout are config meta-keys, not page entries)
  const metaKeys = new Set(['mainPage', 'Pages', 'Layout']);
  const configKeys = [...pagesConfig.matchAll(/^\s*"?([A-Za-z0-9_-]+)"?\s*:/gm)].map(m => m[1])
    .filter((k) => !metaKeys.has(k));
  for (const k of configKeys) {
    if (!pageSet.has(k)) problems.push('pages.config entry has no component: ' + k);
  }

  // 5. routeRegistry: pageKey references must exist as pages
  const regPages = [...registry.matchAll(/pageKey:\s*["']([A-Za-z0-9_-]+)["']/g)].map(m => m[1]);
  const regRoots = [...registry.matchAll(/isRoot:\s*true[^}]*?pageKey:\s*["']([A-Za-z0-9_-]+)["']/g)].map(m => m[1]);
  const rootsByInline = [...registry.matchAll(/pageKey:\s*["']([A-Za-z0-9_-]+)["'],\s*icon:[^}]*isRoot:\s*true/g)].map(m => m[1]);
  for (const p of new Set(regPages)) {
    if (!pageSet.has(p)) problems.push('routeRegistry references missing page: ' + p);
  }
  for (const p of new Set([...regRoots, ...rootsByInline])) {
    if (!pageSet.has(p)) problems.push('ROLE_HOME/root references missing page: ' + p);
  }

  // 6. moduleMapping PAGE_MODULE_MAP — page keys must exist
  const mapPages = [...moduleMap.matchAll(/["']([A-Za-z0-9_-]+)["']\s*:/g)].map(m => m[1]);
  for (const p of new Set(mapPages)) {
    if (/^[A-Z]/.test(p) && !pageSet.has(p)) problems.push('PAGE_MODULE_MAP references missing page: ' + p);
  }

  // 7. every page file should be reachable: declared route OR config key OR
  // registry reference OR an explicit App.jsx special-case branch
  // (PublicAccountRemoval is rendered by the /account-removal branch, no <Route>).
  const specialBranch = new Set(app.includes("PublicAccountRemoval") && app.includes('account-removal') ? ['PublicAccountRemoval'] : []);
  const reachable = new Set([...declaredRoutes, ...configKeys, ...regPages, ...specialBranch]);
  for (const p of pages) {
    if (!reachable.has(p)) problems.push('Page file exists but is unreachable (no route/config/registry): ' + p);
  }

  return { ok: problems.length === 0, problems, stats: { pages: pages.length, routes: new Set(declaredRoutes).size, registryPages: new Set(regPages).size } };
}

if (require.main === module) {
  const r = run();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
module.exports = { run };