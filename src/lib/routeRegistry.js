/**
 * Unified Route Registry — the SINGLE source of truth for per-role navigation.
 *
 * Every role's sidebar entries (title, page key, icon, root marker) live here.
 * Both the navigation UI (src/Layout.jsx) and the permission gate
 * (src/lib/permissions.js → ROLE_HOME / ROLE_PAGES) derive from this registry,
 * so a page can never appear in the sidebar while being blocked by the route
 * guard (or vice-versa).
 *
 * `EXTRA_ALLOWED_PAGES` holds pages an authenticated role may reach (via tabs,
 * direct links, or workflows) but which are not listed in the sidebar.
 */
import {
  Shield, Radio, Calendar, AlertTriangle, MapPin, BarChart3, Users,
  Clock, Mic, QrCode, Wrench, Zap, FileText, Sliders, Package, Sparkles,
  UserCircle, ShirtIcon, Bell, Building2, Vote, Stethoscope, Activity, Gauge,
} from "lucide-react";

export const ROUTE_REGISTRY = {
  guard: [
    { title: "My Shift", pageKey: "GuardShift", icon: Shield, isRoot: true },
    { title: "My Schedule", pageKey: "GuardMyShifts", icon: Calendar },
    { title: "Contacts", pageKey: "Contacts", icon: Users },
    { title: "Call History", pageKey: "CallHistory", icon: Clock },
    { title: "Call Recordings", pageKey: "CallRecordings", icon: Mic },
    { title: "Incidents", pageKey: "GuardIncidents", icon: AlertTriangle },
    { title: "Maintenance", pageKey: "GuardMaintenance", icon: MapPin },
    { title: "AI Patrol", pageKey: "GuardPatrol", icon: Shield },
    { title: "Access Control", pageKey: "AccessControl", icon: QrCode },
    { title: "Shift Reports", pageKey: "StartOfShiftHistory", icon: FileText },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  dispatcher: [
    { title: "Control Room", pageKey: "ControlRoom", icon: Radio, isRoot: true },
    { title: "Incident Queue", pageKey: "AdminIncidents", icon: AlertTriangle },
    { title: "Maintenance Queue", pageKey: "AdminMaintenance", icon: Wrench },
    { title: "Panic Queue", pageKey: "PanicManagement", icon: Zap },
    { title: "Access Control", pageKey: "AccessControl", icon: QrCode },
    { title: "Access History", pageKey: "AccessHistory", icon: FileText },
    { title: "Access Settings", pageKey: "AccessSettings", icon: Sliders },
    { title: "Contacts", pageKey: "Contacts", icon: Users },
    { title: "Call History", pageKey: "CallHistory", icon: Clock },
    { title: "Call Recordings", pageKey: "CallRecordings", icon: Mic },
    { title: "Scheduling", pageKey: "Scheduling", icon: Calendar },
    { title: "Clock In/Out", pageKey: "ClockInOutReports", icon: Clock },
    { title: "Sites", pageKey: "SiteManagement", icon: MapPin },
    { title: "Patrol Dashboard", pageKey: "PatrolDashboard", icon: Shield },
    { title: "Patrol Analytics", pageKey: "PatrolAnalytics", icon: BarChart3 },
    { title: "Site Map", pageKey: "SiteMapDashboard", icon: MapPin },
    { title: "Payroll", pageKey: "PayrollSummary", icon: BarChart3 },
    { title: "Data Hub", pageKey: "DataHub", icon: FileText },
    { title: "Reports", pageKey: "Reports", icon: FileText },
    { title: "Analytics", pageKey: "Analytics", icon: BarChart3 },
    { title: "Guard Activity", pageKey: "GuardActivity", icon: Users },
    { title: "AI Reports", pageKey: "AIReports", icon: Sparkles },
    { title: "Shift Reports", pageKey: "StartOfShiftHistory", icon: FileText },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Assets", pageKey: "AssetManagement", icon: Package },
    { title: "Stay Awake", pageKey: "StayAwakeConfiguration", icon: Zap },
    { title: "Configuration", pageKey: "Configuration", icon: Sliders },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  // `admin` (customer-level admin) shares the dispatcher navigation.
  admin: [
    { title: "Control Room", pageKey: "ControlRoom", icon: Radio, isRoot: true },
    { title: "Incident Queue", pageKey: "AdminIncidents", icon: AlertTriangle },
    { title: "Maintenance Queue", pageKey: "AdminMaintenance", icon: Wrench },
    { title: "Panic Queue", pageKey: "PanicManagement", icon: Zap },
    { title: "Access Control", pageKey: "AccessControl", icon: QrCode },
    { title: "Access History", pageKey: "AccessHistory", icon: FileText },
    { title: "Access Settings", pageKey: "AccessSettings", icon: Sliders },
    { title: "Contacts", pageKey: "Contacts", icon: Users },
    { title: "Call History", pageKey: "CallHistory", icon: Clock },
    { title: "Call Recordings", pageKey: "CallRecordings", icon: Mic },
    { title: "Scheduling", pageKey: "Scheduling", icon: Calendar },
    { title: "Clock In/Out", pageKey: "ClockInOutReports", icon: Clock },
    { title: "Sites", pageKey: "SiteManagement", icon: MapPin },
    { title: "Patrol Dashboard", pageKey: "PatrolDashboard", icon: Shield },
    { title: "Patrol Analytics", pageKey: "PatrolAnalytics", icon: BarChart3 },
    { title: "Site Map", pageKey: "SiteMapDashboard", icon: MapPin },
    { title: "Payroll", pageKey: "PayrollSummary", icon: BarChart3 },
    { title: "Data Hub", pageKey: "DataHub", icon: FileText },
    { title: "Reports", pageKey: "Reports", icon: FileText },
    { title: "Analytics", pageKey: "Analytics", icon: BarChart3 },
    { title: "Guard Activity", pageKey: "GuardActivity", icon: Users },
    { title: "AI Reports", pageKey: "AIReports", icon: Sparkles },
    { title: "Shift Reports", pageKey: "StartOfShiftHistory", icon: FileText },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Assets", pageKey: "AssetManagement", icon: Package },
    { title: "Stay Awake", pageKey: "StayAwakeConfiguration", icon: Zap },
    { title: "Configuration", pageKey: "Configuration", icon: Sliders },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  resident: [
    { title: "Home", pageKey: "ResidentDashboard", icon: Users, isRoot: true },
    { title: "Visitors", pageKey: "ResidentVisitors", icon: QrCode },
    { title: "Bookings", pageKey: "ResidentBookings", icon: Calendar },
    { title: "Order Food/Shop", pageKey: "ResidentOrders", icon: Package },
    { title: "Laundry", pageKey: "ResidentLaundry", icon: ShirtIcon },
    { title: "Maintenance", pageKey: "ResidentMaintenance", icon: Wrench },
    { title: "Security", pageKey: "ResidentIncidents", icon: Shield },
    { title: "Tickets", pageKey: "ResidentTickets", icon: FileText },
    { title: "Payments", pageKey: "ResidentPayments", icon: Wrench },
    { title: "Announcements", pageKey: "ResidentAnnouncements", icon: Bell },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  estate_manager: [
    { title: "Dashboard", pageKey: "EstateManagerDashboard", icon: BarChart3, isRoot: true },
    { title: "Residents", pageKey: "EstateResidents", icon: Users },
    { title: "Venues", pageKey: "EstateVenues", icon: MapPin },
    { title: "Vendors", pageKey: "EstateVendors", icon: Package },
    { title: "Levy Management", pageKey: "EstateLevy", icon: Sliders },
    { title: "Properties", pageKey: "EstateProperties", icon: Building2 },
    { title: "Voting", pageKey: "EstateVoting", icon: Vote },
    { title: "Access Control", pageKey: "AccessControl", icon: QrCode },
    { title: "Panic Queue", pageKey: "PanicManagement", icon: Zap },
    { title: "Security", pageKey: "ControlRoom", icon: Shield },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  vendor: [
    { title: "My Portal", pageKey: "VendorPortal", icon: Package, isRoot: true },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  client: [
    { title: "Dashboard", pageKey: "ClientDashboard", icon: BarChart3, isRoot: true },
    { title: "Reports", pageKey: "ClientReports", icon: FileText },
    { title: "Incidents", pageKey: "ClientIncidents", icon: AlertTriangle },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  // Customer Administrator — customer-scoped operational dashboard. Lands on
  // the customer dashboard (core, not module-gated) so login always resolves;
  // operational module pages they are licensed for are reachable and gated by
  // ProtectedPage's module-entitlement check.
  customer_admin: [
    { title: "Dashboard", pageKey: "ClientDashboard", icon: BarChart3, isRoot: true },
    { title: "Sites", pageKey: "SiteManagement", icon: MapPin },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  reseller_admin: [
    { title: "Reseller Portal", pageKey: "ResellerPortal", icon: Building2, isRoot: true },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Configuration", pageKey: "Configuration", icon: Sliders },
    { title: "Reports", pageKey: "Reports", icon: FileText },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  practice_admin: [
    { title: "Dashboard", pageKey: "MedicalDashboard", icon: Stethoscope, isRoot: true },
    { title: "Patients", pageKey: "MedicalPatients", icon: Users },
    { title: "Appointments", pageKey: "MedicalAppointments", icon: Calendar },
    { title: "Employers", pageKey: "MedicalEmployers", icon: Package },
    { title: "Services", pageKey: "MedicalServices", icon: Stethoscope },
    { title: "Sessions", pageKey: "MedicalSessions", icon: Activity },
    { title: "Assessment Templates", pageKey: "MedicalAssessmentTemplates", icon: FileText },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Configuration", pageKey: "Configuration", icon: Sliders },
    { title: "Employer Portal", pageKey: "EmployerPortal", icon: Building2 },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  therapist: [
    { title: "Dashboard", pageKey: "MedicalDashboard", icon: Stethoscope, isRoot: true },
    { title: "Patients", pageKey: "MedicalPatients", icon: Users },
    { title: "Appointments", pageKey: "MedicalAppointments", icon: Calendar },
    { title: "Sessions", pageKey: "MedicalSessions", icon: Activity },
    { title: "Assessment Templates", pageKey: "MedicalAssessmentTemplates", icon: FileText },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  reception: [
    { title: "Dashboard", pageKey: "MedicalDashboard", icon: Stethoscope, isRoot: true },
    { title: "Patients", pageKey: "MedicalPatients", icon: Users },
    { title: "Appointments", pageKey: "MedicalAppointments", icon: Calendar },
    { title: "Employers", pageKey: "MedicalEmployers", icon: Package },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  employer_user: [
    { title: "Employer Portal", pageKey: "EmployerPortal", icon: Building2, isRoot: true },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
  platform_admin: [
    { title: "Control Room", pageKey: "ControlRoom", icon: Radio, isRoot: true },
    { title: "Panic Queue", pageKey: "PanicManagement", icon: Zap },
    { title: "Reseller Portal", pageKey: "ResellerPortal", icon: Building2 },
    { title: "Tenant Setup", pageKey: "TenantSetup", icon: Building2 },
    { title: "Sites", pageKey: "SiteManagement", icon: MapPin },
    { title: "User Management", pageKey: "UserManagement", icon: Users },
    { title: "Configuration", pageKey: "Configuration", icon: Sliders },
    { title: "Reports", pageKey: "Reports", icon: FileText },
    { title: "Diagnostics", pageKey: "PlatformDiagnostics", icon: Gauge },
    { title: "Profile", pageKey: "Profile", icon: UserCircle },
  ],
};

// Pages a role may access but which are NOT shown in the sidebar (reached via
// mobile tabs, direct links, or workflow transitions).
export const EXTRA_ALLOWED_PAGES = {
  guard: ["QRScanner", "StartOfShift"],
  // Platform Admins can reach every module's pages; the sidebar is trimmed to
  // platform-level tools, so the rest are listed as explicitly allowed.
  platform_admin: [
    "AdminIncidents", "AdminMaintenance", "PanicManagement",
    "AccessControl", "AccessHistory", "AccessSettings",
    "Contacts", "CallHistory", "CallRecordings", "Scheduling",
    "ClockInOutReports", "SiteManagement", "PatrolDashboard", "PatrolAnalytics",
    "SiteMapDashboard", "PayrollSummary", "DataHub", "Analytics",
    "GuardActivity", "AIReports", "AssetManagement", "StayAwakeConfiguration",
    "StartOfShiftHistory",
    "MedicalDashboard", "MedicalPatients", "MedicalAppointments",
    "MedicalEmployers", "MedicalServices", "MedicalSessions",
    "MedicalAssessmentTemplates",
    "EstateManagerDashboard", "EstateResidents", "EstateVenues", "EstateVendors",
    "EstateLevy", "EstateProperties", "EstateVoting",
    "ClientDashboard", "ClientReports", "ClientIncidents", "EmployerPortal",
    "ResellerManagement", "CustomerManagement",
    "MedicalPatientDetail", "MedicalEmployerDetail", "PlatformDiagnostics",
  ],
  reseller_admin: ["ResellerManagement", "CustomerManagement"],
  practice_admin: ["MedicalPatientDetail", "MedicalEmployerDetail"],
  therapist: ["MedicalPatientDetail", "MedicalEmployerDetail"],
  reception: ["MedicalPatientDetail", "MedicalEmployerDetail"],
};

/**
 * Ordered sidebar navigation entries for a role. Each entry includes the
 * resolved icon component and `url` for direct rendering.
 */
export function getNavItems(role) {
  const entries = ROUTE_REGISTRY[role] || [];
  return entries.map((e) => ({ ...e, url: `/${e.pageKey}` }));
}

/** The root (home) page key for a role, or null. */
export function getRoleHomeKey(role) {
  const entry = (ROUTE_REGISTRY[role] || []).find((e) => e.isRoot);
  return entry ? entry.pageKey : null;
}

/** The full set of page keys a role is authorised to access. */
export function getRolePageKeys(role) {
  const sidebar = (ROUTE_REGISTRY[role] || []).map((e) => e.pageKey);
  const extra = EXTRA_ALLOWED_PAGES[role] || [];
  return new Set([...sidebar, ...extra]);
}