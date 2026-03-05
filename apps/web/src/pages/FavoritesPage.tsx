import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type BookmarkedStock } from "@/lib/api";
import { formatMarketCap, formatPercent } from "@stock-screener/shared";

function yahooFinanceUrl(ticker: string, exchangeId: string): string {
  if (exchangeId === "US") return `https://finance.yahoo.com/quote/${ticker}`;
  return `https://finance.yahoo.com/quote/${ticker}.${exchangeId}`;
}

function pctColor(v: number | null | undefined): string {
  if (v == null) return "";
  return v >= 0 ? "text-success" : "text-danger";
}

function scoreColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 45) return "var(--warning)";
  return "var(--danger)";
}

export default function FavoritesPage() {
  const navigate = useNavigate();
  const [bookmarks, setBookmarks] = useState<BookmarkedStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchBookmarks = useCallback(async () => {
    try {
      const res = await api.bookmarks();
      setBookmarks(res.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const handleRemove = async (stockId: string) => {
    try {
      await api.removeBookmark(stockId);
      setBookmarks((prev) => prev.filter((b) => b.stockId !== stockId));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(stockId);
        return next;
      });
    } catch {
      // ignore
    }
  };

  const toggleSelect = (stockId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stockId)) next.delete(stockId);
      else next.add(stockId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === bookmarks.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(bookmarks.map((b) => b.stockId)));
    }
  };

  const handleCompare = () => {
    const tickers = bookmarks
      .filter((b) => selected.has(b.stockId))
      .map((b) => `${b.stock.ticker}.${b.stock.exchangeId}`)
      .slice(0, 4)
      .join(",");
    if (tickers) navigate(`/compare?s=${tickers}`);
  };

  if (loading) return <div className="loading">Chargement...</div>;

  if (bookmarks.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--text-muted)" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>☆</div>
        <div style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Aucun favori</div>
        <div style={{ fontSize: "0.875rem" }}>
          Ajoutez des actions depuis le{" "}
          <Link to="/" style={{ color: "var(--primary)" }}>screener</Link>{" "}
          ou une fiche action.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Favoris ({bookmarks.length})</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {selected.size >= 2 && (
            <button className="btn btn-primary" onClick={handleCompare} style={{ fontSize: "0.8rem" }}>
              Comparer ({Math.min(selected.size, 4)})
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table className="screener-table" style={{ width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={selected.size === bookmarks.length} onChange={toggleAll} />
              </th>
              <th>Ticker</th>
              <th>Nom</th>
              <th>Secteur</th>
              <th style={{ textAlign: "right" }}>Prix</th>
              <th style={{ textAlign: "right" }}>1J</th>
              <th style={{ textAlign: "right" }}>1S</th>
              <th style={{ textAlign: "right" }}>1M</th>
              <th style={{ textAlign: "right" }}>Mkt Cap</th>
              <th style={{ textAlign: "right" }}>Score</th>
              <th style={{ textAlign: "center" }}>Fiche</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {bookmarks.map((b) => {
              const s = b.stock;
              return (
                <tr key={b.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(b.stockId)}
                      onChange={() => toggleSelect(b.stockId)}
                    />
                  </td>
                  <td>
                    <Link
                      to={`/stock/${s.ticker}?exchange=${s.exchangeId}`}
                      style={{ color: "var(--primary)", fontWeight: 600 }}
                    >
                      {s.ticker}
                    </Link>
                  </td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </td>
                  <td style={{ color: "var(--text-muted)" }}>{s.sector ?? "\u2014"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {s.lastPrice?.toFixed(2) ?? "\u2014"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={pctColor(s.priceChange1D)}>
                      {s.priceChange1D != null ? formatPercent(s.priceChange1D) : "\u2014"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={pctColor(s.priceChange1W)}>
                      {s.priceChange1W != null ? formatPercent(s.priceChange1W) : "\u2014"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className={pctColor(s.priceChange1M)}>
                      {s.priceChange1M != null ? formatPercent(s.priceChange1M) : "\u2014"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{formatMarketCap(s.marketCap)}</td>
                  <td style={{ textAlign: "right" }}>
                    {s.qualityScore != null ? (
                      <span style={{ fontWeight: 700, color: scoreColor(s.qualityScore) }}>
                        {s.qualityScore}
                      </span>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <a
                      href={yahooFinanceUrl(s.ticker, s.exchangeId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Yahoo Finance"
                      style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
                    >
                      ↗
                    </a>
                  </td>
                  <td>
                    <button
                      onClick={() => handleRemove(b.stockId)}
                      className="btn btn-ghost"
                      style={{ padding: "0.125rem 0.375rem", fontSize: "0.75rem", color: "var(--danger)" }}
                      title="Retirer des favoris"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
