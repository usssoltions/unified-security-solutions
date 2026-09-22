/**
 * pages.config.js - Page routing configuration
 *
 * ROUTING NOTE: this file is no longer auto-generated for this app — it is
 * hand-maintained. New pages must also be added as explicit <Route> elements
 * in src/App.jsx (the loop below only renders the legacy pages listed here).
 *
 * CODE SPLITTING: heavy BACK-OFFICE pages (analytics, reports, admin) are
 * lazy-loaded so the initial bundle stays small. Every FIELD-FACING page
 * (guard, gate/access control, control room, scheduling, residents, estate)
 * is kept EAGER on purpose: field staff may navigate between pages while
 * offline mid-session, and an unvisited lazy chunk would fail to load
 * offline. Do not move field-facing pages into the lazy group.
 *
 * The only editable legacy value: mainPage.
 */
import React from 'react';
import AccessControl from './pages/AccessControl';
import EstateManagerDashboard from './pages/EstateManagerDashboard';
import EstateResidents from './pages/EstateResidents';
import EstateVendors from './pages/EstateVendors';
import EstateVenues from './pages/EstateVenues';
import ResidentAnnouncements from './pages/ResidentAnnouncements';
import ResidentBookings from './pages/ResidentBookings';
import ResidentDashboard from './pages/ResidentDashboard';
import ResidentOrders from './pages/ResidentOrders';
import ResidentTickets from './pages/ResidentTickets';
import ResidentVisitors from './pages/ResidentVisitors';
import VendorPortal from './pages/VendorPortal';
import AdminIncidents from './pages/AdminIncidents';
import AdminMaintenance from './pages/AdminMaintenance';
import AssetManagement from './pages/AssetManagement';
import CallHistory from './pages/CallHistory';
import CallRecordings from './pages/CallRecordings';
import Configuration from './pages/Configuration';
import Contacts from './pages/Contacts';
import ControlRoom from './pages/ControlRoom';
import DailyReport from './pages/DailyReport';
import GuardActivity from './pages/GuardActivity';
import GuardIncidents from './pages/GuardIncidents';
import GuardMaintenance from './pages/GuardMaintenance';
import GuardPatrolChecklist from './pages/GuardPatrolChecklist';
import GuardShift from './pages/GuardShift';
import Home from './pages/Home';
import Profile from './pages/Profile';
import QRScanner from './pages/QRScanner';
import ShiftHandover from './pages/ShiftHandover';
import SiteManagement from './pages/SiteManagement';
import StartOfShift from './pages/StartOfShift';
import SystemSetup from './pages/SystemSetup';
import TestDataManager from './pages/TestDataManager';
import UserManagement from './pages/UserManagement';
import GuardPatrol from './pages/GuardPatrol';
import GuardMyShifts from './pages/GuardMyShifts';
import __Layout from './Layout.jsx';

// ── Lazy-loaded BACK-OFFICE pages (see note above — never field-facing) ──
const AIReports = React.lazy(() => import('./pages/AIReports'));
const Analytics = React.lazy(() => import('./pages/Analytics'));
const ClockInOutReports = React.lazy(() => import('./pages/ClockInOutReports'));
const CompletedPatrols = React.lazy(() => import('./pages/CompletedPatrols'));
const DataHub = React.lazy(() => import('./pages/DataHub'));
const GuardPerformanceAnalytics = React.lazy(() => import('./pages/GuardPerformanceAnalytics'));
const NotificationPreferences = React.lazy(() => import('./pages/NotificationPreferences'));
const OneSignalTest = React.lazy(() => import('./pages/OneSignalTest'));
const PatrolAnalytics = React.lazy(() => import('./pages/PatrolAnalytics'));
const PatrolChecklists = React.lazy(() => import('./pages/PatrolChecklists'));
const PatrolDashboard = React.lazy(() => import('./pages/PatrolDashboard'));
const PatrolMonitoring = React.lazy(() => import('./pages/PatrolMonitoring'));
const PayrollSummary = React.lazy(() => import('./pages/PayrollSummary'));
const ReportScheduling = React.lazy(() => import('./pages/ReportScheduling'));
const Reports = React.lazy(() => import('./pages/Reports'));
const Scheduling = React.lazy(() => import('./pages/Scheduling'));
const SiteMapDashboard = React.lazy(() => import('./pages/SiteMapDashboard'));
const StayAwakeConfiguration = React.lazy(() => import('./pages/StayAwakeConfiguration'));


export const PAGES = {
    "AccessControl": AccessControl,
    "EstateManagerDashboard": EstateManagerDashboard,
    "EstateResidents": EstateResidents,
    "EstateVendors": EstateVendors,
    "EstateVenues": EstateVenues,
    "ResidentAnnouncements": ResidentAnnouncements,
    "ResidentBookings": ResidentBookings,
    "ResidentDashboard": ResidentDashboard,
    "ResidentOrders": ResidentOrders,
    "ResidentTickets": ResidentTickets,
    "ResidentVisitors": ResidentVisitors,
    "VendorPortal": VendorPortal,
    "AIReports": AIReports,
    "AdminIncidents": AdminIncidents,
    "AdminMaintenance": AdminMaintenance,
    "Analytics": Analytics,
    "AssetManagement": AssetManagement,
    "CallHistory": CallHistory,
    "CallRecordings": CallRecordings,
    "ClockInOutReports": ClockInOutReports,
    "CompletedPatrols": CompletedPatrols,
    "Configuration": Configuration,
    "Contacts": Contacts,
    "ControlRoom": ControlRoom,
    "DailyReport": DailyReport,
    "GuardActivity": GuardActivity,
    "GuardIncidents": GuardIncidents,
    "GuardMaintenance": GuardMaintenance,
    "GuardPatrolChecklist": GuardPatrolChecklist,
    "GuardPerformanceAnalytics": GuardPerformanceAnalytics,
    "GuardShift": GuardShift,
    "Home": Home,
    "NotificationPreferences": NotificationPreferences,
    "OneSignalTest": OneSignalTest,
    "PatrolChecklists": PatrolChecklists,
    "PatrolMonitoring": PatrolMonitoring,
    "Profile": Profile,
    "QRScanner": QRScanner,
    "ReportScheduling": ReportScheduling,
    "Reports": Reports,
    "Scheduling": Scheduling,
    "ShiftHandover": ShiftHandover,
    "SiteManagement": SiteManagement,
    "StartOfShift": StartOfShift,
    "StayAwakeConfiguration": StayAwakeConfiguration,
    "SystemSetup": SystemSetup,
    "TestDataManager": TestDataManager,
    "UserManagement": UserManagement,
    "PatrolDashboard": PatrolDashboard,
    "GuardPatrol": GuardPatrol,
    "DataHub": DataHub,
    "PatrolAnalytics": PatrolAnalytics,
    "PayrollSummary": PayrollSummary,
    "SiteMapDashboard": SiteMapDashboard,
    "GuardMyShifts": GuardMyShifts,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: __Layout,
};