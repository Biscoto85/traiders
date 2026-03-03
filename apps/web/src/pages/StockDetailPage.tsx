import { useState, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api, type StockDetail, type PriceBar, type FundamentalPeriod } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

function compactNumber(n: number | null): string {
  if (n == null) return "\u2014";
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

// ── Score sub-category computation (mirrors worker/scoring.ts) ──

function scoreUp(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  const [t3, t6, t8, t10] = thresholds;
  if (value >= t10) return 10;
  if (value >= t8) return 8;
  if (value >= t6) return 6;
  if (value >= t3) return 3;
  return 0;
}

function scoreDown(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  const [t10, t8, t6, t3] = thresholds;
  if (value <= t10) return 10;
  if (value <= t8) return 8;
  if (value <= t6) return 6;
  if (value <= t3) return 3;
  return 0;
}

function scorePeRatio(pe: number | null | undefined): number | null {
  if (pe == null || isNaN(pe)) return null;
  if (pe <= 0) return 0;
  if (pe <= 10) return 10;
  if (pe <= 15) return 8;
  if (pe <= 20) return 6;
  if (pe <= 30) return 3;
  return 0;
}

interface SubScores {
  rentabilite: number | null;
  croissance: number | null;
  sante: number | null;
  valorisation: number | null;
  cashFlow: number | null;
}

function computeSubScores(stock: StockDetail): SubScores {
  const avg = (a: number | null, b: number | null): number | null => {
    if (a != null && b != null) return (a + b) / 2 * 2;
    if (a != null) return a * 2;
    if (b != null) return b * 2;
    return null;
  };

  const roe = scoreUp(stock.roe, [0.05, 0.10, 0.15, 0.20]);
  const margin = scoreUp(stock.netMargin, [0.05, 0.10, 0.15, 0.20]);
  const rentabilite = avg(roe, margin);

  const revGrowth = scoreUp(stock.revenueGrowth, [0.05, 0.10, 0.15, 0.25]);
  const earnGrowth = scoreUp(stock.earningsGrowth, [0.03, 0.08, 0.12, 0.20]);
  const croissance = avg(revGrowth, earnGrowth);

  const debtEq = scoreDown(stock.debtToEquity, [0.3, 0.5, 1.0, 2.0]);
  const curRatio = scoreUp(stock.currentRatio, [1.0, 1.2, 1.5, 2.0]);
  const sante = avg(debtEq, curRatio);

  const pe = scorePeRatio(stock.peRatio);
  const fcfY = scoreUp(stock.fcfYield, [0.01, 0.03, 0.05, 0.08]);
  const valorisation = avg(pe, fcfY);

  const pOcf = scoreDown(stock.priceToOCF, [8, 12, 18, 25]);
  let ndOcf = scoreDown(stock.netDebtToOCF, [1, 2, 3, 5]);
  if (stock.netDebtToOCF != null && stock.netDebtToOCF < 0) ndOcf = 10;
  const cashFlow = avg(pOcf, ndOcf);

  return { rentabilite, croissance, sante, valorisation, cashFlow };
}

// ── Radar Chart (SVG) ──

function RadarChart({ scores }: { scores: SubScores }) {
  const labels = ["Rentabilite", "Croissance", "Sante fin.", "Valorisation", "Cash Flow"];
  const values = [scores.rentabilite, scores.croissance, scores.sante, scores.valorisation, scores.cashFlow];

  const cx = 120, cy = 120, maxR = 90;
  const n = 5;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  // Pentagon vertices at each level (0, 5, 10, 15, 20)
  const levels = [5, 10, 15, 20];

  function getPoint(i: number, val: number): [number, number] {
    const angle = startAngle + i * angleStep;
    const r = (val / 20) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  const gridPaths = levels.map((level) => {
    const pts = Array.from({ length: n }, (_, i) => getPoint(i, level));
    return pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  });

  const dataPoints = values.map((v, i) => getPoint(i, v ?? 0));
  const dataPath = dataPoints.map((p) => `${p[0]},${p[1]}`).join(" ");

  const labelPositions = Array.from({ length: n }, (_, i) => {
    const angle = startAngle + i * angleStep;
    const r = maxR + 20;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });

  return (
    <svg viewBox="0 0 240 240" style={{ width: "100%", maxWidth: 260 }}>
      {/* Grid */}
      {gridPaths.map((path, i) => (
        <polygon key={i} points={path} fill="none" stroke="var(--bg-input)" strokeWidth="1" />
      ))}
      {/* Axes */}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = getPoint(i, 20);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--bg-input)" strokeWidth="1" />;
      })}
      {/* Data polygon */}
      <polygon points={dataPath} fill="var(--primary)" fillOpacity="0.25" stroke="var(--primary)" strokeWidth="2" />
      {/* Data points */}
      {dataPoints.map(([x, y], i) => (
        values[i] != null && <circle key={i} cx={x} cy={y} r="3.5" fill="var(--primary)" />
      ))}
      {/* Labels */}
      {labelPositions.map(([x, y], i) => (
        <text
          key={i}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="10"
          fill="var(--text-muted)"
        >
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

// ── Score Badge ──

function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 45) return "var(--warning)";
  return "var(--danger)";
}

function scoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 70) return "Tres bon";
  if (score >= 55) return "Bon";
  if (score >= 45) return "Moyen";
  if (score >= 30) return "Faible";
  return "Risque";
}

