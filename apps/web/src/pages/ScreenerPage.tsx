import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type StockSummary, type FilterOptions, type Preset } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio, DEFAULT_PRESETS } from "@stock-screener/shared";

type SortField = "marketCap" | "peRatio" | "dividendYield" | "lastPrice" | "revenueGrowth" | "ticker";
type SortDir = "asc" | "desc";

interface LocationState {
  filters?: Record<string, unknown>;
  sort?: { field: string; direction: string };
}

// All available criteria with labels and categories
const CRITERIA_OPTIONS: Array<{
  key: string;
  label: string;
  category: string;
  hint?: string;
  isPercent?: boolean;
  isCurrency?: boolean;
}> = [
  // Valuation
  { key: "peRatio", label: "P/E Ratio", category: "Valorisation", hint: "ex: 5 - 20" },
  { key: "forwardPe", label: "Forward P/E", category: "Valorisation", hint: "ex: 5 - 18" },
  { key: "pegRatio", label: "PEG Ratio", category: "Valorisation", hint: "ex: 0.1 - 1.5" },
  { key: "pbRatio", label: "P/B Ratio", category: "Valorisation", hint: "ex: 0.5 - 3" },
  { key: "psRatio", label: "P/S Ratio", category: "Valorisation", hint: "ex: 0.5 - 5" },
  { key: "evToEbitda", label: "EV/EBITDA", category: "Valorisation", hint: "ex: 3 - 12" },
  { key: "evToRevenue", label: "EV/Revenue", category: "Valorisation", hint: "ex: 0.5 - 5" },
  // Size & price
  { key: "marketCap", label: "Market Cap", category: "Taille", hint: "ex: 1000000000", isCurrency: true },
  { key: "price", label: "Prix", category: "Taille", hint: "ex: 10 - 500", isCurrency: true },
  { key: "enterpriseValue", label: "Valeur d'entreprise", category: "Taille", isCurrency: true },
  // Profitability
  { key: "grossMargin", label: "Marge brute", category: "Rentabilite", hint: "ex: 0.30", isPercent: true },
  { key: "operatingMargin", label: "Marge operationnelle", category: "Rentabilite", hint: "ex: 0.12", isPercent: true },
  { key: "netMargin", label: "Marge nette", category: "Rentabilite", hint: "ex: 0.08", isPercent: true },
  { key: "roe", label: "ROE", category: "Rentabilite", hint: "ex: 0.12", isPercent: true },
  { key: "roa", label: "ROA", category: "Rentabilite", hint: "ex: 0.05", isPercent: true },
  // Growth
  { key: "revenueGrowth", label: "Croiss. revenus", category: "Croissance", hint: "ex: 0.10", isPercent: true },
  { key: "earningsGrowth", label: "Croiss. benefices", category: "Croissance", hint: "ex: 0.08", isPercent: true },
  // Yield
  { key: "dividendYield", label: "Div. Yield", category: "Rendement", hint: "ex: 0.025", isPercent: true },
  { key: "fcfYield", label: "FCF Yield", category: "Rendement", hint: "ex: 0.05", isPercent: true },
  // Risk
  { key: "beta", label: "Beta", category: "Risque", hint: "ex: 0.5 - 1.5" },
  { key: "debtToEquity", label: "Debt/Equity", category: "Risque", hint: "ex: 0 - 1.5" },
  { key: "currentRatio", label: "Current Ratio", category: "Risque", hint: "ex: 1.2" },
  // Technical
  { key: "pctFrom52WeekHigh", label: "% vs 52s High", category: "Technique", hint: "ex: -0.40 - -0.15", isPercent: true },
  { key: "pctFrom52WeekLow", label: "% vs 52s Low", category: "Technique", hint: "ex: 0.10 - 0.50", isPercent: true },
  // Analyst
  { key: "targetPrice", label: "Prix cible", category: "Analyste", isCurrency: true },
  { key: "pctInsiders", label: "% Insiders", category: "Analyste", isPercent: true },
  { key: "pctInstitutions", label: "% Institutions", category: "Analyste", isPercent: true },
  { key: "shortPctFloat", label: "% Short Float", category: "Analyste", isPercent: true },
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAGE_SIZE = 50;

function formatFilterNum(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) < 1 && n !== 0) return `${(n * 100).toFixed(0)}%`;
  return n.toLocaleString();
}

