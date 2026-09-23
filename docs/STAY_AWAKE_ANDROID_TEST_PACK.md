# Stay Awake — Physical Device Test Pack (Corrected)

**Status:** Prerequisites prepared. **No push has been sent. Physical testing has not started.**

Safeguards preserved throughout: `DELIVERY_MODE=test` unchanged; Danique's Stay Awake disabled; no tenant guessed for Danique or Yzerfontein Security Post; no Firebase, OneSignal or TURN placeholders inserted; no calling/TURN work started; no real customer or administrator notified.

---

## 1. Danique Oelofse — classification: ownership/scope requires manual administrator confirmation

NOT conclusively a production guard. The account has historical operational records, but:

- Email `ussnew02@gmail.com`, full name value `ussnew02`, badge `USSNEW02` — test-like
- Mobile number belongs to the platform owner
- Site (Yzerfontein Security Post) is an unscoped legacy site

Actions taken: account and roster left unchanged; Stay Awake left disabled; no customer/site assigned; excluded from the physical regression. **A platform administrator must confirm ownership/scope manually** (both the guard and the unscoped Yzerfontein site).

---

## 2. Physical-test fixture (prepared, verified)

| Item | Value |
|---|---|
| Test guard (Device A) | `usstest1@unifiedsecuritysolutions.co.za` — id `6ab23d02b459271f41bf1e13`, display name "USS Test 1", role `guard` |
| Authoritative customer | `USS Access Control Test` — id `6aaa5f585d81b1548379a19f` (dedicated test tenant; **no connection to any real customer roster**) |
| Authoritative active site | `USS Access Control Test Site` — id `6aaa60db00be50897cfd78f0` (active, stamped on the guard record and the fixture shift) |
| Active clocked-in test shift | Id `6ab35943863333a6812c93a4` — created `is_test=true`, status `active`, clocked in 30 min ago (recreate with the same fields if the lifecycle self-test runs again — its cleanup removes all `is_test` shifts) |
| Stay Awake configuration | Interval set to **5 minutes**; **`stay_awake_enabled=false`** — armed by the administrator in ONE step at test start (avoids prompt/escalation noise before the test) |
| Device B administrator | `accesstestadmin@unifiedsecuritysolutions.co.za` — id `6aaa62d3a597a2be10b71120`, `customer_admin`, admin_level `customer`, same test tenant (platform admin may substitute) |

⚠️ The lifecycle self-test's cleanup removes ALL `is_test` shifts/prompts. If `stayAwakeSelfTest` runs again before the device test, recreate the fixture shift (Shift: same fields, clock_in recent, `is_test=true`) before starting.

**Danique/Yzerfontein records are NOT used for the physical regression.**

---

## 3. Push routing — authoritative challenge identity (implemented)

Base44's native push API (`SendPushNotification`: user_id/title/content/action_label/action_url) **cannot carry custom payload data**, so the push carries only title/body plus a **secure deep link with the opaque server-generated challenge id** (`/GuardShift?challenge=<uuid>`). The event type is implicit in the route + param; the push contains **no guard, customer, site, shift or deadline data**.

Open flow (implemented):
1. The app submits ONLY the challenge id to the authorized gateway (`stayAwakeService` action `resolve_challenge`).
2. The server reloads the challenge from the authoritative record.
3. The server validates authenticated guard ownership, status and deadline (`classifyChallenge` shared core).
4. The app renders only the returned authoritative projection (id, challenge_id, alert_time, expires_at, site_name).
5. Missing, expired, cancelled, acknowledged and foreign challenges show a safe final state overlay (`StayAwakeChallengeState`); a foreign challenge is indistinguishable from a fabricated one — **another guard's prompt can never be opened**.

The app never "fetches the latest current prompt" for a deep link — routing is by challenge id.

**Server-side tests (self-test scenarios S21–S27 + S25b, all passing):** two historical + one active prompt each resolve to their OWN state (routing by id); an old notification tapped after a newer challenge resolves to its own final state; expired → safe `expired`; cancelled → safe `cancelled`; Guard A tapping Guard B's id → `not_found`; fabricated id → `not_found`; live gateway foreign resolve → `not_found` with no projection leak; deep link format carries only the challenge id.

---

## 4. Dedicated Stay Awake Android channel (implemented + documented limitation)

