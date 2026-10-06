# Backup & Recovery — Audit, Facts and Recovery Procedures (2026-10-06)

This document records only VERIFIED facts from platform documentation and live tests on this app. Nothing here is assumed or promised.

## 1. Current plan status (VERIFIED)

- Workspace plan: **Builder**.
- Base44 Backup & Restore (table data point-in-time backups) is available on **Elite and Enterprise plans only** — **not on Builder**. On this plan there is currently NO platform-managed table backup.
- Even on Elite/Enterprise, platform backups cover **table records only**. Per Base44 documentation: *"The file it points to is stored separately and is not part of the backup."* Uploaded files/photos/evidence are NEVER covered by platform backups on any plan.
- Code and design changes are recoverable via the editor's Version History (independent of data backups).
- A full app clone (code + data) can be made manually from the **App Settings** dashboard page — a manual recovery point, not an automated schedule.

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