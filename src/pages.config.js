import GuardShift from './pages/GuardShift';
import QRScanner from './pages/QRScanner';
import Layout from './Layout.jsx';


export const PAGES = {
    "GuardShift": GuardShift,
    "QRScanner": QRScanner,
}

export const pagesConfig = {
    mainPage: "GuardShift",
    Pages: PAGES,
    Layout: Layout,
};