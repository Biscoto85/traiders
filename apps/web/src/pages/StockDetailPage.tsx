import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, type StockDetail, type PriceBar, type FundamentalPeriod } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

function compactNumber(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function pctColor(v: number | null): string {
  if (v == null) return "";
  return v >= 0 ? "text-success" : "text-danger";
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const [searchParams] = useSearchParams();
  const exchange = searchParams.get("exchange") ?? undefined;

  const [stock, setStock] = useState<StockDetail | null>(null);
  const [prices, setPrices] = useState<PriceBar[]>([]);
  const [fundamentals, setFundamentals] = useState<FundamentalPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [togglingBookmark, setTogglingBookmark] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError("");

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().split("T")[0];

    Promise.all([
      api.stock(ticker, exchange),
      api.prices(ticker, { from: fromDate, exchange }),
      api.fundamentals(ticker, { type: "quarterly", limit: 8, exchange }),
      api.bookmarkIds(),
    ])
      .then(([stockRes, pricesRes, fundRes, bmRes]) => {
        setStock(stockRes.data);
        setPrices(pricesRes.data);
        setFundamentals(fundRes.data);
        setIsBookmarked(bmRes.data.includes(stockRes.data.id));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur de chargement"))
      .finally(() => setLoading(false));
  }, [ticker, exchange]);

  if (loading) return <div className="loading">Chargement...</div>;
  if (error) return <div className="auth-error">{error}</div>;
  if (!stock) return <div className="loading">Action non trouvee</div>;

  async function handleToggleBookmark() {
    if (!stock) return;
    setTogglingBookmark(true);
    try {
      if (isBookmarked) {
        await api.removeBookmark(stock.id);
        setIsBookmarked(false);
      } else {
        await api.addBookmark(stock.id);
        setIsBookmarked(true);
      }
    } catch (err) {
      console.error("Bookmark error:", err);
    } finally {
      setTogglingBookmark(false);
    }
  }

  // Price sparkline (simple ASCII-like bar using CSS)
  const priceMin = prices.length ? Math.min(...prices.map((p) => p.low)) : 0;
  const priceMax = prices.length ? Math.max(...prices.map((p) => p.high)) : 1;
  const priceRange = priceMax - priceMin || 1;

  // Price change 1Y
  const firstPrice = prices[0]?.adjClose ?? null;
  const lastPrice = stock.lastPrice;
  const priceChange1Y =
    firstPrice != null && lastPrice != null && firstPrice !== 0
      ? (lastPrice - firstPrice) / firstPrice
      : null;

  // Target upside
  const targetUpside =
    stock.targetPrice != null && lastPrice != null && lastPrice !== 0
      ? (stock.targetPrice - lastPrice) / lastPrice
      : null;

  // ── Metric sections ──
  const valuationMetrics = [
    { label: "P/E", value: formatRatio(stock.peRatio) },
    { label: "Forward P/E", value: formatRatio(stock.forwardPe) },
    { label: "PEG", value: formatRatio(stock.pegRatio) },
    { label: "P/B", value: formatRatio(stock.pbRatio) },
    { label: "P/S", value: formatRatio(stock.psRatio) },
    { label: "EV/EBITDA", value: formatRatio(stock.evToEbitda) },
    { label: "EV/Revenue", value: formatRatio(stock.evToRevenue) },
  ];

  const profitabilityMetrics = [
    { label: "Marge brute", value: formatPercent(stock.grossMargin) },
    { label: "Marge op.", value: formatPercent(stock.operatingMargin) },
    { label: "Marge nette", value: formatPercent(stock.netMargin) },
    { label: "ROE", value: formatPercent(stock.roe), className: pctColor(stock.roe) },
    { label: "ROA", value: formatPercent(stock.roa), className: pctColor(stock.roa) },
    { label: "FCF Yield", value: formatPercent(stock.fcfYield), className: pctColor(stock.fcfYield) },
  ];

  const growthMetrics = [
    { label: "Rev. Growth YoY", value: formatPercent(stock.revenueGrowth), className: pctColor(stock.revenueGrowth) },
    { label: "Earnings Growth", value: formatPercent(stock.earningsGrowth), className: pctColor(stock.earningsGrowth) },
    { label: "Prix 1 an", value: formatPercent(priceChange1Y), className: pctColor(priceChange1Y) },
  ];

  const riskMetrics = [
    { label: "Beta", value: formatRatio(stock.beta) },
    { label: "Debt/Equity", value: formatRatio(stock.debtToEquity) },
    { label: "Current Ratio", value: formatRatio(stock.currentRatio) },
    { label: "Short % Float", value: formatPercent(stock.shortPctFloat) },
  ];

  const analystMetrics = [
    { label: "Target Price", value: stock.targetPrice?.toFixed(2) ?? "—" },
    { label: "Upside cible", value: formatPercent(targetUpside), className: pctColor(targetUpside) },
    { label: "% Insiders", value: formatPercent(stock.pctInsiders != null ? stock.pctInsiders / 100 : null) },
    { label: "% Institutions", value: formatPercent(stock.pctInstitutions != null ? stock.pctInstitutions / 100 : null) },
  ];

  return (
    <div>
      <Link to="/" style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
        &larr; Retour au screener
      </Link>

      {/* Header */}
      <div style={{ marginTop: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className={`bookmark-btn ${isBookmarked ? "bookmark-active" : ""}`}
              onClick={handleToggleBookmark}
              disabled={togglingBookmark}
              title={isBookmarked ? "Retirer des favoris" : "Ajouter aux favoris"}
              style={{ fontSize: "1.5rem" }}
            >
              {isBookmarked ? "\u2605" : "\u2606"}
            </button>
            {stock.ticker}.{stock.exchangeId}
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.75rem", fontSize: "1rem" }}>
              {stock.name}
            </span>
          </h2>
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
            {stock.sector ?? "—"} &middot; {stock.industry ?? "—"} &middot; {stock.currency}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>
            {lastPrice?.toFixed(2) ?? "—"} <span style={{ fontSize: "0.875rem", fontWeight: 400 }}>{stock.currency}</span>
          </div>
          <div style={{ fontSize: "0.875rem" }}>
            <span>Mkt Cap: {formatMarketCap(stock.marketCap)}</span>
            <span style={{ margin: "0 0.5rem" }}>&middot;</span>
            <span>EV: {formatMarketCap(stock.enterpriseValue)}</span>
          </div>
        </div>
      </div>

      {/* Price mini-chart (CSS bars) */}
      {prices.length > 0 && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Prix 1 an
            {priceChange1Y != null && (
              <span className={pctColor(priceChange1Y)} style={{ marginLeft: "0.75rem" }}>
                {formatPercent(priceChange1Y)}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", height: 100, gap: 1 }}>
            {prices.map((p, i) => {
              const h = ((p.adjClose - priceMin) / priceRange) * 80 + 10;
              const isUp = i > 0 ? p.adjClose >= prices[i - 1]!.adjClose : true;
              return (
                <div
                  key={p.date}
                  title={`${p.date}: ${p.adjClose.toFixed(2)}`}
                  style={{
                    flex: 1,
                    height: `${h}%`,
                    backgroundColor: isUp ? "var(--success)" : "var(--danger)",
                    opacity: 0.7,
                    borderRadius: "1px",
                    minWidth: 1,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            <span>{prices[0]?.date}</span>
            <span>{prices[prices.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* Metric sections */}
      <MetricSection title="Valorisation" metrics={valuationMetrics} />
      <MetricSection title="Rentabilite" metrics={profitabilityMetrics} />
      <MetricSection title="Croissance" metrics={growthMetrics} />
      <MetricSection title="Risque & Levier" metrics={riskMetrics} />
      <MetricSection title="Analyste & Actionnariat" metrics={analystMetrics} />

      {/* 52-week position visual */}
      <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Position 52 semaines
        </div>
        {stock.week52Low != null && stock.week52High != null && lastPrice != null && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              <span>{stock.week52Low.toFixed(2)}</span>
              <span>{stock.week52High.toFixed(2)}</span>
            </div>
            <div style={{ position: "relative", height: 8, background: "var(--bg-input)", borderRadius: 4, margin: "0.5rem 0" }}>
              <div
                style={{
                  position: "absolute",
                  left: `${Math.max(0, Math.min(100, ((lastPrice - stock.week52Low) / (stock.week52High - stock.week52Low)) * 100))}%`,
                  top: -4,
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  backgroundColor: "var(--primary)",
                  transform: "translateX(-50%)",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
              <span className="text-danger">{formatPercent(stock.pctFrom52WeekLow)} du bas</span>
              <span className="text-danger">{formatPercent(stock.pctFrom52WeekHigh)} du haut</span>
            </div>
          </div>
        )}
      </div>

      {/* Quarterly fundamentals table */}
      {fundamentals.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "auto", marginBottom: "1.5rem" }}>
          <div style={{ padding: "1rem 1rem 0.5rem", fontSize: "0.875rem", fontWeight: 600 }}>
            Fondamentaux trimestriels
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Periode</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Brut</th>
                <th className="text-right">Op. Income</th>
                <th className="text-right">Net Income</th>
                <th className="text-right">EBITDA</th>
                <th className="text-right">FCF</th>
                <th className="text-right">Actifs</th>
                <th className="text-right">Dette</th>
                <th className="text-right">Equity</th>
                <th className="text-right">Cash</th>
              </tr>
            </thead>
            <tbody>
              {fundamentals.map((f) => (
                <tr key={f.id}>
                  <td>{f.period}</td>
                  <td className="text-right">{compactNumber(f.revenue)}</td>
                  <td className="text-right">{compactNumber(f.grossProfit)}</td>
                  <td className="text-right">{compactNumber(f.operatingIncome)}</td>
                  <td className={`text-right ${pctColor(f.netIncome)}`}>{compactNumber(f.netIncome)}</td>
                  <td className="text-right">{compactNumber(f.ebitda)}</td>
                  <td className={`text-right ${pctColor(f.freeCashFlow)}`}>{compactNumber(f.freeCashFlow)}</td>
                  <td className="text-right">{compactNumber(f.totalAssets)}</td>
                  <td className="text-right">{compactNumber(f.totalDebt)}</td>
                  <td className="text-right">{compactNumber(f.totalEquity)}</td>
                  <td className="text-right">{compactNumber(f.cashAndEquiv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricSection({ title, metrics }: { title: string; metrics: Array<{ label: string; value: string; className?: string }> }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem", color: "var(--text-muted)" }}>
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
        {metrics.map((m) => (
          <div key={m.label} className="card" style={{ padding: "0.5rem 0.75rem" }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{m.label}</div>
            <div className={m.className} style={{ fontSize: "1rem", fontWeight: 600 }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
