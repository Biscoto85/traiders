import { BrowserRouter, Routes, Route, Navigate, Outlet, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ScreenerPage from "@/pages/ScreenerPage";
import StockDetailPage from "@/pages/StockDetailPage";
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
        <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1>Traiders</h1>
        </Link>
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
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
