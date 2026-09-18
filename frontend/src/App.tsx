import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import Layout from "./components/Layout";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import SpacePage from "./pages/SpacePage";
import ProjectPage from "./pages/ProjectPage";
import TutorPage from "./pages/TutorPage";
import QuizPage from "./pages/QuizPage";
import GrowthPage from "./pages/GrowthPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import GlobalAnalyticsPage from "./pages/GlobalAnalyticsPage";
import AdminPage from "./pages/AdminPage";
import FlashcardsPage from "./pages/FlashcardsPage";
import ConceptMapPage from "./pages/ConceptMapPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomePage />} />
          <Route path="/analytics" element={<GlobalAnalyticsPage />} />
          <Route path="/spaces/:spaceId" element={<SpacePage />} />
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/tutor" element={<TutorPage />} />
          <Route path="/projects/:projectId/quiz" element={<QuizPage />} />
          <Route path="/projects/:projectId/growth" element={<GrowthPage />} />
          <Route path="/projects/:projectId/analytics" element={<AnalyticsPage />} />
          <Route path="/projects/:projectId/flashcards" element={<FlashcardsPage />} />
          <Route path="/projects/:projectId/concept-map" element={<ConceptMapPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
