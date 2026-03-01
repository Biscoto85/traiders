import { BrowserRouter, Routes, Route, Navigate, Outlet, NavLink } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ScreenerPage from "@/pages/ScreenerPage";
import StockDetailPage from "@/pages/StockDetailPage";
import PresetsPage from "@/pages/PresetsPage";
import EmailDigestsPage from "@/pages/EmailDigestsPage";
import AdminPage from "@/pages/AdminPage";
import type { ReactNode } from "react";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="loading">Chargement...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-layout">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <NavLink to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>Traiders</h1>
          </NavLink>
          {user && (
            <nav className="app-nav">
              <NavLink to="/" end className={({ isActive }) => `nav-link ${isActive ? "nav-active" : ""}`}>
                Screener
              </NavLink>
              <NavLink to="/presets" className={({ isActive }) => `nav-link ${isActive ? "nav-active" : ""}`}>
                Presets
              </NavLink>
              <NavLink to="/email-digests" className={({ isActive }) => `nav-link ${isActive ? "nav-active" : ""}`}>
                Alertes
              </NavLink>
              {user.role === "super_admin" && (
                <NavLink to="/admin" className={({ isActive }) => `nav-link ${isActive ? "nav-active" : ""}`}>
                  Admin
                </NavLink>
              )}
            </nav>
          )}
        </div>
        {user && (
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {user.name}
              {user.role === "super_admin" && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--primary)" }}>ADMIN</span>
              )}
            </span>
            <button className="btn btn-ghost" onClick={logout}>
              Deconnexion
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<ScreenerPage />} />
            <Route path="/stock/:ticker" element={<StockDetailPage />} />
            <Route path="/presets" element={<PresetsPage />} />
            <Route path="/email-digests" element={<EmailDigestsPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
