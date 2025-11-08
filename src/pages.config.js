import GuardShift from './pages/GuardShift';
import QRScanner from './pages/QRScanner';
import GuardIncidents from './pages/GuardIncidents';
import GuardMaintenance from './pages/GuardMaintenance';
import ControlRoom from './pages/ControlRoom';
import Layout from './Layout.jsx';


export const PAGES = {
    "GuardShift": GuardShift,
    "QRScanner": QRScanner,
    "GuardIncidents": GuardIncidents,
    "GuardMaintenance": GuardMaintenance,
    "ControlRoom": ControlRoom,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: Layout,
};