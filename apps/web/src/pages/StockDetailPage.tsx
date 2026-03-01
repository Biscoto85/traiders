import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type StockDetail } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const [stock, setStock] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    api
      .stock(ticker)
      .then((res) => setStock(res.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Error loading stock"))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;
  if (!stock) return <div className="loading">Action non trouvee</div>;

  const metrics = [
    { label: "Market Cap", value: formatMarketCap(stock.marketCap) },
    { label: "P/E Ratio", value: formatRatio(stock.peRatio) },
    { label: "Forward P/E", value: formatRatio(stock.forwardPe) },
    { label: "PEG Ratio", value: formatRatio(stock.pegRatio) },
    { label: "P/B Ratio", value: formatRatio(stock.pbRatio) },
    { label: "EV/EBITDA", value: formatRatio(stock.evToEbitda) },
    { label: "Prix", value: stock.lastPrice?.toFixed(2) ?? "—" },
    { label: "52w High", value: stock.week52High?.toFixed(2) ?? "—" },
    { label: "52w Low", value: stock.week52Low?.toFixed(2) ?? "—" },
    { label: "ROE", value: formatPercent(stock.roe) },
    { label: "Marge brute", value: formatPercent(stock.grossMargin) },
    { label: "Marge op.", value: formatPercent(stock.operatingMargin) },
    { label: "Marge nette", value: formatPercent(stock.netMargin) },
    { label: "Div. Yield", value: formatPercent(stock.dividendYield) },
    { label: "Beta", value: formatRatio(stock.beta) },
    { label: "Debt/Equity", value: formatRatio(stock.debtToEquity) },
    { label: "EPS", value: formatRatio(stock.eps) },
  ];

  return (
    <div>
      <Link to="/" style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
        ← Retour au screener
      </Link>
      <div style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
        <h2>
          {stock.ticker}.{stock.exchangeId}
          <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.75rem" }}>
            {stock.name}
          </span>
        </h2>
        <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
          {stock.sector ?? "—"} · {stock.industry ?? "—"} · {stock.currency}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {metrics.map((m) => (
          <div key={m.label} className="card" style={{ padding: "0.75rem 1rem" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>
              {m.label}
            </div>
            <div style={{ fontSize: "1.125rem", fontWeight: 600 }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: "1.5rem", textAlign: "center", color: "var(--text-muted)" }}>
        <p>Graphique de prix et historique des fondamentaux — a venir</p>
      </div>
    </div>
  );
}
