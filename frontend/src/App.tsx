import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { LoginScreen } from '@/auth/LoginScreen';
import { AppShell } from '@/app/AppShell';
import { FullScreenLoader } from '@/components/ui/FullScreenLoader';
import { RequireRole } from '@/app/RequireRole';
import { OverviewPage } from '@/pages/OverviewPage';
import { ConsumersPage } from '@/pages/ConsumersPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { SavingsPage } from '@/pages/SavingsPage';
import { ForecastPage } from '@/pages/ForecastPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { ModelsPage } from '@/pages/ModelsPage';
import { BudgetsPage } from '@/pages/BudgetsPage';
import { RoutingConfigPage } from '@/pages/RoutingConfigPage';
import { RecommendationsPage } from '@/pages/RecommendationsPage';
import { PitchPage } from '@/pitch/PitchPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function AuthenticatedApp() {
  return (
    <Routes>
      <Route
        path="/pitch"
        element={
          <RequireRole role="admin">
            <PitchPage />
          </RequireRole>
        }
      />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/savings" element={<SavingsPage />} />
        <Route path="/forecast" element={<ForecastPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
        <Route
          path="/consumers"
          element={
            <RequireRole role="admin">
              <ConsumersPage />
            </RequireRole>
          }
        />
        <Route
          path="/budgets"
          element={
            <RequireRole role="admin">
              <BudgetsPage />
            </RequireRole>
          }
        />
        <Route
          path="/models"
          element={
            <RequireRole role="admin">
              <ModelsPage />
            </RequireRole>
          }
        />
        <Route
          path="/routing"
          element={
            <RequireRole role="admin">
              <RoutingConfigPage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}

function Gate() {
  const { status } = useAuth();

  if (status === 'signed_out' || status === 'error') {
    return <LoginScreen />;
  }
  if (status === 'loading') {
    return <FullScreenLoader message="Resolving access…" />;
  }
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthenticatedApp />
    </BrowserRouter>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
