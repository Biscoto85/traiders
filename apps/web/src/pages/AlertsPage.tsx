import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api, type AlertData } from "@/lib/api";

const METRIC_LABELS: Record<string, string> = {
  lastPrice: "Prix",
  marketCap: "Capitalisation",
  peRatio: "P/E Ratio",
  forwardPe: "Forward P/E",
  pegRatio: "PEG Ratio",
  pbRatio: "P/B Ratio",
  psRatio: "P/S Ratio",
  evToEbitda: "EV/EBITDA",
  evToRevenue: "EV/Revenue",
  dividendYield: "Rendement div.",
  revenueGrowth: "Croissance CA",
  earningsGrowth: "Croissance benefice",
  grossMargin: "Marge brute",
  operatingMargin: "Marge operationnelle",
  netMargin: "Marge nette",
  roe: "ROE",
  roa: "ROA",
  debtToEquity: "Debt/Equity",
  currentRatio: "Current Ratio",
  fcfYield: "FCF Yield",
  beta: "Beta",
  qualityScore: "Score Qualite",
};

const PCT_METRICS = [
  "dividendYield", "revenueGrowth", "earningsGrowth",
  "grossMargin", "operatingMargin", "netMargin", "roe", "roa", "fcfYield",
];

function formatThreshold(metric: string, value: number): string {
  if (PCT_METRICS.includes(metric)) return `${(value * 100).toFixed(2)}%`;
  if (metric === "marketCap") {
    if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  }
  if (metric === "qualityScore") return String(Math.round(value));
  return value.toFixed(2);
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.alerts()
      .then((res) => setAlerts(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur"))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(id: string) {
    try {
      const res = await api.toggleAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch (err) {
      console.error("Toggle error:", err);
    }
  }

  async function handleRearm(id: string) {
    try {
      const res = await api.rearmAlert(id);
      setAlerts((prev) => prev.map((a) => (a.id === id ? res.data : a)));
    } catch (err) {
      console.error("Rearm error:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer cette alerte ?")) return;
    try {
      await api.deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Delete error:", err);
    }
  }

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;

  const active = alerts.filter((a) => a.isActive && !a.isTriggered);
  const triggered = alerts.filter((a) => a.isTriggered);
  const paused = alerts.filter((a) => !a.isActive && !a.isTriggered);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2>Alertes de prix</h2>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {alerts.length} / 50 alertes
        </span>
      </div>

      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "1.5rem" }}>
        Creez des alertes depuis la page detail d'une action. Vous serez notifie par email lorsqu'une condition est remplie.
      </p>

      {alerts.length === 0 && (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
          Aucune alerte. Allez sur la page d'une action et cliquez sur le bouton cloche pour en creer une.
        </div>
      )}

      {/* Active alerts */}
      {active.length > 0 && (
        <>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Actives ({active.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
            {active.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onToggle={() => handleToggle(alert.id)}
                onDelete={() => handleDelete(alert.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Triggered alerts */}
      {triggered.length > 0 && (
        <>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--warning)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Declenchees ({triggered.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
            {triggered.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onRearm={() => handleRearm(alert.id)}
                onDelete={() => handleDelete(alert.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Paused alerts */}
      {paused.length > 0 && (
        <>
          <div style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            En pause ({paused.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
            {paused.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onToggle={() => handleToggle(alert.id)}
                onDelete={() => handleDelete(alert.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onToggle,
  onRearm,
  onDelete,
}: {
  alert: AlertData;
  onToggle?: () => void;
  onRearm?: () => void;
  onDelete: () => void;
}) {
  const metricLabel = METRIC_LABELS[alert.metric] ?? alert.metric;
  const op = alert.operator === "above" ? "≥" : "≤";
  const thresholdStr = formatThreshold(alert.metric, alert.threshold);

  return (
    <div
      className="card"
      style={{
        padding: "0.75rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        opacity: !alert.isActive && !alert.isTriggered ? 0.6 : 1,
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          flexShrink: 0,
          backgroundColor: alert.isTriggered
            ? "var(--warning)"
            : alert.isActive
              ? "var(--success)"
              : "var(--text-muted)",
        }}
      />

      {/* Stock info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <Link
            to={`/stock/${alert.stock.ticker}?exchange=${alert.stock.exchangeId}`}
            style={{ fontWeight: 600, color: "var(--primary)", textDecoration: "none", fontSize: "0.9rem" }}
          >
            {alert.stock.ticker}.{alert.stock.exchangeId}
          </Link>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            {alert.stock.name}
          </span>
        </div>
        <div style={{ fontSize: "0.8rem", marginTop: "0.125rem" }}>
          <span style={{ fontWeight: 500 }}>{metricLabel}</span>{" "}
          <span style={{ color: "var(--text-muted)" }}>{op}</span>{" "}
          <span style={{ fontWeight: 600 }}>{thresholdStr}</span>
          {alert.isTriggered && alert.lastTriggeredAt && (
            <span style={{ marginLeft: "0.75rem", fontSize: "0.7rem", color: "var(--warning)" }}>
              Declenchee le {new Date(alert.lastTriggeredAt).toLocaleDateString("fr-FR")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
        {alert.isTriggered && onRearm && (
          <button
            className="btn btn-ghost"
            onClick={onRearm}
            title="Reactiver l'alerte"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >
            Reactiver
          </button>
        )}
        {!alert.isTriggered && onToggle && (
          <button
            className="btn btn-ghost"
            onClick={onToggle}
            title={alert.isActive ? "Mettre en pause" : "Activer"}
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
          >
            {alert.isActive ? "Pause" : "Activer"}
          </button>
        )}
        <button
          className="btn btn-ghost"
          onClick={onDelete}
          title="Supprimer"
          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "var(--danger)" }}
        >
          Suppr.
        </button>
      </div>
    </div>
  );
}
