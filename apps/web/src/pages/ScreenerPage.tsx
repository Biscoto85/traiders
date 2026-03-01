import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { api, type StockSummary, type FilterOptions } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

type SortField = "marketCap" | "peRatio" | "dividendYield" | "lastPrice" | "revenueGrowth" | "ticker";
type SortDir = "asc" | "desc";

export default function ScreenerPage() {
  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  // Filters
  const [exchange, setExchange] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [cursor, setCursor] = useState<string | undefined>();

  useEffect(() => {
    api.filterOptions().then((res) => setFilterOptions(res.data)).catch(console.error);
  }, []);

  const fetchStocks = useCallback(async (newCursor?: string) => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = {};
      if (exchange) filters.exchanges = [exchange];
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];

      const res = await api.screener({
        filters,
        sort: { field: sortField, direction: sortDir },
        cursor: newCursor,
        limit: 50,
      });

      setStocks(newCursor ? (prev) => [...prev, ...res.data] : res.data);
      setTotalCount(res.pagination.totalCount);
      setCursor(res.pagination.nextCursor ?? undefined);
    } catch (err) {
      console.error("Screener error:", err);
    } finally {
      setLoading(false);
    }
  }, [exchange, sector, country, sortField, sortDir]);

  useEffect(() => {
    fetchStocks();
  }, [fetchStocks]);

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function sortIndicator(field: SortField) {
    if (field !== sortField) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  return (
    <div>
      <div className="filters-bar">
        <div className="filter-group">
          <label>Exchange</label>
          <select className="filter-select" value={exchange} onChange={(e) => setExchange(e.target.value)}>
            <option value="">Tous</option>
            {filterOptions?.exchanges.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Secteur</label>
          <select className="filter-select" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">Tous</option>
            {filterOptions?.sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Pays</label>
          <select className="filter-select" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Tous</option>
            {filterOptions?.countries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="stats-bar">
        <span>{totalCount.toLocaleString()} actions</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("ticker")}>Ticker{sortIndicator("ticker")}</th>
              <th>Nom</th>
              <th>Secteur</th>
              <th className="text-right" onClick={() => handleSort("lastPrice")}>Prix{sortIndicator("lastPrice")}</th>
              <th className="text-right" onClick={() => handleSort("marketCap")}>Market Cap{sortIndicator("marketCap")}</th>
              <th className="text-right" onClick={() => handleSort("peRatio")}>P/E{sortIndicator("peRatio")}</th>
              <th className="text-right" onClick={() => handleSort("dividendYield")}>Div. Yield{sortIndicator("dividendYield")}</th>
              <th className="text-right" onClick={() => handleSort("revenueGrowth")}>Rev. Growth{sortIndicator("revenueGrowth")}</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <tr key={stock.id}>
                <td><Link to={`/stock/${stock.ticker}?exchange=${stock.exchangeId}`}><strong>{stock.ticker}</strong></Link></td>
                <td style={{ maxWidth: 250, overflow: "hidden", textOverflow: "ellipsis" }}>{stock.name}</td>
                <td>{stock.sector ?? "—"}</td>
                <td className="text-right">{stock.lastPrice?.toFixed(2) ?? "—"}</td>
                <td className="text-right">{formatMarketCap(stock.marketCap)}</td>
                <td className="text-right">{formatRatio(stock.peRatio)}</td>
                <td className="text-right">{formatPercent(stock.dividendYield)}</td>
                <td className={`text-right ${(stock.revenueGrowth ?? 0) >= 0 ? "text-success" : "text-danger"}`}>
                  {formatPercent(stock.revenueGrowth)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {loading && <div className="loading">Chargement...</div>}

      {!loading && cursor && (
        <div style={{ textAlign: "center", margin: "1.5rem 0" }}>
          <button className="btn btn-primary" onClick={() => fetchStocks(cursor)}>
            Charger plus
          </button>
        </div>
      )}
    </div>
  );
}
