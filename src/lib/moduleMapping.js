/**
 * Maps page names to their required commercial module key.
 * Navigation items and route guards filter by ModuleEntitlement records.
 *
 * Pages NOT in this map are "CORE" platform infrastructure — always visible
 * to authenticated users (gated by role in permissions.js, not by module).
 *
 * Module keys:
 *   CORE (not mapped)          — shared infrastructure (Profile, Configuration, etc.)
 *   GUARD_SHIFT_CORE (not map) — Guard Shift / Start-of-Shift / Handover (shared)
 *   CALLING                    — Contacts, Call History, Call Recordings
 *   ACCESS                     — Access Control, Access History, Access Settings, QR Scanner
 *   PATROL                     — Patrol Dashboard, Patrol Analytics, Completed Patrols, etc.
 *   OPERATIONS                 — Control Room, Incidents, Maintenance, Panic, Scheduling, etc.
 *   ESTATE                     — Estate Manager, Residents, Venues, Vendors, Levy, Properties, Voting
 *   OCCUPATIONAL_THERAPY       — Medical Dashboard, Patients, Appointments, Sessions, etc.
 *   REPORTING_CORE             — Reports, Analytics, Data Hub, Payroll, AI Reports
 *   PLATFORM_ADMIN_ONLY        — Tenant Setup, Test Data, System Setup, OneSignal Test
 */
export const PAGE_MODULE_MAP = {
  // ── CALLING module ──────────────────────────────────────────────
  Contacts: "CALLING",
  CallHistory: "CALLING",
  CallRecordings: "CALLING",

  // ── OPERATIONS module ───────────────────────────────────────────
  ControlRoom: "OPERATIONS",
  AdminIncidents: "OPERATIONS",
  AdminMaintenance: "OPERATIONS",
  PanicManagement: "OPERATIONS",
  Scheduling: "OPERATIONS",
  ClockInOutReports: "OPERATIONS",
  SiteManagement: "OPERATIONS",
  SiteMapDashboard: "OPERATIONS",
  StartOfShiftHistory: "OPERATIONS",
  AssetManagement: "OPERATIONS",
  StayAwakeConfiguration: "OPERATIONS",
  GuardIncidents: "OPERATIONS",
  GuardMaintenance: "OPERATIONS",

  // ── PATROL module ───────────────────────────────────────────────
  GuardPatrol: "PATROL",
  PatrolDashboard: "PATROL",
  PatrolAnalytics: "PATROL",
  CompletedPatrols: "PATROL",
  PatrolChecklists: "PATROL",
  PatrolMonitoring: "PATROL",
  GuardPatrolChecklist: "PATROL",
  GuardPerformanceAnalytics: "PATROL",

  // ── ACCESS module ───────────────────────────────────────────────
  AccessControl: "ACCESS",
  AccessHistory: "ACCESS",
  AccessSettings: "ACCESS",
  QRScanner: "ACCESS",

  // ── REPORTING_CORE module ───────────────────────────────────────
  PayrollSummary: "REPORTING_CORE",
  DataHub: "REPORTING_CORE",
  Reports: "REPORTING_CORE",
  Analytics: "REPORTING_CORE",
  GuardActivity: "REPORTING_CORE",
  AIReports: "REPORTING_CORE",
  DailyReport: "REPORTING_CORE",
  ReportScheduling: "REPORTING_CORE",
  ClientDashboard: "REPORTING_CORE",
  ClientReports: "REPORTING_CORE",

  // ── ESTATE module ───────────────────────────────────────────────
  EstateManagerDashboard: "ESTATE",
  EstateResidents: "ESTATE",
  EstateVenues: "ESTATE",
  EstateVendors: "ESTATE",
  EstateLevy: "ESTATE",
  EstateProperties: "ESTATE",
  EstateVoting: "ESTATE",
  VendorPortal: "ESTATE",
  ResidentDashboard: "ESTATE",
  ResidentVisitors: "ESTATE",
  ResidentBookings: "ESTATE",
  ResidentOrders: "ESTATE",
  ResidentLaundry: "ESTATE",
  ResidentMaintenance: "ESTATE",
  ResidentIncidents: "ESTATE",
  ResidentTickets: "ESTATE",
  ResidentPayments: "ESTATE",
  ResidentAnnouncements: "ESTATE",

  // ── OCCUPATIONAL_THERAPY module (Medical) ───────────────────────
  MedicalDashboard: "OCCUPATIONAL_THERAPY",
  MedicalPatients: "OCCUPATIONAL_THERAPY",
  MedicalAppointments: "OCCUPATIONAL_THERAPY",
  MedicalEmployers: "OCCUPATIONAL_THERAPY",
  MedicalServices: "OCCUPATIONAL_THERAPY",
  MedicalSessions: "OCCUPATIONAL_THERAPY",
  MedicalAssessmentTemplates: "OCCUPATIONAL_THERAPY",
  MedicalPatientDetail: "OCCUPATIONAL_THERAPY",
  MedicalEmployerDetail: "OCCUPATIONAL_THERAPY",
  EmployerPortal: "OCCUPATIONAL_THERAPY",

  // ── Client operational pages — not module-gated (RLS-scoped) ────
  ClientIncidents: null,

  // ── ATTENDANCE_REGISTER module ──────────────────────────────────
  AttendanceDashboard: "ATTENDANCE_REGISTER",
  AttendanceRecords: "ATTENDANCE_REGISTER",
  AttendanceWorkers: "ATTENDANCE_REGISTER",
  AttendanceReports: "ATTENDANCE_REGISTER",
  AttendanceSettings: "ATTENDANCE_REGISTER",

  // ── PLATFORM_ADMIN_ONLY ─────────────────────────────────────────
  TenantSetup: "PLATFORM_ADMIN_ONLY",
  SystemSetup: "PLATFORM_ADMIN_ONLY",
  TestDataManager: "PLATFORM_ADMIN_ONLY",
  OneSignalTest: "PLATFORM_ADMIN_ONLY",
  PlatformDiagnostics: "PLATFORM_ADMIN_ONLY",

  // ── CORE / SHARED (not mapped — always visible per role) ───────
  // GuardShift, GuardMyShifts, StartOfShift, ShiftHandover,
  // Profile, Configuration, UserManagement, Home, AndroidDownload,
  // NotificationPreferences, ResellerPortal
};

/* Modules whose operational notifications genuinely use Telegram enrollments.
 * Customers without any of these modules enabled must not see Telegram
 * settings (e.g. an Attendance Register-only customer does not use Telegram
 * notifications). Telegram support itself is not removed — only the surface
 * is module-gated. */
export const TELEGRAM_MODULE_KEYS = ["OPERATIONS", "COMPLETE_SECURITY", "ESTATE"];