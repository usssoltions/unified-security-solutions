import GuardShift from './pages/GuardShift';
import QRScanner from './pages/QRScanner';
import GuardIncidents from './pages/GuardIncidents';
import GuardMaintenance from './pages/GuardMaintenance';
import ControlRoom from './pages/ControlRoom';
import Scheduling from './pages/Scheduling';
import Analytics from './pages/Analytics';
import AssetManagement from './pages/AssetManagement';
import UserManagement from './pages/UserManagement';
import SiteManagement from './pages/SiteManagement';
import Configuration from './pages/Configuration';
import GuardActivity from './pages/GuardActivity';
import AIReports from './pages/AIReports';
import DailyReport from './pages/DailyReport';
import StayAwakeConfiguration from './pages/StayAwakeConfiguration';
import Layout from './Layout.jsx';


export const PAGES = {
    "GuardShift": GuardShift,
    "QRScanner": QRScanner,
    "GuardIncidents": GuardIncidents,
    "GuardMaintenance": GuardMaintenance,
    "ControlRoom": ControlRoom,
    "Scheduling": Scheduling,
    "Analytics": Analytics,
    "AssetManagement": AssetManagement,
    "UserManagement": UserManagement,
    "SiteManagement": SiteManagement,
    "Configuration": Configuration,
    "GuardActivity": GuardActivity,
    "AIReports": AIReports,
    "DailyReport": DailyReport,
    "StayAwakeConfiguration": StayAwakeConfiguration,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: Layout,
};