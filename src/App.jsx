import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import OnboardingFailed from '@/components/OnboardingFailed';
import IncomingCallHandler from '@/components/IncomingCallHandler';
import AndroidDownload from '@/pages/AndroidDownload';
import AccessHistory from '@/pages/AccessHistory';
import AccessSettings from '@/pages/AccessSettings';
import StartOfShiftHistory from './pages/StartOfShiftHistory';
import ResidentLaundry from './pages/ResidentLaundry';
import ResidentIncidents from './pages/ResidentIncidents';
import ResidentMaintenance from './pages/ResidentMaintenance';
import PanicManagement from './pages/PanicManagement';
import MedicalDashboard from './pages/MedicalDashboard';
import MedicalPatients from './pages/MedicalPatients';
import MedicalAppointments from './pages/MedicalAppointments';
import MedicalEmployers from './pages/MedicalEmployers';
import MedicalServices from './pages/MedicalServices';
import MedicalSessions from './pages/MedicalSessions';
import MedicalAssessmentTemplates from './pages/MedicalAssessmentTemplates';
import EstateProperties from './pages/EstateProperties';
import EstateVoting from './pages/EstateVoting';
import ClientDashboard from './pages/ClientDashboard';
import ClientReports from './pages/ClientReports';
import ClientIncidents from './pages/ClientIncidents';
import ResellerPortal from './pages/ResellerPortal';
import EmployerPortal from './pages/EmployerPortal';
import TenantSetup from './pages/TenantSetup';
import ResellerManagement from './pages/ResellerManagement';
import CustomerManagement from './pages/CustomerManagement';
import ProtectedPage from '@/components/ProtectedPage';
import RoleHomeRedirect from '@/components/RoleHomeRedirect';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'onboarding_failed') {
      // Fail-closed: a non-platform user whose tenant scope could not be
      // resolved. No unscoped app access, no platform/customer fallback.
      return <OnboardingFailed message={authError.message} />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app — IncomingCallHandler is OUTSIDE Routes so it
  // persists across all page navigations and stays active until logout.
  return (
    <>
      {user && <IncomingCallHandler user={user} />}
      <Routes>
        <Route path="/" element={
          <LayoutWrapper currentPageName="RoleHomeRedirect">
            <RoleHomeRedirect />
          </LayoutWrapper>
        } />
        {Object.entries(Pages).map(([path, Page]) => (
          <Route
            key={path}
            path={`/${path}`}
            element={
              <LayoutWrapper currentPageName={path}>
                <ProtectedPage pageKey={path}>
                  <Page />
                </ProtectedPage>
              </LayoutWrapper>
            }
          />
        ))}
        <Route path="/AndroidDownload" element={
          <LayoutWrapper currentPageName="AndroidDownload">
            <ProtectedPage pageKey="AndroidDownload">
              <AndroidDownload />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/AccessHistory" element={
          <LayoutWrapper currentPageName="AccessHistory">
            <ProtectedPage pageKey="AccessHistory">
              <AccessHistory />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/AccessSettings" element={
          <LayoutWrapper currentPageName="AccessSettings">
            <ProtectedPage pageKey="AccessSettings">
              <AccessSettings />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/StartOfShiftHistory" element={
          <LayoutWrapper currentPageName="StartOfShiftHistory">
            <ProtectedPage pageKey="StartOfShiftHistory">
              <StartOfShiftHistory />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ResidentLaundry" element={
          <LayoutWrapper currentPageName="ResidentLaundry">
            <ProtectedPage pageKey="ResidentLaundry">
              <ResidentLaundry />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ResidentIncidents" element={
          <LayoutWrapper currentPageName="ResidentIncidents">
            <ProtectedPage pageKey="ResidentIncidents">
              <ResidentIncidents />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ResidentMaintenance" element={
          <LayoutWrapper currentPageName="ResidentMaintenance">
            <ProtectedPage pageKey="ResidentMaintenance">
              <ResidentMaintenance />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/PanicManagement" element={
          <LayoutWrapper currentPageName="PanicManagement">
            <ProtectedPage pageKey="PanicManagement">
              <PanicManagement />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalDashboard" element={
          <LayoutWrapper currentPageName="MedicalDashboard">
            <ProtectedPage pageKey="MedicalDashboard">
              <MedicalDashboard />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalPatients" element={
          <LayoutWrapper currentPageName="MedicalPatients">
            <ProtectedPage pageKey="MedicalPatients">
              <MedicalPatients />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalAppointments" element={
          <LayoutWrapper currentPageName="MedicalAppointments">
            <ProtectedPage pageKey="MedicalAppointments">
              <MedicalAppointments />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalEmployers" element={
          <LayoutWrapper currentPageName="MedicalEmployers">
            <ProtectedPage pageKey="MedicalEmployers">
              <MedicalEmployers />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalServices" element={
          <LayoutWrapper currentPageName="MedicalServices">
            <ProtectedPage pageKey="MedicalServices">
              <MedicalServices />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalSessions" element={
          <LayoutWrapper currentPageName="MedicalSessions">
            <ProtectedPage pageKey="MedicalSessions">
              <MedicalSessions />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/MedicalAssessmentTemplates" element={
          <LayoutWrapper currentPageName="MedicalAssessmentTemplates">
            <ProtectedPage pageKey="MedicalAssessmentTemplates">
              <MedicalAssessmentTemplates />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/EstateProperties" element={
          <LayoutWrapper currentPageName="EstateProperties">
            <ProtectedPage pageKey="EstateProperties">
              <EstateProperties />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/EstateVoting" element={
          <LayoutWrapper currentPageName="EstateVoting">
            <ProtectedPage pageKey="EstateVoting">
              <EstateVoting />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ClientDashboard" element={
          <LayoutWrapper currentPageName="ClientDashboard">
            <ProtectedPage pageKey="ClientDashboard">
              <ClientDashboard />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ClientReports" element={
          <LayoutWrapper currentPageName="ClientReports">
            <ProtectedPage pageKey="ClientReports">
              <ClientReports />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ClientIncidents" element={
          <LayoutWrapper currentPageName="ClientIncidents">
            <ProtectedPage pageKey="ClientIncidents">
              <ClientIncidents />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ResellerPortal" element={
          <LayoutWrapper currentPageName="ResellerPortal">
            <ProtectedPage pageKey="ResellerPortal">
              <ResellerPortal />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/EmployerPortal" element={
          <LayoutWrapper currentPageName="EmployerPortal">
            <ProtectedPage pageKey="EmployerPortal">
              <EmployerPortal />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/TenantSetup" element={
          <LayoutWrapper currentPageName="TenantSetup">
            <ProtectedPage pageKey="TenantSetup">
              <TenantSetup />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/ResellerManagement" element={
          <LayoutWrapper currentPageName="ResellerManagement">
            <ProtectedPage pageKey="ResellerManagement">
              <ResellerManagement />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="/CustomerManagement" element={
          <LayoutWrapper currentPageName="CustomerManagement">
            <ProtectedPage pageKey="CustomerManagement">
              <CustomerManagement />
            </ProtectedPage>
          </LayoutWrapper>
        } />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App