// ── Fundamental Bar Chart (CSS-based) ──

function FundamentalChart({ data, title }: { data: FundamentalPeriod[]; title: string }) {
  if (data.length < 2) return null;

  // Show revenue and net income side by side
  const reversed = [...data].reverse(); // Oldest first
  const allVals = reversed.flatMap((f) => [f.revenue, f.netIncome, f.freeCashFlow].filter((v) => v != null) as number[]);
  if (allVals.length === 0) return null;

  const maxVal = Math.max(...allVals.map(Math.abs));

  return (
    <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>{title}</div>
      <div style={{ display: "flex", alignItems: "flex-end", height: 140, gap: 2 }}>
        {reversed.map((f) => {
          const rev = f.revenue ?? 0;
          const net = f.netIncome ?? 0;
          const fcf = f.freeCashFlow ?? 0;
          const revH = maxVal > 0 ? (Math.abs(rev) / maxVal) * 100 : 0;
          const netH = maxVal > 0 ? (Math.abs(net) / maxVal) * 100 : 0;
          const fcfH = maxVal > 0 ? (Math.abs(fcf) / maxVal) * 100 : 0;

          return (
            <div key={f.period} style={{ flex: 1, display: "flex", gap: 1, alignItems: "flex-end", height: "100%" }}>
              <div
                title={`Revenue: ${compactNumber(f.revenue)}`}
                style={{ flex: 1, height: `${revH}%`, minHeight: 2, backgroundColor: "var(--primary)", opacity: 0.7, borderRadius: "1px 1px 0 0" }}
              />
              <div
                title={`Net Income: ${compactNumber(f.netIncome)}`}
                style={{ flex: 1, height: `${netH}%`, minHeight: 2, backgroundColor: net >= 0 ? "var(--success)" : "var(--danger)", opacity: 0.7, borderRadius: "1px 1px 0 0" }}
              />
              <div
                title={`FCF: ${compactNumber(f.freeCashFlow)}`}
                style={{ flex: 1, height: `${fcfH}%`, minHeight: 2, backgroundColor: fcf >= 0 ? "#9b59b6" : "var(--danger)", opacity: 0.6, borderRadius: "1px 1px 0 0" }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
        <span>{reversed[0]?.period}</span>
        <span>{reversed[reversed.length - 1]?.period}</span>
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--primary)", borderRadius: 1, marginRight: 3 }} />Revenue</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--success)", borderRadius: 1, marginRight: 3 }} />Net Income</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#9b59b6", borderRadius: 1, marginRight: 3 }} />FCF</span>
      </div>
    </div>
  );
}

// ── Margin Trend Chart (CSS-based) ──

function MarginChart({ data }: { data: FundamentalPeriod[] }) {
  if (data.length < 2) return null;

  const reversed = [...data].reverse();
  const margins = reversed.map((f) => ({
    period: f.period,
    gross: f.revenue && f.grossProfit ? f.grossProfit / f.revenue : null,
    operating: f.revenue && f.operatingIncome ? f.operatingIncome / f.revenue : null,
    net: f.revenue && f.netIncome ? f.netIncome / f.revenue : null,
  }));

  const allVals = margins.flatMap((m) => [m.gross, m.operating, m.net].filter((v) => v != null) as number[]);
  if (allVals.length === 0) return null;

  const maxMargin = Math.max(...allVals.map(Math.abs), 0.01);

  return (
    <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>Marges trimestrielles</div>
      <div style={{ display: "flex", alignItems: "flex-end", height: 120, gap: 2 }}>
        {margins.map((m) => (
          <div key={m.period} style={{ flex: 1, display: "flex", gap: 1, alignItems: "flex-end", height: "100%" }}>
            <div
              title={`Marge brute: ${formatPercent(m.gross)}`}
              style={{ flex: 1, height: `${m.gross != null ? (Math.abs(m.gross) / maxMargin) * 100 : 0}%`, minHeight: 1, backgroundColor: "var(--primary)", opacity: 0.6, borderRadius: "1px 1px 0 0" }}
            />
            <div
              title={`Marge op.: ${formatPercent(m.operating)}`}
              style={{ flex: 1, height: `${m.operating != null ? (Math.abs(m.operating) / maxMargin) * 100 : 0}%`, minHeight: 1, backgroundColor: "var(--warning)", opacity: 0.7, borderRadius: "1px 1px 0 0" }}
            />
            <div
              title={`Marge nette: ${formatPercent(m.net)}`}
              style={{ flex: 1, height: `${m.net != null ? (Math.abs(m.net) / maxMargin) * 100 : 0}%`, minHeight: 1, backgroundColor: (m.net ?? 0) >= 0 ? "var(--success)" : "var(--danger)", opacity: 0.7, borderRadius: "1px 1px 0 0" }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
        <span>{reversed[0]?.period}</span>
        <span>{reversed[reversed.length - 1]?.period}</span>
      </div>
      <div style={{ display: "flex", gap: "1rem", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--primary)", borderRadius: 1, marginRight: 3 }} />Brute</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--warning)", borderRadius: 1, marginRight: 3 }} />Operationnelle</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--success)", borderRadius: 1, marginRight: 3 }} />Nette</span>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

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
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertMetric, setAlertMetric] = useState("lastPrice");
  const [alertOperator, setAlertOperator] = useState("below");
  const [alertThreshold, setAlertThreshold] = useState("");
  const [alertSaving, setAlertSaving] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");

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
      api.fundamentals(ticker, { type: "quarterly", limit: 12, exchange }),
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

  const ALERT_METRICS = [
    { value: "lastPrice", label: "Prix" },
    { value: "marketCap", label: "Capitalisation" },
    { value: "peRatio", label: "P/E Ratio" },
    { value: "forwardPe", label: "Forward P/E" },
    { value: "pbRatio", label: "P/B" },
    { value: "psRatio", label: "P/S" },
    { value: "evToEbitda", label: "EV/EBITDA" },
    { value: "dividendYield", label: "Rend. div." },
    { value: "roe", label: "ROE" },
    { value: "netMargin", label: "Marge nette" },
    { value: "debtToEquity", label: "Debt/Equity" },
    { value: "qualityScore", label: "Score Qualite" },
  ];

  async function handleCreateAlert() {
    if (!stock) return;
    const threshold = parseFloat(alertThreshold);
    if (isNaN(threshold)) {
      setAlertMsg("Seuil invalide");
      return;
    }
    setAlertSaving(true);
    setAlertMsg("");
    try {
      await api.createAlert({
        stockId: stock.id,
        metric: alertMetric,
        operator: alertOperator,
        threshold,
      });
      setAlertMsg("Alerte creee !");
      setAlertThreshold("");
      setTimeout(() => {
        setShowAlertForm(false);
        setAlertMsg("");
      }, 1200);
    } catch (err) {
      setAlertMsg(err instanceof Error ? err.message : "Erreur");
    } finally {
      setAlertSaving(false);
    }
  }

  // Price sparkline
  const priceMin = prices.length ? Math.min(...prices.map((p) => p.low)) : 0;
  const priceMax = prices.length ? Math.max(...prices.map((p) => p.high)) : 1;
  const priceRange = priceMax - priceMin || 1;

  const firstPrice = prices[0]?.adjClose ?? null;
  const lastPrice = stock.lastPrice;
  const priceChange1Y =
    firstPrice != null && lastPrice != null && firstPrice !== 0
      ? (lastPrice - firstPrice) / firstPrice
      : null;

  const targetUpside =
    stock.targetPrice != null && lastPrice != null && lastPrice !== 0
      ? (stock.targetPrice - lastPrice) / lastPrice
      : null;

  const subScores = computeSubScores(stock);

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
    { label: "Target Price", value: stock.targetPrice?.toFixed(2) ?? "\u2014" },
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
            <button
              className="btn btn-ghost"
              onClick={() => setShowAlertForm(!showAlertForm)}
              title="Creer une alerte"
              style={{ fontSize: "1.3rem", padding: "0.125rem 0.375rem", lineHeight: 1 }}
            >
              {showAlertForm ? "\u2715" : "\ud83d\udd14"}
            </button>
            {stock.ticker}.{stock.exchangeId}
            <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: "0.75rem", fontSize: "1rem" }}>
              {stock.name}
            </span>
          </h2>
          <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
            {stock.sector ?? "\u2014"} &middot; {stock.industry ?? "\u2014"} &middot; {stock.currency}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "2rem", fontWeight: 700 }}>
            {lastPrice?.toFixed(2) ?? "\u2014"} <span style={{ fontSize: "0.875rem", fontWeight: 400 }}>{stock.currency}</span>
          </div>
          <div style={{ fontSize: "0.875rem" }}>
            <span>Mkt Cap: {formatMarketCap(stock.marketCap)}</span>
            <span style={{ margin: "0 0.5rem" }}>&middot;</span>
            <span>EV: {formatMarketCap(stock.enterpriseValue)}</span>
          </div>
        </div>
      </div>

      {/* Alert creation form */}
      {showAlertForm && (
        <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem", border: "1px solid var(--primary)" }}>
          <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Nouvelle alerte pour {stock.ticker}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.125rem" }}>Metrique</label>
              <select
                className="filter-select"
                value={alertMetric}
                onChange={(e) => setAlertMetric(e.target.value)}
                style={{ minWidth: 120 }}
              >
                {ALERT_METRICS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.125rem" }}>Condition</label>
              <select
                className="filter-select"
                value={alertOperator}
                onChange={(e) => setAlertOperator(e.target.value)}
              >
                <option value="above">Superieur ou egal</option>
                <option value="below">Inferieur ou egal</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "0.7rem", color: "var(--text-muted)", display: "block", marginBottom: "0.125rem" }}>Seuil</label>
              <input
                className="form-input"
                type="number"
                step="any"
                placeholder="ex: 150.00"
                value={alertThreshold}
                onChange={(e) => setAlertThreshold(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
            <button
              className="btn btn-primary"
              onClick={handleCreateAlert}
              disabled={alertSaving || !alertThreshold}
              style={{ fontSize: "0.8rem" }}
            >
              {alertSaving ? "..." : "Creer"}
            </button>
          </div>
          {alertMsg && (
            <div style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: alertMsg.includes("creee") ? "var(--success)" : "var(--danger)" }}>
              {alertMsg}
            </div>
          )}
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            Vous recevrez un email lorsque la condition sera remplie. Pour les metriques en %, entrez la valeur decimale (ex: 0.05 pour 5%).
          </div>
        </div>
      )}

      {/* Quality Score + Radar */}
      {stock.qualityScore != null && (
        <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "2rem", flexWrap: "wrap" }}>
            <div style={{ textAlign: "center", minWidth: 120 }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Score Pikpik</div>
              <div style={{
                fontSize: "2.5rem",
                fontWeight: 800,
                color: scoreColor(stock.qualityScore),
                lineHeight: 1,
              }}>
                {stock.qualityScore}
              </div>
              <div style={{
                fontSize: "0.8rem",
                fontWeight: 600,
                color: scoreColor(stock.qualityScore),
                marginTop: "0.25rem",
              }}>
                {scoreLabel(stock.qualityScore)}
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>/ 100</div>
            </div>
            <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
              <RadarChart scores={subScores} />
            </div>
            <div style={{ minWidth: 160 }}>
              {[
                { label: "Rentabilite", val: subScores.rentabilite },
                { label: "Croissance", val: subScores.croissance },
                { label: "Sante fin.", val: subScores.sante },
                { label: "Valorisation", val: subScores.valorisation },
                { label: "Cash Flow", val: subScores.cashFlow },
              ].map((cat) => (
                <div key={cat.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{cat.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                    <div style={{ width: 60, height: 6, background: "var(--bg-input)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{
                        width: `${cat.val != null ? (cat.val / 20) * 100 : 0}%`,
                        height: "100%",
                        background: cat.val != null && cat.val >= 14 ? "var(--success)" : cat.val != null && cat.val >= 9 ? "var(--warning)" : "var(--danger)",
                        borderRadius: 3,
                      }} />
                    </div>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, width: 24, textAlign: "right" }}>
                      {cat.val != null ? Math.round(cat.val) : "\u2014"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Price mini-chart */}
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

      {/* 52-week position */}
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

      {/* Fundamental charts */}
      {fundamentals.length >= 2 && (
        <>
          <FundamentalChart data={fundamentals} title="Revenue / Net Income / FCF (trimestriel)" />
          <MarginChart data={fundamentals} />
        </>
      )}

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
