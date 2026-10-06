# Backup & Recovery — Audit, Facts and Recovery Procedures (2026-10-06)

This document records only VERIFIED facts from platform documentation and live tests on this app. Nothing here is assumed or promised.

## 1. Current plan status (VERIFIED)

- Workspace plan: **Builder**.
- **Clarification of "no platform backups"** — two distinct things must not be conflated:
  1. *Customer-accessible Backup & Restore* — a documented, customer-facing facility (Dashboard → Data → Backup & Restore) capturing table records at change time, with restore and undo. Available on **Elite and Enterprise plans only — not on Builder**. Official sources: https://docs.base44.com/Enterprise/backup-and-restore and the API reference "Get data version history status" (Elite keeps 7 days, higher plans 30 days).
  2. *Base44's internal disaster-recovery backups* — any platform-operated infrastructure-level backups/redundancy Base44 may run for its own operations. This is **not documented in any public documentation, is not customer-accessible, and could NOT be verified during this audit**. Whether it exists, what it covers (especially uploaded photos/documents), its retention, and whether Base44 can restore after accidental deletion caused by app bugs must be confirmed in writing by Base44 support (questions in §4).
  On the Builder plan there is therefore **no customer-accessible, customer-verifiable backup facility**; the existence and scope of internal DR remains unverified.
- Even on Elite/Enterprise, platform backups cover **table records only**. Per Base44 documentation: *"The file it points to is stored separately and is not part of the backup."* Uploaded files/photos/evidence are NEVER covered by platform backups on any plan.
- Code and design changes are recoverable via the editor's Version History (independent of data backups).
- A full app clone (code + data) can be made manually from the **App Settings** dashboard page — a manual recovery point, not an automated schedule.

## 1b. Measured storage footprint (2026-10-06, verified by live downloads)

**Database** — all 81 entities serialized and measured record by record:
- 12,386 records, **29.9 MB** of JSON-serialized table data. Largest: AccessLog 11.5 MB (1,841), HospitalityVisit 3.7 MB (1,851), Shift 1.7 MB, AttendanceRecord 1.5 MB (signatures included), GeneratedReport 1.5 MB.
- NOT measurable: physical/indexed storage and database overhead, anything Base44 stores outside app tables (internal DR, service configuration).

**Files** — every storage reference extracted from every entity field (strings and embedded arrays), deduplicated, then the ACTUAL BYTES downloaded and verified (magic bytes checked):
- **179 unique files, 156.9 MB measured** (113 files / 110.9 MB main scan + 66 files / 46.1 MB from worker profile photos, frozen showcase report attachments and asset-linked entities). Average ~0.9 MB; predominantly JPEG photos plus PDFs.
- Excluded as false positives: 245 strings containing storage-like URLs inside HTML content (email bodies, rendered report HTML) — table content, not files; already counted in DB size.
- NOT measurable: **orphaned files** — uploads whose record save failed are stored but unreachable (no file-listing API; known platform limitation). They consume storage but cannot be inventoried. Also unmeasurable: Base44-managed assets outside app storage.

**Growth (proxy — inflated by heavy demo/test seeding: 10,139 of 12,386 records are under 30 days old):**
- DB: 0.72 MB/day over 30 days; 2.54 MB/day over the last 7 days (spike).
- Files: ~32.4 MB of new file bytes referenced by records created in the last 30 days ≈ 1.08 MB/day.
- Live operational growth is likely below these rates; the range below brackets both.

**12-month single live copy:** DB ≈ 292 MB (low) – 957 MB (high); files ≈ 551 MB (low) – 1.25 GB (high). Total ≈ **0.85–2.2 GB**.

**Backup storage needed with the proposed retention policy** (7 daily + 4 weekly + 12 monthly restore points; DB as daily incrementals + monthly fulls; files content-addressed so unchanged files are copied exactly once; deleted-file contents retained ≥12 months):
- DB ≈ 2.5 GB (low) – 6.8 GB (high). Files ≈ 0.6 GB (low) – 1.5 GB (high, incl. re-copy margin and deleted-content retention).
- **Total ≈ 3 GB expected, up to ~8.5 GB worst case over 12 months.**

**Verified external storage costs (official pricing pages, checked 2026-10-06):**

| Option | Free tier | Paid rate | 12-month cost for this app | Notes |
|---|---|---|---|---|
| Cloudflare R2 | 10 GB-month | $0.015/GB-month, $0 egress | **$0** (entire projection fits the free tier) | S3-compatible API; API token stored as app secret |
| Backblaze B2 | 10 GB | $6.95/TB-month (~$0.007/GB) | **$0** in year one; ~$0.02/mo if exceeding 10 GB | S3-compatible API; API key stored as app secret |
| Google One 100 GB | — | **US$1.99/month** standard (SA price shown at checkout; recent African-market price increases documented) | ~US$24/year | Easiest to implement (Drive connector exists), but your Google storage is currently FULL — requires buying space |
| Base44 Elite plan | — | See Plan and billing (workspace Settings) | not quoted here | Adds customer Backup & Restore for TABLE DATA only (7 days); files still not covered |

## 2. What was verified live in this app (2026-10-06)

