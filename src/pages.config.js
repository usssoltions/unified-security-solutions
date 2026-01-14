import AIReports from './pages/AIReports';
import AdminIncidents from './pages/AdminIncidents';
import AdminMaintenance from './pages/AdminMaintenance';
import Analytics from './pages/Analytics';
import AssetManagement from './pages/AssetManagement';
import ClockInOutReports from './pages/ClockInOutReports';
import CompletedPatrols from './pages/CompletedPatrols';
import Configuration from './pages/Configuration';
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
import PatrolChecklists from './pages/PatrolChecklists';
import QRScanner from './pages/QRScanner';
import Reports from './pages/Reports';
import Scheduling from './pages/Scheduling';
import SiteManagement from './pages/SiteManagement';
import StartOfShift from './pages/StartOfShift';
import StayAwakeConfiguration from './pages/StayAwakeConfiguration';
import SystemSetup from './pages/SystemSetup';
import UserManagement from './pages/UserManagement';
import PTT from './pages/PTT';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AIReports": AIReports,
    "AdminIncidents": AdminIncidents,
    "AdminMaintenance": AdminMaintenance,
    "Analytics": Analytics,
    "AssetManagement": AssetManagement,
    "ClockInOutReports": ClockInOutReports,
    "CompletedPatrols": CompletedPatrols,
    "Configuration": Configuration,
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
    "PatrolChecklists": PatrolChecklists,
    "QRScanner": QRScanner,
    "Reports": Reports,
    "Scheduling": Scheduling,
    "SiteManagement": SiteManagement,
    "StartOfShift": StartOfShift,
    "StayAwakeConfiguration": StayAwakeConfiguration,
    "SystemSetup": SystemSetup,
    "UserManagement": UserManagement,
    "PTT": PTT,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: __Layout,
};