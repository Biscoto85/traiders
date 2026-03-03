import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api, type StockDetail, type PriceBar } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444"];
const MAX_STOCKS = 4;

// ── Score computation (mirrors StockDetailPage) ──

function scoreUp(value: number | null | undefined, t: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  if (value >= t[3]) return 10;
  if (value >= t[2]) return 8;
  if (value >= t[1]) return 6;
  if (value >= t[0]) return 3;
  return 0;
}

function scoreDown(value: number | null | undefined, t: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  if (value <= t[0]) return 10;
  if (value <= t[1]) return 8;
  if (value <= t[2]) return 6;
  if (value <= t[3]) return 3;
  return 0;
}

function scorePe(pe: number | null | undefined): number | null {
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

function computeSubScores(s: StockDetail): SubScores {
  const avg = (a: number | null, b: number | null): number | null => {
    if (a != null && b != null) return (a + b);
    if (a != null) return a * 2;
    if (b != null) return b * 2;
    return null;
  };
  return {
    rentabilite: avg(scoreUp(s.roe, [0.05, 0.10, 0.15, 0.20]), scoreUp(s.netMargin, [0.05, 0.10, 0.15, 0.20])),
    croissance: avg(scoreUp(s.revenueGrowth, [0.05, 0.10, 0.15, 0.25]), scoreUp(s.earningsGrowth, [0.03, 0.08, 0.12, 0.20])),
    sante: avg(scoreDown(s.debtToEquity, [0.3, 0.5, 1.0, 2.0]), scoreUp(s.currentRatio, [1.0, 1.2, 1.5, 2.0])),
    valorisation: avg(scorePe(s.peRatio), scoreUp(s.fcfYield, [0.01, 0.03, 0.05, 0.08])),
    cashFlow: avg(
      scoreDown(s.priceToOCF, [8, 12, 18, 25]),
      s.netDebtToOCF != null && s.netDebtToOCF < 0 ? 10 : scoreDown(s.netDebtToOCF, [1, 2, 3, 5]),
    ),
  };
}

// ── Overlaid Radar Chart ──

function CompareRadar({ stocks }: { stocks: Array<{ ticker: string; scores: SubScores; color: string }> }) {
  const labels = ["Rentabilite", "Croissance", "Sante fin.", "Valorisation", "Cash Flow"];
  const cx = 140, cy = 140, maxR = 100;
  const n = 5;
  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  function getPoint(i: number, val: number): [number, number] {
    const angle = startAngle + i * angleStep;
    const r = (val / 20) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }

  const levels = [5, 10, 15, 20];
  const gridPaths = levels.map((level) => {
    const pts = Array.from({ length: n }, (_, i) => getPoint(i, level));
    return pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  });

  const labelPositions = Array.from({ length: n }, (_, i) => {
    const angle = startAngle + i * angleStep;
    const r = maxR + 22;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });

  return (
    <svg viewBox="0 0 280 280" style={{ width: "100%", maxWidth: 320 }}>
      {gridPaths.map((path, i) => (
        <polygon key={i} points={path} fill="none" stroke="var(--bg-input)" strokeWidth="1" />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = getPoint(i, 20);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--bg-input)" strokeWidth="1" />;
      })}
      {stocks.map((s) => {
        const vals = [s.scores.rentabilite, s.scores.croissance, s.scores.sante, s.scores.valorisation, s.scores.cashFlow];
        const pts = vals.map((v, i) => getPoint(i, v ?? 0));
        const path = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
        return (
          <polygon key={s.ticker} points={path} fill={s.color} fillOpacity="0.15" stroke={s.color} strokeWidth="2" />
        );
      })}
      {labelPositions.map(([x, y], i) => (
        <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize="10" fill="var(--text-muted)">
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

// ── Normalized Price Chart (SVG line chart) ──

function PriceCompareChart({ datasets }: { datasets: Array<{ ticker: string; prices: PriceBar[]; color: string }> }) {
  if (datasets.length === 0 || datasets.every((d) => d.prices.length === 0)) return null;

  // Normalize to base 100 (first available price)
  const normalized = datasets.map((d) => {
    const base = d.prices[0]?.adjClose ?? 1;
    return {
      ...d,
      values: d.prices.map((p) => ({ date: p.date, val: (p.adjClose / base) * 100 })),
    };
  });

  // Find common date range and value range
  const allVals = normalized.flatMap((d) => d.values.map((v) => v.val));
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const valRange = maxVal - minVal || 1;

  // SVG dimensions
  const W = 600, H = 200, padL = 40, padR = 10, padT = 10, padB = 25;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // Use longest dataset for x-axis
  const maxLen = Math.max(...normalized.map((d) => d.values.length));

  return (
    <div className="card" style={{ padding: "1rem", marginBottom: "1.5rem" }}>
      <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
        Performance relative (1 an, base 100)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }}>
        {/* Horizontal grid + labels */}
        {[minVal, minVal + valRange * 0.25, minVal + valRange * 0.5, minVal + valRange * 0.75, maxVal].map((v, i) => {
          const y = padT + chartH - ((v - minVal) / valRange) * chartH;
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--bg-input)" strokeWidth="0.5" />
              <text x={padL - 4} y={y} textAnchor="end" dominantBaseline="central" fontSize="9" fill="var(--text-muted)">
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}
        {/* 100 line */}
        {minVal < 100 && maxVal > 100 && (
          <line
            x1={padL}
            y1={padT + chartH - ((100 - minVal) / valRange) * chartH}
            x2={W - padR}
            y2={padT + chartH - ((100 - minVal) / valRange) * chartH}
            stroke="var(--text-muted)"
            strokeWidth="0.5"
            strokeDasharray="4 2"
          />
        )}
        {/* Lines */}
        {normalized.map((d) => {
          if (d.values.length < 2) return null;
          const points = d.values.map((v, i) => {
            const x = padL + (i / (maxLen - 1)) * chartW;
            const y = padT + chartH - ((v.val - minVal) / valRange) * chartH;
            return `${x},${y}`;
          }).join(" ");
          return <polyline key={d.ticker} points={points} fill="none" stroke={d.color} strokeWidth="2" />;
        })}
        {/* Date labels */}
        {normalized[0] && normalized[0].values.length > 0 && (
          <>
            <text x={padL} y={H - 4} fontSize="9" fill="var(--text-muted)">{normalized[0].values[0]?.date}</text>
            <text x={W - padR} y={H - 4} fontSize="9" fill="var(--text-muted)" textAnchor="end">
              {normalized[0].values[normalized[0].values.length - 1]?.date}
            </text>
          </>
        )}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {normalized.map((d) => {
          const lastVal = d.values[d.values.length - 1]?.val;
          const pct = lastVal != null ? lastVal - 100 : null;
          return (
            <span key={d.ticker} style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
              <span style={{ display: "inline-block", width: 10, height: 3, background: d.color, borderRadius: 1 }} />
              <strong>{d.ticker}</strong>
              {pct != null && (
                <span style={{ color: pct >= 0 ? "var(--success)" : "var(--danger)" }}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Metric comparison table ──

interface MetricRow {
  label: string;
  key: keyof StockDetail;
  format: "ratio" | "pct" | "cap" | "price" | "score";
  higherIsBetter?: boolean;
}

const METRIC_SECTIONS: Array<{ title: string; metrics: MetricRow[] }> = [
  {
    title: "Valorisation",
    metrics: [
      { label: "P/E", key: "peRatio", format: "ratio", higherIsBetter: false },
      { label: "Forward P/E", key: "forwardPe", format: "ratio", higherIsBetter: false },
      { label: "PEG", key: "pegRatio", format: "ratio", higherIsBetter: false },
      { label: "P/B", key: "pbRatio", format: "ratio", higherIsBetter: false },
      { label: "P/S", key: "psRatio", format: "ratio", higherIsBetter: false },
      { label: "EV/EBITDA", key: "evToEbitda", format: "ratio", higherIsBetter: false },
      { label: "EV/Revenue", key: "evToRevenue", format: "ratio", higherIsBetter: false },
    ],
  },
  {
    title: "Taille",
    metrics: [
      { label: "Prix", key: "lastPrice", format: "price" },
      { label: "Mkt Cap", key: "marketCap", format: "cap" },
      { label: "EV", key: "enterpriseValue", format: "cap" },
    ],
  },
  {
    title: "Rentabilite",
    metrics: [
      { label: "Marge brute", key: "grossMargin", format: "pct", higherIsBetter: true },
      { label: "Marge op.", key: "operatingMargin", format: "pct", higherIsBetter: true },
      { label: "Marge nette", key: "netMargin", format: "pct", higherIsBetter: true },
      { label: "ROE", key: "roe", format: "pct", higherIsBetter: true },
      { label: "ROA", key: "roa", format: "pct", higherIsBetter: true },
      { label: "FCF Yield", key: "fcfYield", format: "pct", higherIsBetter: true },
    ],
  },
  {
    title: "Croissance",
    metrics: [
      { label: "Rev. Growth", key: "revenueGrowth", format: "pct", higherIsBetter: true },
      { label: "Earnings Growth", key: "earningsGrowth", format: "pct", higherIsBetter: true },
      { label: "CAGR 5Y Rev.", key: "revenueCAGR5Y", format: "pct", higherIsBetter: true },
    ],
  },
  {
    title: "Dividende & Rendement",
    metrics: [
      { label: "Div. Yield", key: "dividendYield", format: "pct", higherIsBetter: true },
    ],
  },
  {
    title: "Risque",
    metrics: [
      { label: "Beta", key: "beta", format: "ratio" },
      { label: "Debt/Equity", key: "debtToEquity", format: "ratio", higherIsBetter: false },
      { label: "Current Ratio", key: "currentRatio", format: "ratio", higherIsBetter: true },
    ],
  },
  {
    title: "Score Qualite",
    metrics: [
      { label: "Score Pikpik", key: "qualityScore", format: "score", higherIsBetter: true },
    ],
  },
];

function formatCell(value: number | null | undefined, format: MetricRow["format"]): string {
  if (value == null) return "\u2014";
  switch (format) {
    case "ratio": return formatRatio(value);
    case "pct": return formatPercent(value);
    case "cap": return formatMarketCap(value);
    case "price": return value.toFixed(2);
    case "score": return String(Math.round(value));
  }
}

function bestIndex(stocks: StockDetail[], key: keyof StockDetail, higherIsBetter?: boolean): number {
  if (higherIsBetter === undefined) return -1;
  let bestIdx = -1;
  let bestVal = higherIsBetter ? -Infinity : Infinity;
  for (let i = 0; i < stocks.length; i++) {
    const v = stocks[i]![key] as number | null;
    if (v == null) continue;
    if (higherIsBetter ? v > bestVal : v < bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// ── Stock Search/Picker ──

function StockPicker({ onSelect, exclude }: { onSelect: (ticker: string, exchange: string) => void; exclude: string[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ ticker: string; exchangeId: string; name: string }>>([]);
  const [searching, setSearching] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await api.screener({
        filters: {},
        sort: { field: "marketCap", direction: "desc" },
        limit: 8,
        tickerStartsWith: q.toUpperCase(),
      });
      setResults(
        res.data
          .filter((s) => !exclude.includes(`${s.ticker}.${s.exchangeId}`))
          .slice(0, 6)
          .map((s) => ({ ticker: s.ticker, exchangeId: s.exchangeId, name: s.name })),
      );
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [exclude]);

  useEffect(() => {
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search]);

  return (
    <div style={{ position: "relative" }}>
      <input
        className="form-input"
        type="text"
        placeholder="Rechercher un ticker..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: 200 }}
      />
      {(results.length > 0 || searching) && query.length > 0 && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--bg-card)",
          border: "1px solid var(--bg-input)",
          borderRadius: "0.375rem",
          zIndex: 10,
          maxHeight: 200,
          overflow: "auto",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        }}>
          {searching && <div style={{ padding: "0.5rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>Recherche...</div>}
          {results.map((r) => (
            <button
              key={`${r.ticker}.${r.exchangeId}`}
              onClick={() => {
                onSelect(r.ticker, r.exchangeId);
                setQuery("");
                setResults([]);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "0.5rem 0.75rem",
                border: "none",
                background: "transparent",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "0.8rem",
                color: "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-input)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <strong>{r.ticker}.{r.exchangeId}</strong>
              <span style={{ marginLeft: "0.5rem", color: "var(--text-muted)" }}>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

interface StockData {
  key: string; // "AAPL.US"
  ticker: string;
  exchange: string;
  detail: StockDetail;
  prices: PriceBar[];
  color: string;
}

export default function ComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(false);

  // Initialize from URL params: ?s=AAPL.US,MSFT.US
  useEffect(() => {
    const param = searchParams.get("s");
    if (!param) return;
    const tickers = param.split(",").slice(0, MAX_STOCKS);
    if (tickers.length === 0) return;

    setLoading(true);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().split("T")[0];

    Promise.all(
      tickers.map(async (tk, idx) => {
        const [ticker, exchange] = tk.split(".");
        if (!ticker) return null;
        try {
          const [stockRes, pricesRes] = await Promise.all([
            api.stock(ticker, exchange),
            api.prices(ticker, { from: fromDate, exchange }),
          ]);
          return {
            key: tk,
            ticker: ticker,
            exchange: exchange ?? "",
            detail: stockRes.data,
            prices: pricesRes.data,
            color: COLORS[idx % COLORS.length]!,
          } as StockData;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => setStocks(results.filter((r): r is StockData => r !== null)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addStock(ticker: string, exchange: string) {
    if (stocks.length >= MAX_STOCKS) return;
    const key = `${ticker}.${exchange}`;
    if (stocks.some((s) => s.key === key)) return;

    setLoading(true);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString().split("T")[0];

    Promise.all([
      api.stock(ticker, exchange),
      api.prices(ticker, { from: fromDate, exchange }),
    ])
      .then(([stockRes, pricesRes]) => {
        const newStock: StockData = {
          key,
          ticker,
          exchange,
          detail: stockRes.data,
          prices: pricesRes.data,
          color: COLORS[(stocks.length) % COLORS.length]!,
        };
        const updated = [...stocks, newStock];
        setStocks(updated);
        setSearchParams({ s: updated.map((s) => s.key).join(",") });
      })
      .catch((err) => console.error("Add stock error:", err))
      .finally(() => setLoading(false));
  }

  function removeStock(key: string) {
    const updated = stocks.filter((s) => s.key !== key).map((s, i) => ({ ...s, color: COLORS[i % COLORS.length]! }));
    setStocks(updated);
    if (updated.length > 0) {
      setSearchParams({ s: updated.map((s) => s.key).join(",") });
    } else {
      setSearchParams({});
    }
  }

  const details = stocks.map((s) => s.detail);

  return (
    <div>
      <h2 style={{ marginBottom: "1rem" }}>Comparaison</h2>

      {/* Stock picker */}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {stocks.map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.375rem 0.625rem",
              borderRadius: "0.375rem",
              border: `2px solid ${s.color}`,
              fontSize: "0.8rem",
              fontWeight: 600,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
            <Link to={`/stock/${s.ticker}?exchange=${s.exchange}`} style={{ color: "inherit", textDecoration: "none" }}>
              {s.key}
            </Link>
            <button
              onClick={() => removeStock(s.key)}
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", fontSize: "1rem", lineHeight: 1, padding: 0, marginLeft: "0.25rem" }}
              title="Retirer"
            >
              &times;
            </button>
          </div>
        ))}
        {stocks.length < MAX_STOCKS && (
          <StockPicker
            onSelect={addStock}
            exclude={stocks.map((s) => s.key)}
          />
        )}
        {loading && <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Chargement...</span>}
      </div>

      {stocks.length === 0 && (
        <div className="card" style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
          Ajoutez 2 a 4 actions pour les comparer. Recherchez par ticker ci-dessus.
        </div>
      )}

      {stocks.length >= 2 && (
        <>
          {/* Radar chart comparison */}
          <div className="card" style={{ padding: "1.25rem", marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.75rem" }}>
              Radar Score Qualite
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <CompareRadar
                stocks={stocks.map((s) => ({
                  ticker: s.ticker,
                  scores: computeSubScores(s.detail),
                  color: s.color,
                }))}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: "1.25rem", marginTop: "0.5rem" }}>
              {stocks.map((s) => (
                <span key={s.key} style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: s.color }} />
                  {s.ticker}
                  {s.detail.qualityScore != null && (
                    <span style={{ fontWeight: 600 }}>{s.detail.qualityScore}/100</span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {/* Normalized price chart */}
          <PriceCompareChart
            datasets={stocks.map((s) => ({
              ticker: s.key,
              prices: s.prices,
              color: s.color,
            }))}
          />

          {/* Metrics comparison table */}
          <div className="card" style={{ padding: 0, overflow: "auto", marginBottom: "1.5rem" }}>
            <table className="data-table" style={{ fontSize: "0.8rem" }}>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1 }}>Metrique</th>
                  {stocks.map((s) => (
                    <th key={s.key} className="text-right" style={{ color: s.color, minWidth: 90 }}>
                      {s.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_SECTIONS.map((section) => (
                  <>
                    <tr key={`h-${section.title}`}>
                      <td
                        colSpan={stocks.length + 1}
                        style={{
                          fontWeight: 700,
                          fontSize: "0.75rem",
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          paddingTop: "0.75rem",
                          background: "var(--bg-card)",
                        }}
                      >
                        {section.title}
                      </td>
                    </tr>
                    {section.metrics.map((m) => {
                      const best = bestIndex(details, m.key, m.higherIsBetter);
                      return (
                        <tr key={m.key}>
                          <td style={{ position: "sticky", left: 0, background: "var(--bg-card)", zIndex: 1 }}>{m.label}</td>
                          {details.map((d, i) => (
                            <td
                              key={stocks[i]!.key}
                              className="text-right"
                              style={{ fontWeight: i === best ? 700 : 400, color: i === best ? "var(--success)" : undefined }}
                            >
                              {formatCell(d[m.key] as number | null, m.format)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {stocks.length === 1 && (
        <div className="card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)" }}>
          Ajoutez au moins une autre action pour comparer.
        </div>
      )}
    </div>
  );
}
