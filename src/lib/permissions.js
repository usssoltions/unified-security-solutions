/**
 * Central role → page + permission model for USS Guard.
 *
 * Mirrors the role navigation already rendered in src/Layout.jsx, but lifts it
 * into a reusable, queryable form so route guards (ProtectedPage) and feature
 * gates (can()) can enforce the SAME rules at the route level — not only by
 * hiding buttons. This is the foundation for Phase 3 (Access Settings /
 * Permissions) and Phase 12 (route/backend enforcement).
 */
import { createPageUrl } from "@/utils";

/* ------------------------------------------------------------------ */
/* Role → allowed page keys                                            */
/* ------------------------------------------------------------------ */
export const ROLE_HOME = {
  admin: "ControlRoom",
  dispatcher: "ControlRoom",
  guard: "GuardShift",
  resident: "ResidentDashboard",
  estate_manager: "EstateManagerDashboard",
  vendor: "VendorPortal",
  client: "ClientDashboard",
  platform_admin: "ControlRoom",
  reseller_admin: "ResellerPortal",
  practice_admin: "MedicalDashboard",
  therapist: "MedicalDashboard",
  reception: "MedicalDashboard",
  employer_user: "EmployerPortal",
};

const P = (arr) => new Set(arr);

export const ROLE_PAGES = {
  guard: P([
    "GuardShift", "GuardMyShifts", "Contacts", "CallHistory", "CallRecordings",
    "GuardIncidents", "GuardMaintenance", "GuardPatrol",
    "AccessControl", "QRScanner", "StartOfShift", "StartOfShiftHistory", "Profile",
  ]),
  dispatcher: P([
    "ControlRoom", "AdminIncidents", "PanicManagement", "AccessControl", "AccessHistory", "AccessSettings",
    "Contacts", "CallHistory", "CallRecordings", "Scheduling",
    "ClockInOutReports", "SiteManagement", "PatrolDashboard", "PatrolAnalytics",
    "SiteMapDashboard", "PayrollSummary", "DataHub", "Reports", "Analytics",
    "GuardActivity", "AIReports", "UserManagement", "AssetManagement",
    "StayAwakeConfiguration", "Configuration", "StartOfShiftHistory", "Profile",
  ]),
  admin: P([
    "ControlRoom", "AdminIncidents", "PanicManagement", "AccessControl", "AccessHistory", "AccessSettings",
    "Contacts", "CallHistory", "CallRecordings", "Scheduling",
    "ClockInOutReports", "SiteManagement", "PatrolDashboard", "PatrolAnalytics",
    "SiteMapDashboard", "PayrollSummary", "DataHub", "Reports", "Analytics",
    "GuardActivity", "AIReports", "UserManagement", "AssetManagement",
    "StayAwakeConfiguration", "Configuration", "StartOfShiftHistory", "Profile",
  ]),
  resident: P([
    "ResidentDashboard", "ResidentVisitors", "ResidentBookings", "ResidentOrders",
    "ResidentLaundry", "ResidentIncidents", "ResidentMaintenance",
    "ResidentTickets", "ResidentPayments", "ResidentAnnouncements", "Profile",
  ]),
  estate_manager: P([
    "EstateManagerDashboard", "EstateResidents", "EstateVenues", "EstateVendors",
    "EstateLevy", "EstateProperties", "EstateVoting",
    "AccessControl", "PanicManagement", "ControlRoom", "Profile",
  ]),
  vendor: P(["VendorPortal", "Profile"]),
  client: P(["ClientDashboard", "ClientReports", "ClientIncidents", "Profile"]),
  reseller_admin: P(["ResellerPortal", "UserManagement", "Configuration", "Reports", "Profile"]),
  platform_admin: P([
    "ControlRoom", "AdminIncidents", "AdminMaintenance", "PanicManagement",
    "AccessControl", "AccessHistory", "AccessSettings",
    "Contacts", "CallHistory", "CallRecordings", "Scheduling",
    "ClockInOutReports", "SiteManagement", "PatrolDashboard", "PatrolAnalytics",
    "SiteMapDashboard", "PayrollSummary", "DataHub", "Reports", "Analytics",
    "GuardActivity", "AIReports", "UserManagement", "AssetManagement",
    "StayAwakeConfiguration", "Configuration", "StartOfShiftHistory",
    "MedicalDashboard", "MedicalPatients", "MedicalAppointments",
    "MedicalEmployers", "MedicalServices", "MedicalSessions",
    "MedicalAssessmentTemplates", "ResellerPortal", "TenantSetup",
    "EstateProperties", "EstateVoting",
    "ClientDashboard", "ClientReports", "ClientIncidents",
    "EstateManagerDashboard", "EstateResidents", "EstateVenues", "EstateVendors",
    "EstateLevy", "EmployerPortal", "Profile",
  ]),
  practice_admin: P([
    "MedicalDashboard", "MedicalPatients", "MedicalAppointments",
    "MedicalEmployers", "MedicalServices", "MedicalSessions",
    "MedicalAssessmentTemplates", "UserManagement", "Configuration", "Reports",
    "EmployerPortal", "Profile",
  ]),
  therapist: P([
    "MedicalDashboard", "MedicalPatients", "MedicalAppointments",
    "MedicalSessions", "MedicalAssessmentTemplates", "Profile",
  ]),
  reception: P([
    "MedicalDashboard", "MedicalPatients", "MedicalAppointments",
    "MedicalEmployers", "Profile",
  ]),
  employer_user: P(["EmployerPortal", "Profile"]),
};