- Channel ID: **`stay_awake_alerts`** — stable, created once per install (idempotent; never recreated/renamed at launch; importance is user-controlled after creation)
- Importance **high** (heads-up eligible), vibration enabled with pattern, default notification sound, lock-screen **public** visibility (operational alert), LED enabled
- User-facing name: **"Stay Awake Alerts"** — description: "Urgent on-duty fatigue-check prompts from the control room"
- **Limitation documented:** Base44 native push cannot select an Android channel. The supported mapping is implemented in the native shell: the foreground display interception routes Stay Awake prompts to `stay_awake_alerts` (detected by the `challenge=` deep link in the push data, with a title fallback) and stages the deep link for the WebView. **Background** pushes display on the provider's default channel — verify behaviour in the device test; do not claim high-importance background behaviour until verified.
- Call notifications keep their own separate `calls` channel; this path never touches it.

---

## 5. Corrected offline expectations

A device offline when the server issues a challenge receives nothing (no realtime event, no cached push). The server issues and stores the challenge independently. No client-generated offline prompt or acknowledgement is authoritative. Separated scenarios:

- **O1 — Challenge issued while offline; reconnect before deadline:** device fetches the active challenge by authenticated server query and may acknowledge it.
- **O2 — Challenge issued while offline; reconnect after deadline:** the app shows the authoritative missed/expired state; acknowledgement is rejected (`PROMPT_EXPIRED`).
- **O3 — Challenge received, then connection lost before acknowledgement:** the countdown continues locally from the server-issued deadline; an offline confirm shows "NOT recorded — reconnect and confirm before the timer ends"; the server deadline governs.
- **O4 — Offline acknowledgement reaches the server before the deadline:** accepted, server-stamped, exactly once. (The client does not queue acknowledgements — the guard re-confirms after reconnect.)
- **O5 — Offline acknowledgement reaches the server after the deadline:** rejected (`PROMPT_EXPIRED`); the missed outcome and its escalation stand.

---

## 6. APK versus PWA — separate tracks

Every case states its track. Android background, force-stop, notification-channel and wake behaviour differ between the native APK and the PWA/browser and are reported separately.

**Force-stop:** native Android commonly blocks push until the app is manually reopened — this is an Android behaviour, **not an application failure**. Browser/PWA force-stop/site-notification behaviour depends on the browser and is reported separately.

**Not claimed until verified:** locked-screen wake, alarm sound, heads-up notification, and removed-from-recents delivery. These depend on the dedicated channel and a proven device registration, both pending physical verification.

---

## 7. Push registration evidence (current state)

| Item | Value |
|---|---|
| Test guard user ID | `6ab23d02b459271f41bf1e13` (usstest1) |
| Existing registration | **One candidate**: `android`, permission `granted`, status `active`, registered 2026-09-22 10:44 UTC, last active 2026-09-22 10:44 UTC. This is a CANDIDATE, not proof — it must be re-verified on Device A at test start (re-register; confirm the fingerprint/timestamp updates and the record still resolves to usstest1) |
| Provider | Base44 platform push (FCM/APNs token registry owned platform-side — raw tokens never stored in the app); OneSignal app `526d4393-9f50-4f8e-8379-05ec176dc62d` fronts the native shell (v5.6.1) and web/PWA SDK |
| Registration ownership | Server-resolved: `user_id` is always the authenticated caller — the client never supplies it |
| Stale registrations | Delivery filters `{user_id: <test guard>, status: 'active'}` — only the test guard's own active registrations; other users' registrations are never selected, and the recipient is always resolved server-side |
| Logout / unlink | `registerPushDevice` action `unregister`, reason `logout`, scoped to THIS device fingerprint — other devices untouched |
| Token rotation | Platform owns the provider token registry; at app level a reinstall/storage wipe generates a new fingerprint and re-registration supersedes the stale record (old record goes `inactive`, retained for diagnostics) |

**Gate: a provider request without a valid Device A registration is not a delivery test.** No push has been sent; push cases below require Device A registration proof first.

---

## 8. Corrected physical test pack

DELIVERY_MODE=test throughout: all audited email goes to the test mailbox; no real customer/administrator receives anything. Run **Track A (native APK)** first, then **Track B (PWA)** if PWA support remains required.

**Pre-test checklist (both tracks):** ① re-verify Device A registration (§7); ② recreate fixture shift if the self-test ran since (§2); ③ administrator enables Stay Awake for usstest1 (5-minute interval already set); ④ confirm Device B (accesstestadmin) is signed in. Record per case: timestamps (SAST), screen/battery state, push latency, screenshot, and the resulting StayAwakeLog record.

### Track A — Native Android APK

