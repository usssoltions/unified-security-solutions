# Stay Awake — Physical Android Device Test Pack

Bounded physical-device regression pack for the server-authoritative Stay Awake
(fatigue check) monitor. Server-side lifecycle logic is proven by
`stayAwakeSelfTest` (22 scenarios, isolated fixtures, test-mode delivery); this
pack covers ONLY what a physical device can prove: screen/wake-lock behaviour,
alarm/vibration, heads-up push, overlay lifecycle and touch reliability.

**Test tenant:** USS Access Control Test · **Guard:** usstest1 ·
**Supervisor device:** accesstestadmin (or platform admin account).

## Preconditions
1. Guard is invited to the test tenant and has an ACTIVE shift with a clock-in
   (Start of Shift completed on the device under test).
2. Stay Awake is enabled for the guard (interval: 5 minutes for fast testing).
3. Battery optimization is OFF for the app; the app is installed as a PWA or
   the debug Android shell.
4. OneSignal push permission granted (heads-up channel).
5. Server `DELIVERY_MODE` is `test` for the whole session — every audited
   email goes to the test mailbox regardless of recipient.

## Cases

| # | Case | Steps | Pass criteria |
|---|------|-------|--------------|
| D1 | Foreground prompt + wake lock | Guard clocks in, app open on My Shift, screen on, wait for the interval | Full-screen challenge appears with 60s countdown; screen STAYS ON for the whole window |
| D2 | Wake lock releases on acknowledge | Acknowledge promptly | Screen-off timer resumes normal behaviour immediately after ack |
| D3 | Screen-off prompt (PWA) | Press power button (screen off) when the prompt is due | Critical push wakes/heads-up the device; opening the app shows the live countdown; on-screen prompt is never skipped by a system sleep |
| D4 | Backgrounded prompt | Press Home (app backgrounded) at prompt time | Heads-up push arrives within ~10s; tapping it opens the app straight onto the challenge |
| D5 | Alarm + vibration | Prompt appears, do nothing for 5s | Audible alarm and vibration play while the prompt is live; both stop on acknowledge |
| D6 | Timely acknowledge | Acknowledge within the window | "Recorded" confirmation; server record shows `acknowledged` with stamped response time (check Stay Awake log in the admin view) |
| D7 | Late acknowledge (documented rule) | Let the countdown reach 0, then tap confirm | App states the prompt has expired; server record shows `missed`; no double prompts afterwards |
| D8 | Offline challenge (mobile data + Wi-Fi OFF) | Go offline before the prompt is due, prompt appears from the realtime cache, acknowledge while offline | The app reports NOT recorded/offline; when connectivity returns, a re-sync attempt AFTER the deadline is rejected by the same late rule; before the deadline it records and shows acknowledged |
| D9 | Missed escalation visible to management | Miss a prompt (D7) | Supervisor device gets: in-app notification, heads-up push, and (test-mode) email in the test mailbox — one of each, never duplicates on refresh |
| D10 | Cancel on clock-out | Clock out with a prompt pending | The overlay disappears (or never escalates); server log shows `cancelled`; management receives NOTHING |
| D11 | Cancel on disable | Supervisor disables Stay Awake for the guard with a prompt pending | Overlay disappears; log shows `cancelled`; no escalation |
| D12 | Logout with pending prompt | Trigger a prompt, then immediately log out | Overlay is destroyed by the logout reload; after re-login the pending prompt reappears live with the SAME deadline (server is the source of truth) |
| D13 | Next cycle after a miss | After a missed prompt, stay clocked in | Exactly ONE new prompt arrives one full configured interval later — never a rapid loop |
| D14 | Escalation tenant isolation (two-device) | Both test tenants' guards clocked in; miss a prompt as Customer A only | Only Customer A's management receives anything; Customer B's devices stay silent |
| D15 | Touch reliability under vibration | Tap Confirm while the alarm vibrates | Single tap registers (no double-ack error, no dead taps) |

## Record for each case
- Device model + Android version, install type (PWA / debug APK)
- Timestamps (SAST): prompt shown / acknowledged / result observed
- Screen and battery state at prompt time
- Push latency (prompt time → heads-up shown)
- Screenshot of the challenge overlay and of the supervisor notification
- StayAwakeLog status afterwards (from admin view)

## Known open items affecting this pack
- Native push production delivery is pending the Android Firebase credential
  upload — D3/D4/D9 push legs are blocked until then (in-app legs still valid).
- TURN/WebRTC reliability and authentication consistency are out of scope here
  (covered by their own pending verification).