/* Pages that are safe for every authenticated user (shared utility pages) */
const PUBLIC_PAGES = new Set(["AndroidDownload"]);

/* ------------------------------------------------------------------ */
/* Fine-grained permission catalog (Phase 3)                           */
/* ------------------------------------------------------------------ */
export const PERMISSIONS = {
  ACCESS_VIEW: "access_control.view",
  ACCESS_PROCESS_ENTRY: "access_control.process_entry",
  ACCESS_PROCESS_EXIT: "access_control.process_exit",
  ACCESS_MANUAL_EXIT: "access_control.manual_exit",
  ACCESS_VIEW_LOG: "access_control.view_log",
  ACCESS_VIEW_HISTORY: "access_control.view_history",

  BLACKLIST_ADD_PERSON: "blacklist.add_person",
  BLACKLIST_EDIT_PERSON: "blacklist.edit_person",
  BLACKLIST_DEACTIVATE_PERSON: "blacklist.deactivate_person",
  BLACKLIST_ADD_VEHICLE: "blacklist.add_vehicle",
  BLACKLIST_EDIT_VEHICLE: "blacklist.edit_vehicle",
  BLACKLIST_DEACTIVATE_VEHICLE: "blacklist.deactivate_vehicle",
  BLACKLIST_OVERRIDE: "blacklist.override",
  BLACKLIST_VIEW_OVERRIDE_HISTORY: "blacklist.view_override_history",

  SETTINGS_DESTINATIONS: "settings.manage_destinations",
  SETTINGS_WORK_TYPES: "settings.manage_work_types",
  SETTINGS_ACCESS: "settings.manage_access_settings",
  SETTINGS_PERMISSIONS: "settings.manage_permissions",
};

const ALL = new Set(Object.values(PERMISSIONS));

function set(...perms) { return new Set(perms); }

export const ROLE_PERMISSIONS = {
  admin: ALL,
  dispatcher: set(
    PERMISSIONS.ACCESS_VIEW, PERMISSIONS.ACCESS_PROCESS_ENTRY, PERMISSIONS.ACCESS_PROCESS_EXIT,
    PERMISSIONS.ACCESS_MANUAL_EXIT, PERMISSIONS.ACCESS_VIEW_LOG, PERMISSIONS.ACCESS_VIEW_HISTORY,
    PERMISSIONS.BLACKLIST_OVERRIDE, PERMISSIONS.BLACKLIST_VIEW_OVERRIDE_HISTORY,
  ),
  guard: set(
    PERMISSIONS.ACCESS_PROCESS_ENTRY, PERMISSIONS.ACCESS_PROCESS_EXIT,
    PERMISSIONS.ACCESS_MANUAL_EXIT, PERMISSIONS.ACCESS_VIEW_LOG,
  ),
  estate_manager: set(
    PERMISSIONS.ACCESS_VIEW, PERMISSIONS.ACCESS_PROCESS_ENTRY, PERMISSIONS.ACCESS_PROCESS_EXIT,
    PERMISSIONS.ACCESS_MANUAL_EXIT, PERMISSIONS.ACCESS_VIEW_LOG, PERMISSIONS.ACCESS_VIEW_HISTORY,
    PERMISSIONS.BLACKLIST_ADD_PERSON, PERMISSIONS.BLACKLIST_EDIT_PERSON, PERMISSIONS.BLACKLIST_DEACTIVATE_PERSON,
    PERMISSIONS.BLACKLIST_ADD_VEHICLE, PERMISSIONS.BLACKLIST_EDIT_VEHICLE, PERMISSIONS.BLACKLIST_DEACTIVATE_VEHICLE,
    PERMISSIONS.BLACKLIST_OVERRIDE, PERMISSIONS.BLACKLIST_VIEW_OVERRIDE_HISTORY,
    PERMISSIONS.SETTINGS_DESTINATIONS, PERMISSIONS.SETTINGS_WORK_TYPES, PERMISSIONS.SETTINGS_ACCESS,
  ),
  resident: set(),
  vendor: set(),
  client: set(),
  platform_admin: ALL,
  reseller_admin: set(
    PERMISSIONS.ACCESS_VIEW, PERMISSIONS.ACCESS_VIEW_HISTORY,
    PERMISSIONS.SETTINGS_DESTINATIONS, PERMISSIONS.SETTINGS_WORK_TYPES,
    PERMISSIONS.SETTINGS_ACCESS, PERMISSIONS.SETTINGS_PERMISSIONS,
  ),
  practice_admin: set(),
  therapist: set(),
  reception: set(),
  employer_user: set(),
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */
export function roleHomePath(user) {
  const role = user?.role_type;
  const home = ROLE_HOME[role] || "Profile";
  return createPageUrl(home);
}

export function canAccessPage(user, pageKey) {
  if (!user) return false;
  if (PUBLIC_PAGES.has(pageKey)) return true;
  const allowed = ROLE_PAGES[user.role_type];
  return allowed ? allowed.has(pageKey) : false;
}

export function can(user, permission) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role_type];
  return perms ? perms.has(permission) : false;
}