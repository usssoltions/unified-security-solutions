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
import IncomingCallHandler from '@/components/IncomingCallHandler';
import AndroidDownload from '@/pages/AndroidDownload';
import AccessHistory from '@/pages/AccessHistory';
import AccessSettings from '@/pages/AccessSettings';
import StartOfShiftHistory from './pages/StartOfShiftHistory';
import ResidentLaundry from './pages/ResidentLaundry';
import ResidentIncidents from './pages/ResidentIncidents';
import ResidentMaintenance from './pages/ResidentMaintenance';
import ProtectedPage from '@/components/ProtectedPage';

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
          <LayoutWrapper currentPageName={mainPageKey}>
            <MainPage />
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