- Record inventory: AttendanceRecord 56, AttendanceWorker 57, AccessLog 1 841, HospitalityVisit 1 851, Incident 97, PlatformAuditLog 1 128, Customer 12, Reseller 2, ModuleEntitlement 27, ResellerEntitlement 19, VehicleLicenceDisc 64, plus all other module entities ≥1 record. Users: 34 with full role set (guard, customer_admin, platform_admin, etc.).
- Attendance signatures are stored as base64 PNG **inside the AttendanceRecord table rows** (all 56 records carry one). Any table-level backup or record export therefore captures signatures — they do not depend on file storage.
- ID-document photos are **private storage file references** (e.g. `private/.../id_document.jpg`), not URLs: 16 attendance records carry front+back refs. Private file contents were successfully retrieved during this audit (signed URL → HTTP 200 → valid JPEG, magic bytes `ff d8 ff e0`, 188 KB) — file contents ARE extractable for backup.
- Other file-holding records: HospitalityEvidence (file_uri), HospitalityVisit document photos (2 records with refs), MedicalFile (file_uri).
- Exports of every table are possible through the Base44 API (paginated list endpoints, service role). Users/roles and entitlements are readable and exportable.

## 3. Gaps (verified, not fixed by this audit)

| # | Gap | Impact |
|---|-----|--------|
| 1 | No platform table backups on Builder plan | Any record loss (accidental deletion, bad migration, platform incident) is currently **unrecoverable**. Effective RPO today: unbounded. |
| 2 | Files are excluded from platform backups on ALL plans | ID photos, evidence, documents would be lost even with Elite backups. |
| 3 | RPO = 0 is NOT verified for platform backups | Documentation says backups are saved "as data changes" but does not state a guaranteed recovery point interval. Must be confirmed with Base44 support (question below) before claiming RPO = 0. |
| 4 | No platform file versioning / delete protection is documented | A deleted original file (via app code bug or support action) may be unrecoverable. |
| 5 | Orphaned uploads | Photos uploaded to private storage but whose record save then failed are stored but unreachable (known platform limitation — no file listing API). Not data loss, but not recoverable through normal means. |

## 4. Questions for Base44 support (exact)

1. On Elite/Enterprise, is Backup & Restore continuous (RPO ≈ 0) or interval-based? What is the guaranteed maximum data-loss window?
2. Is there ANY mechanism to recover an uploaded private/public file after deletion (versioning, trash, support restore)?
3. Can Backup & Restore restores be scoped to a time window per table without overwriting newer records created after the restore point?

## 5. Proposal (requires approval before implementation — do NOT implement without sign-off)

**A. Independent automated backup to Google Drive** (separate from Base44 production):
- A scheduled workflow (e.g. every 6 h) invoking a backend function that:
  1. Exports ALL entities (paginated) to NDJSON, one file per entity, in a dated Drive folder (`Backup/<date>/<run>/`).
  2. Downloads every private file referenced by any record via `CreateFileSignedUrl` (60 min signed URLs) and uploads the actual bytes to the same Drive folder.
  3. Writes a manifest (entity counts, file counts+sizes, checksums) and a completion row; **marks the run FAILED unless every entity and every referenced file copied and verified** — a partial run is never reported as successful.
  4. Alerts the platform administrator on failure (email).
- Uses the Google Drive connector with the **narrow `drive.file` scope** (app-created files only — the backup job cannot see or delete anything else in the Drive).
- Costs: Google Drive storage on your own Google account (15 GB free; current footprint is a few hundred MB), plus scheduled-workflow runtime. No new third-party contract needed.
- Protection: backups live in a different tenant (your Google account), encrypted in transit (HTTPS) and at rest per Google's storage encryption; deletion of Base44 data cannot touch them. For immutability, enable Google Vault or set Drive retention practices on the backup account (Google-side setting, verified by you in Drive).

**B. Plan upgrade to Elite or Enterprise** (Plan and billing, workspace Settings) — adds platform table-data backups (7 days on Elite, 30 on Business/Enterprise). Still does NOT cover files; Proposal A remains required for files regardless.

**C. Monitoring**: after A is active, a dashboard/indicator shows the last successful backup run, entity+file counts, and failures (driven by the completion rows). Until then there is no backup to monitor.

## 6. Recovery procedures (documented; full restore test pending Proposal A)

**Table data restore (current plan, manual):**
1. Export the needed table via the API (service role, paginated `list` until `has_more=false`).
2. To restore: re-create records with `bulkCreate` into the SAME table (new record ids; the id field must be treated as new) — verify relationships (customer_id/worker_id/tenant links) remain intact because they are stored as plain fields in the export.
3. Never restore by deleting live records first unless the loss is total; restore into a copy first when possible.

**File restore:**
1. File references (storage URIs) are preserved in the exported records.
2. Actual bytes come from the Drive backup (Proposal A) or, while files still exist in Base44 storage, from `CreateFileSignedUrl` read-back (verified working in this audit).
3. Restore = re-upload via UploadPrivateFile and update the record's reference field.

**Exclusions (not recoverable by any mechanism documented here):**
- Platform authentication credentials (passwords, sessions) — users must use password reset / be re-invited. User records (emails, roles, names) ARE exportable table data.
- OAuth/integration tokens (Google Calendar, Telegram bot, OneSignal, Barkoder licence, etc.) — these live in platform secret/config storage, not in tables; re-authorize/re-enter after a full rebuild. Record the secret names, not values, in the runbook.
- App code/design — recoverable via Version History (editor), independent of data backups.

## 7. Restore-test status

- VERIFIED: read-back extraction of table data (all entities) and of file bytes (attendance ID photo round-trip, valid JPEG).
- NOT YET VERIFIED: end-to-end restore of a backup set into a working state, because no independent backup target exists yet. This requires Proposal A (or a manual app clone) and will be executed in an isolated scope without touching production records.