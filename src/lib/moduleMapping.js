/**
 * Maps page names to their required commercial module key.
 * Navigation items are filtered by ModuleEntitlement records.
 * Pages not in this map are always visible (no module requirement).
 */
export const PAGE_MODULE_MAP = {
  // CALLING module
  Contacts: "CALLING",
  CallHistory: "CALLING",
  CallRecordings: "CALLING",

  // OPERATIONS module
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

  // PATROL module
  GuardPatrol: "PATROL",
  PatrolDashboard: "PATROL",
  PatrolAnalytics: "PATROL",

  // ACCESS module
  AccessControl: "ACCESS",
  AccessHistory: "ACCESS",
  AccessSettings: "ACCESS",

  // REPORTING_CORE module
  PayrollSummary: "REPORTING_CORE",
  DataHub: "REPORTING_CORE",
  Reports: "REPORTING_CORE",
  Analytics: "REPORTING_CORE",
  GuardActivity: "REPORTING_CORE",
  AIReports: "REPORTING_CORE",
  ClientDashboard: "REPORTING_CORE",
  ClientReports: "REPORTING_CORE",

  // ESTATE module
  EstateManagerDashboard: "ESTATE",
  EstateResidents: "ESTATE",
  EstateVenues: "ESTATE",
  EstateVendors: "ESTATE",
  EstateLevy: "ESTATE",
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

  // OCCUPATIONAL_THERAPY module (Medical)
  MedicalDashboard: "OCCUPATIONAL_THERAPY",
  MedicalPatients: "OCCUPATIONAL_THERAPY",
  MedicalAppointments: "OCCUPATIONAL_THERAPY",
  MedicalEmployers: "OCCUPATIONAL_THERAPY",
  MedicalServices: "OCCUPATIONAL_THERAPY",
  MedicalSessions: "OCCUPATIONAL_THERAPY",
  MedicalAssessmentTemplates: "OCCUPATIONAL_THERAPY",
  EstateProperties: "ESTATE",
  EstateVoting: "ESTATE",

  // Client operational pages
  ClientDashboard: null,
  ClientReports: null,
  ClientIncidents: null,
  ResellerPortal: null,
};