function criteriaLabel(key: string): string {
  return CRITERIA_OPTIONS.find((c) => c.key === key)?.label ?? key;
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

  // Range filters
  const [rangeFilters, setRangeFilters] = useState<Record<string, unknown>>({});
  const [presetName, setPresetName] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination (offset-based)
  const [currentPage, setCurrentPage] = useState(1);

  // Alphabet navigation
  const [activeLetter, setActiveLetter] = useState<string | null>(null);

  // Criteria editor
  const [showCriteriaPanel, setShowCriteriaPanel] = useState(false);
  const [newCriterionKey, setNewCriterionKey] = useState("");
  const [newCriterionMin, setNewCriterionMin] = useState("");
  const [newCriterionMax, setNewCriterionMax] = useState("");

  // Presets selector
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [showPresets, setShowPresets] = useState(false);

  // Bookmarks
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [togglingBookmark, setTogglingBookmark] = useState<string | null>(null);

  // Save preset
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // Apply incoming preset state
  useEffect(() => {
    if (!incomingState?.filters) return;

    const f = { ...incomingState.filters };

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

    window.history.replaceState({}, "");
  }, [incomingState]);

  // Load filter options + user presets + bookmarks
  useEffect(() => {
    api.filterOptions().then((res) => setFilterOptions(res.data)).catch(console.error);
    api.presets().then((res) => setUserPresets(res.data)).catch(console.error);
    api.bookmarkIds().then((res) => setBookmarkedIds(new Set(res.data))).catch(console.error);
  }, []);

  const fetchStocks = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = { ...rangeFilters };
      if (exchange) filters.exchanges = [exchange];
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];

      const offset = (currentPage - 1) * PAGE_SIZE;

      const res = await api.screener({
        filters,
        sort: { field: sortField, direction: sortDir },
        offset,
        limit: PAGE_SIZE,
        tickerStartsWith: activeLetter ?? undefined,
      });

      setStocks(res.data);
      setTotalCount(res.pagination.totalCount);
    } catch (err) {
      console.error("Screener error:", err);
    } finally {
      setLoading(false);
    }
  }, [exchange, sector, country, sortField, sortDir, rangeFilters, currentPage, activeLetter]);

  useEffect(() => {
    fetchStocks();
  }, [fetchStocks]);

  // Reset page when filters/sort/letter change
  function resetPage() {
    setCurrentPage(1);
  }

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    resetPage();
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
    setActiveLetter(null);
    resetPage();
  }

  function handleLetterClick(letter: string) {
    if (activeLetter === letter) {
      setActiveLetter(null);
    } else {
      setActiveLetter(letter);
    }
    setCurrentPage(1);
  }

  function addCriterion() {
    if (!newCriterionKey) return;
    const range: { min?: number; max?: number } = {};
    if (newCriterionMin.trim()) range.min = parseFloat(newCriterionMin);
    if (newCriterionMax.trim()) range.max = parseFloat(newCriterionMax);
    if (range.min === undefined && range.max === undefined) return;
    if (isNaN(range.min ?? 0) || isNaN(range.max ?? 0)) return;

    setRangeFilters((prev) => ({ ...prev, [newCriterionKey]: range }));
    setNewCriterionKey("");
    setNewCriterionMin("");
    setNewCriterionMax("");
    resetPage();
  }

  function removeCriterion(key: string) {
    setRangeFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    resetPage();
  }

  function applyPreset(filters: Record<string, unknown>, sort?: Record<string, unknown> | null, name?: string) {
    const f = { ...filters };
    // Extract classification filters
    if (f.exchanges && Array.isArray(f.exchanges) && f.exchanges.length > 0) {
      setExchange(f.exchanges[0] as string);
      delete f.exchanges;
    } else {
      setExchange("");
    }
    if (f.sectors && Array.isArray(f.sectors) && f.sectors.length > 0) {
      setSector(f.sectors[0] as string);
      delete f.sectors;
    } else {
      setSector("");
    }
    if (f.countries && Array.isArray(f.countries) && f.countries.length > 0) {
      setCountry(f.countries[0] as string);
      delete f.countries;
    } else {
      setCountry("");
    }

    setRangeFilters(f);
    setPresetName(name ?? "Preset applique");
    setActiveLetter(null);
    resetPage();

    if (sort && "field" in sort && "direction" in sort) {
      const validFields: SortField[] = ["marketCap", "peRatio", "dividendYield", "lastPrice", "revenueGrowth", "ticker"];
      if (validFields.includes(sort.field as SortField)) {
        setSortField(sort.field as SortField);
        setSortDir(sort.direction as SortDir);
      }
    }

    setShowPresets(false);
  }

  async function handleSavePreset() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const filters: Record<string, unknown> = { ...rangeFilters };
      if (exchange) filters.exchanges = [exchange];
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];

      const res = await api.createPreset({
        name: saveName.trim(),
        filters,
        sort: { field: sortField, direction: sortDir },
        isPublic: false,
      });
      setUserPresets((prev) => [res.data, ...prev]);
      setSaveName("");
      setShowSave(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  async function toggleBookmark(stockId: string) {
    setTogglingBookmark(stockId);
    try {
      if (bookmarkedIds.has(stockId)) {
        await api.removeBookmark(stockId);
        setBookmarkedIds((prev) => { const next = new Set(prev); next.delete(stockId); return next; });
      } else {
        await api.addBookmark(stockId);
        setBookmarkedIds((prev) => new Set(prev).add(stockId));
      }
    } catch (err) {
      console.error("Bookmark error:", err);
    } finally {
      setTogglingBookmark(null);
    }
  }

  const hasActiveFilters = Object.keys(rangeFilters).length > 0 || exchange || sector || country;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Available criteria (exclude already-added ones)
  const usedKeys = new Set(Object.keys(rangeFilters));
  const availableCriteria = CRITERIA_OPTIONS.filter((c) => !usedKeys.has(c.key));

  // Group available criteria by category
  const criteriaByCategory: Record<string, typeof CRITERIA_OPTIONS> = {};
  for (const c of availableCriteria) {
    if (!criteriaByCategory[c.category]) criteriaByCategory[c.category] = [];
    criteriaByCategory[c.category]!.push(c);
  }

  // Generate page numbers to display
  function getPageNumbers(): (number | "...")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "...")[] = [1];
    if (currentPage > 3) pages.push("...");
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
      pages.push(i);
    }
    if (currentPage < totalPages - 2) pages.push("...");
    if (totalPages > 1) pages.push(totalPages);
    return pages;
  }

  return (
    <div>
      {/* Preset selector bar */}
      <div className="screener-toolbar">
        <button
          className={`btn ${showPresets ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setShowPresets(!showPresets)}
        >
          Screens
        </button>
        <button
          className={`btn ${showCriteriaPanel ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setShowCriteriaPanel(!showCriteriaPanel)}
        >
          + Criteres
        </button>
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
                style={{ fontSize: "0.75rem" }}
                onClick={() => setShowSave(true)}
              >
                Sauvegarder
              </button>
            )}
          </>
        )}
      </div>

      {/* Presets dropdown panel */}
      {showPresets && (
        <div className="card screener-panel">
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            {/* User presets */}
            <div style={{ flex: 1, minWidth: 250 }}>
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Mes presets
              </h4>
              {userPresets.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Aucun preset sauvegarde</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {userPresets.map((p) => (
                    <button
                      key={p.id}
                      className="preset-item"
                      onClick={() => applyPreset(p.filters, p.sort, p.name)}
                    >
                      <strong>{p.name}</strong>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {Object.keys(p.filters).length} criteres
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Default presets */}
            <div style={{ flex: 1, minWidth: 250 }}>
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Strategies expertes
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {DEFAULT_PRESETS.map((dp) => (
                  <button
                    key={dp.name}
                    className="preset-item"
                    onClick={() => applyPreset(dp.filters as Record<string, unknown>, dp.sort as Record<string, unknown>, dp.name)}
                  >
                    <strong>{dp.name}</strong>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {dp.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Criteria editor panel */}
      {showCriteriaPanel && (
        <div className="card screener-panel">
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="filter-group" style={{ flex: 1, minWidth: 180 }}>
              <label>Critere</label>
              <select
                className="filter-select"
                value={newCriterionKey}
                onChange={(e) => setNewCriterionKey(e.target.value)}
                style={{ width: "100%" }}
              >
                <option value="">-- Choisir --</option>
                {Object.entries(criteriaByCategory).map(([cat, items]) => (
                  <optgroup key={cat} label={cat}>
                    {items.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="filter-group" style={{ width: 120 }}>
              <label>Min</label>
              <input
                className="form-input"
                style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem" }}
                type="number"
                step="any"
                value={newCriterionMin}
                onChange={(e) => setNewCriterionMin(e.target.value)}
                placeholder={CRITERIA_OPTIONS.find((c) => c.key === newCriterionKey)?.hint?.split(" - ")[0]?.replace("ex: ", "") ?? ""}
              />
            </div>
            <div className="filter-group" style={{ width: 120 }}>
              <label>Max</label>
              <input
                className="form-input"
                style={{ padding: "0.375rem 0.5rem", fontSize: "0.8125rem" }}
                type="number"
                step="any"
                value={newCriterionMax}
                onChange={(e) => setNewCriterionMax(e.target.value)}
                placeholder={CRITERIA_OPTIONS.find((c) => c.key === newCriterionKey)?.hint?.split(" - ")[1] ?? ""}
              />
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem" }}
              onClick={addCriterion}
              disabled={!newCriterionKey || (!newCriterionMin.trim() && !newCriterionMax.trim())}
            >
              Ajouter
            </button>
          </div>
          {newCriterionKey && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {CRITERIA_OPTIONS.find((c) => c.key === newCriterionKey)?.isPercent
                ? "Valeurs en decimales (ex: 0.12 = 12%)"
                : CRITERIA_OPTIONS.find((c) => c.key === newCriterionKey)?.isCurrency
                  ? "Valeurs en devise (ex: 1000000000 = 1B)"
                  : "Valeurs en ratio"}
            </div>
          )}
        </div>
      )}

      {/* Filters bar */}
      <div className="filters-bar">
        <div className="filter-group">
          <label>Exchange</label>
          <select className="filter-select" value={exchange} onChange={(e) => { setExchange(e.target.value); resetPage(); }}>
            <option value="">Tous</option>
            {filterOptions?.exchanges.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Secteur</label>
          <select className="filter-select" value={sector} onChange={(e) => { setSector(e.target.value); resetPage(); }}>
            <option value="">Tous</option>
            {filterOptions?.sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Pays</label>
          <select className="filter-select" value={country} onChange={(e) => { setCountry(e.target.value); resetPage(); }}>
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
              let label = criteriaLabel(key);
              if (v && typeof v === "object") {
                const parts: string[] = [];
                if (v.min !== undefined) parts.push(`>=${formatFilterNum(v.min)}`);
                if (v.max !== undefined) parts.push(`<=${formatFilterNum(v.max)}`);
                label = `${criteriaLabel(key)} ${parts.join(" ")}`;
              }
              return (
                <span
                  key={key}
                  className="filter-pill"
                  onClick={() => removeCriterion(key)}
                  title="Cliquer pour retirer"
                >
                  {label} ×
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Alphabet navigation */}
      <div className="alphabet-bar">
        <button
          className={`alphabet-letter ${activeLetter === null ? "alphabet-active" : ""}`}
          onClick={() => { setActiveLetter(null); setCurrentPage(1); }}
        >
          Tous
        </button>
        {ALPHABET.map((letter) => (
          <button
            key={letter}
            className={`alphabet-letter ${activeLetter === letter ? "alphabet-active" : ""}`}
            onClick={() => handleLetterClick(letter)}
          >
            {letter}
          </button>
        ))}
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span>{totalCount.toLocaleString()} actions</span>
          {presetName && (
            <span style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
              {presetName}
            </span>
          )}
          {activeLetter && (
            <span style={{ fontSize: "0.8rem", color: "var(--primary)" }}>
              Lettre: {activeLetter}
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
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          Page {currentPage} / {totalPages || 1}
        </div>
      </div>

      {/* Results table */}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36, padding: "0.5rem 0.25rem" }}></th>
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
                <td style={{ padding: "0.5rem 0.25rem", textAlign: "center" }}>
                  <button
                    className={`bookmark-btn ${bookmarkedIds.has(stock.id) ? "bookmark-active" : ""}`}
                    onClick={() => toggleBookmark(stock.id)}
                    disabled={togglingBookmark === stock.id}
                    title={bookmarkedIds.has(stock.id) ? "Retirer des favoris" : "Ajouter aux favoris"}
                  >
                    {bookmarkedIds.has(stock.id) ? "\u2605" : "\u2606"}
                  </button>
                </td>
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
            {!loading && stocks.length === 0 && (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
                  Aucun resultat pour ces criteres
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {loading && <div className="loading">Chargement...</div>}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="pagination-bar">
          <button
            className="btn btn-ghost pagination-btn"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            Precedent
          </button>
          <div className="pagination-pages">
            {getPageNumbers().map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="pagination-ellipsis">...</span>
              ) : (
                <button
                  key={p}
                  className={`pagination-page ${currentPage === p ? "pagination-page-active" : ""}`}
                  onClick={() => setCurrentPage(p)}
                >
                  {p}
                </button>
              )
            )}
          </div>
          <button
            className="btn btn-ghost pagination-btn"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