| # | Setup / Action | Expected device behaviour | Expected admin | Expected server record | Evidence |
|---|---|---|---|---|---|
| A1 | App foreground, screen on; wait for interval | Full-screen challenge overlay with 60 s countdown; screen stays awake (operation-scoped wake lock) | — | `sent` + challenge id + 60 s deadline | Overlay screenshot |
| A2 | App backgrounded at prompt time | Heads-up push **(pending channel/registration verification)**; tap opens the deep-linked challenge, not a stale one | — | `sent` at issue time | Push latency + opened challenge id |
| A3 | Screen locked at prompt time | Report wake behaviour **separately — not claimed**; unlocking shows the live countdown or truthful expired state | — | unchanged | Wake result + remaining seconds |
| A4 | Removed from recents at prompt time | Report delivery result **separately — not claimed** | — | unchanged | Push arrival result |
| A5 | App force-stopped at prompt time | Android typically suppresses push until reopened — **expected platform behaviour, not an app failure**; reopening shows the authoritative state | — | prompt lifecycle unaffected | Documented suppression |
| A6/A7 | Acknowledge on Wi-Fi, then on mobile data | "Acknowledgement recorded" both times | — | `acknowledged`, server-stamped response time | Both records + latencies |
| A8 | Tap an OLD notification (already acknowledged/missed/cancelled) after a newer challenge exists | Safe final state overlay for THAT challenge; never opens the newer one | — | No state change | Screenshot + challenge id |
| A9 | Double-tap Confirm rapidly | One success, no error | — | Exactly one acknowledged transition (CAS) | Single response_time |
| A10 | Let the countdown reach 0 | Expired/missed state shown | ONE escalation set (in-app + push + test-mailbox email), never duplicated on refresh | `missed`, missed_at stamped once | Admin screenshots + email |
| A11 | Clock out with a pending prompt | Overlay disappears | No escalation | `cancelled`, never escalated | Cancelled record |
| A12 | Battery optimisation ON vs OFF (repeat A2) | Compare background push reliability; expect degradation with optimisation ON | — | unchanged | Side-by-side results |
| A13 | Android Settings → App → Notifications | `Stay Awake Alerts` channel visible: high importance, sound + vibration on | — | — | Channel settings screenshot |

### Track B — PWA (installed/browser) — only if PWA support remains required

| # | Setup / Action | Expected behaviour | Evidence |
|---|---|---|---|
| B1 | Foreground prompt | Same overlay; wake lock per browser support | Screenshot |
| B2 | Backgrounded tab at prompt time | Web push via service worker **if browser notification state allows** — report separately from APK | Push result + browser state |
| B3 | Screen locked | Browser-dependent; report separately — not claimed | Wake result |
| B4 | Force-stopped browser / site notifications disabled | Browser/site-state dependent; may not deliver — not an app failure | Documented result |
| B5 | Wi-Fi/data acknowledge | Same authoritative record path | Record |
| B6 | Old/expired notification deep link | Same safe final states as A8 | Screenshot |
| B7 | Missed deadline | Same single deduplicated escalation as A10 | Admin view + test mailbox |

### Offline scenarios (run on Track A; optionally repeat B)

- **O1** Airplane-mode BEFORE the interval; reconnect before the deadline → the active challenge appears by authenticated query; acknowledge succeeds. *Server: `sent` → `acknowledged`.*
- **O2** Same, reconnect after the deadline → authoritative missed/expired state; acknowledge rejected. *Server: `missed` via sweep; escalation deduplicated.*
- **O3** Challenge received, then airplane-mode → countdown continues from the server deadline; offline confirm shows "NOT recorded". *Server: unchanged until ack or deadline.*
- **O4** Reconnect and confirm before the deadline → accepted, server-stamped once. *Server: `acknowledged`.*
- **O5** Reconnect and confirm after the deadline → `PROMPT_EXPIRED`; the missed outcome stands. *Server: `missed`.*

---

## 9. Verification snapshot (pre-device-test)

- Lifecycle self-test: **30/30 scenarios passing** (incl. S21–S27 challenge-routing matrix and S25b live gateway foreign resolve)
- Live gateway `resolve_challenge`: foreign → `not_found` (no projection leak); fabricated → `not_found`
- Syntax sweep (backend modules + frontend files) and production build: clean
- Enabled Stay Awake configurations: **zero** (test guard armed at test start; Danique disabled pending manual administrator confirmation)
- Pending challenge records: **zero**; duplicate outcomes/escalations: **zero**
- Email delivery mode: **test** (delivery-guard self-test 19/19; zero production-mode audit rows)