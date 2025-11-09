import GuardShift from './pages/GuardShift';
import QRScanner from './pages/QRScanner';
import GuardIncidents from './pages/GuardIncidents';
import GuardMaintenance from './pages/GuardMaintenance';
import ControlRoom from './pages/ControlRoom';
import Scheduling from './pages/Scheduling';
import Analytics from './pages/Analytics';
import AssetManagement from './pages/AssetManagement';
import SystemSetup from './pages/SystemSetup';
import UserManagement from './pages/UserManagement';
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
    "SystemSetup": SystemSetup,
    "UserManagement": UserManagement,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: Layout,
};