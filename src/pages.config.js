/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AccessControl from './pages/AccessControl';
import EstateLevy from './pages/EstateLevy';
import EstateManagerDashboard from './pages/EstateManagerDashboard';
import EstateResidents from './pages/EstateResidents';
import EstateVendors from './pages/EstateVendors';
import EstateVenues from './pages/EstateVenues';
import ResidentAnnouncements from './pages/ResidentAnnouncements';
import ResidentBookings from './pages/ResidentBookings';
import ResidentDashboard from './pages/ResidentDashboard';
import ResidentOrders from './pages/ResidentOrders';
import ResidentPayments from './pages/ResidentPayments';
import ResidentTickets from './pages/ResidentTickets';
import ResidentVisitors from './pages/ResidentVisitors';
import VendorPortal from './pages/VendorPortal';
import AIReports from './pages/AIReports';
import AdminIncidents from './pages/AdminIncidents';
import AdminMaintenance from './pages/AdminMaintenance';
import Analytics from './pages/Analytics';
import AssetManagement from './pages/AssetManagement';
import CallHistory from './pages/CallHistory';
import CallRecordings from './pages/CallRecordings';
import ClockInOutReports from './pages/ClockInOutReports';
import CompletedPatrols from './pages/CompletedPatrols';
import Configuration from './pages/Configuration';
import Contacts from './pages/Contacts';
import ControlRoom from './pages/ControlRoom';
import DailyReport from './pages/DailyReport';
import GuardActivity from './pages/GuardActivity';
import GuardIncidents from './pages/GuardIncidents';
import GuardMaintenance from './pages/GuardMaintenance';
import GuardPatrolChecklist from './pages/GuardPatrolChecklist';
import GuardPerformanceAnalytics from './pages/GuardPerformanceAnalytics';
import GuardShift from './pages/GuardShift';
import Home from './pages/Home';
import NotificationPreferences from './pages/NotificationPreferences';
import OneSignalTest from './pages/OneSignalTest';
import PTT from './pages/PTT';
import PTTRecordings from './pages/PTTRecordings';
import PatrolChecklists from './pages/PatrolChecklists';
import PatrolMonitoring from './pages/PatrolMonitoring';
import Profile from './pages/Profile';
import QRScanner from './pages/QRScanner';
import ReportScheduling from './pages/ReportScheduling';
import Reports from './pages/Reports';
import Scheduling from './pages/Scheduling';
import ShiftHandover from './pages/ShiftHandover';
import SiteManagement from './pages/SiteManagement';
import StartOfShift from './pages/StartOfShift';
import StayAwakeConfiguration from './pages/StayAwakeConfiguration';
import SystemSetup from './pages/SystemSetup';
import TestDataManager from './pages/TestDataManager';
import UserManagement from './pages/UserManagement';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AccessControl": AccessControl,
    "EstateLevy": EstateLevy,
    "EstateManagerDashboard": EstateManagerDashboard,
    "EstateResidents": EstateResidents,
    "EstateVendors": EstateVendors,
    "EstateVenues": EstateVenues,
    "ResidentAnnouncements": ResidentAnnouncements,
    "ResidentBookings": ResidentBookings,
    "ResidentDashboard": ResidentDashboard,
    "ResidentOrders": ResidentOrders,
    "ResidentPayments": ResidentPayments,
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
    "PTT": PTT,
    "PTTRecordings": PTTRecordings,
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
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: __Layout,
};