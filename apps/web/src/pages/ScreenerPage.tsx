import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type StockSummary, type FilterOptions } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

type SortField = "marketCap" | "peRatio" | "dividendYield" | "lastPrice" | "revenueGrowth" | "ticker";
type SortDir = "asc" | "desc";

interface LocationState {
  filters?: Record<string, unknown>;
  sort?: { field: string; direction: string };
}

function formatFilterNum(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) < 1 && n !== 0) return `${(n * 100).toFixed(0)}%`;
  return n.toLocaleString();
}

export default function ScreenerPage() {
  const location = useLocation();
  const incomingState = location.state as LocationState | null;

  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  // Classification filters (dropdowns)
  const [exchange, setExchange] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");

  // Range filters from preset
  const [rangeFilters, setRangeFilters] = useState<Record<string, unknown>>({});
  const [presetName, setPresetName] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [cursor, setCursor] = useState<string | undefined>();

  // Save preset
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // Apply incoming preset state
  useEffect(() => {
    if (!incomingState?.filters) return;

    const f = { ...incomingState.filters };

    // Extract classification filters
    if (f.exchanges && Array.isArray(f.exchanges) && f.exchanges.length > 0) {
      setExchange(f.exchanges[0] as string);
      delete f.exchanges;
    }
    if (f.sectors && Array.isArray(f.sectors) && f.sectors.length > 0) {
      setSector(f.sectors[0] as string);
      delete f.sectors;
    }
    if (f.countries && Array.isArray(f.countries) && f.countries.length > 0) {
      setCountry(f.countries[0] as string);
      delete f.countries;
    }

    setRangeFilters(f);
    setPresetName("Preset applique");

    if (incomingState.sort) {
      const validFields: SortField[] = ["marketCap", "peRatio", "dividendYield", "lastPrice", "revenueGrowth", "ticker"];
      if (validFields.includes(incomingState.sort.field as SortField)) {
        setSortField(incomingState.sort.field as SortField);
        setSortDir(incomingState.sort.direction as SortDir);
      }
    }

    // Clear navigation state to avoid re-applying on refresh
    window.history.replaceState({}, "");
  }, [incomingState]);

  useEffect(() => {
    api.filterOptions().then((res) => setFilterOptions(res.data)).catch(console.error);
  }, []);

  const fetchStocks = useCallback(async (newCursor?: string) => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = { ...rangeFilters };
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
  }, [exchange, sector, country, sortField, sortDir, rangeFilters]);

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

  function clearPreset() {
    setRangeFilters({});
    setPresetName(null);
    setExchange("");
    setSector("");
    setCountry("");
    setSortField("marketCap");
    setSortDir("desc");
  }

  async function handleSavePreset() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const filters: Record<string, unknown> = { ...rangeFilters };
      if (exchange) filters.exchanges = [exchange];
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];

      await api.createPreset({
        name: saveName.trim(),
        filters,
        sort: { field: sortField, direction: sortDir },
        isPublic: false,
      });
      setSaveName("");
      setShowSave(false);
      alert("Preset sauvegarde !");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  const hasActiveFilters = Object.keys(rangeFilters).length > 0 || exchange || sector || country;

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

        {/* Range filters pills */}
        {Object.keys(rangeFilters).length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.375rem", alignSelf: "flex-end" }}>
            {Object.entries(rangeFilters).map(([key, val]) => {
              const v = val as { min?: number; max?: number };
              let label = key;
              if (v && typeof v === "object") {
                const parts: string[] = [];
                if (v.min !== undefined) parts.push(`>=${formatFilterNum(v.min)}`);
                if (v.max !== undefined) parts.push(`<=${formatFilterNum(v.max)}`);
                label = `${key} ${parts.join(" ")}`;
              }
              return (
                <span
                  key={key}
                  className="filter-pill"
                  onClick={() => {
                    const next = { ...rangeFilters };
                    delete next[key];
                    setRangeFilters(next);
                  }}
                  title="Cliquer pour retirer"
                >
                  {label} ×
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="stats-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span>{totalCount.toLocaleString()} actions</span>
          {presetName && (
            <span style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
              {presetName}
            </span>
          )}
          {hasActiveFilters && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
              onClick={clearPreset}
            >
              Reinitialiser
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {hasActiveFilters && (
            <>
              {showSave ? (
                <div style={{ display: "flex", gap: "0.375rem", alignItems: "center" }}>
                  <input
                    className="form-input"
                    style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", width: 160 }}
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Nom du preset"
                    onKeyDown={(e) => e.key === "Enter" && handleSavePreset()}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={handleSavePreset}
                    disabled={saving || !saveName.trim()}
                  >
                    OK
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                    onClick={() => setShowSave(false)}
                  >
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  onClick={() => setShowSave(true)}
                >
                  Sauvegarder en preset
                </button>
              )}
            </>
          )}
        </div>
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
