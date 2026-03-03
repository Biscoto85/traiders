import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, type StockSummary, type FilterOptions, type Preset } from "@/lib/api";
import { formatMarketCap, formatPercent, formatRatio, DEFAULT_PRESETS } from "@stock-screener/shared";

type SortField = "marketCap" | "peRatio" | "dividendYield" | "lastPrice" | "revenueGrowth" | "ticker" | "qualityScore";
type SortDir = "asc" | "desc";
type FilterLogic = "AND" | "OR";
type Operator = ">" | ">=" | "<" | "<=" | "=" | "entre";

interface RangeVal { min?: number; max?: number; gt?: number; lt?: number }

interface LocationState {
  filters?: Record<string, unknown>;
  sort?: { field: string; direction: string };
}

// Editing state for inline preset editor
interface EditingPresetState {
  id: string;
  name: string;
  filters: Record<string, RangeVal>;
  filterLogic: FilterLogic;
  // temp add-criterion state
  newKey: string;
  newOp: Operator;
  newVal: string;
  newVal2: string;
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
  { key: "revenueCAGR5Y", label: "TCAM revenus 5 ans", category: "Croissance", hint: "ex: 0.15 = 15%/an", isPercent: true },
  // Yield
  { key: "dividendYield", label: "Div. Yield", category: "Rendement", hint: "ex: 0.025", isPercent: true },
  { key: "fcfYield", label: "FCF Yield", category: "Rendement", hint: "ex: 0.05", isPercent: true },
  // Cash-flow & dette
  { key: "operatingCashFlow", label: "CF Operationnel", category: "Cash-flow", isCurrency: true },
  { key: "priceToOCF", label: "Capi / CF Oper.", category: "Cash-flow", hint: "ex: 5 - 25" },
  { key: "netDebt", label: "Dette nette", category: "Cash-flow", isCurrency: true },
  { key: "netDebtToOCF", label: "Dette nette / CF Oper.", category: "Cash-flow", hint: "ex: 0 - 5" },
  { key: "equityToMarketCap", label: "Equity / Capi", category: "Cash-flow", hint: "ex: 0.2 - 1", isPercent: true },
  // Quality
  { key: "qualityScore", label: "Score Qualite", category: "Score", hint: "ex: 60 - 100" },
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

// Geographic zones — group exchanges for quick filtering
const GEOGRAPHIC_ZONES: Record<string, string[]> = {
  "Amerique du Nord": ["US", "TO", "V", "MX"],
  "Europe": ["PA", "AS", "BR", "LI", "LSE", "XETRA", "F", "MI", "MC", "SW", "VI", "OL", "ST", "CO", "HE", "WAR", "AT", "IS"],
  "Asie-Pacifique": ["TSE", "HKEX", "SHG", "SHE", "KO", "TW", "BSE", "NSE", "AU", "NZ", "SG", "BK", "JK", "KL"],
  "Moyen-Orient / Afrique": ["TA", "SAU", "JSE"],
  "Amerique du Sud": ["SA", "SN", "BA"],
};

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAGE_SIZE = 50;

const OPERATOR_LABELS: Record<Operator, string> = {
  ">": ">",
  ">=": ">=",
  "<": "<",
  "<=": "<=",
  "=": "=",
  "entre": "entre",
};

function formatFilterNum(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (Math.abs(n) < 1 && n !== 0) return `${(n * 100).toFixed(0)}%`;
  return n.toLocaleString();
}

function criteriaLabel(key: string): string {
  return CRITERIA_OPTIONS.find((c) => c.key === key)?.label ?? key;
}

/** Infer UI operator from a RangeVal */
function inferOperator(v: RangeVal): Operator {
  if (v.gt !== undefined && v.lt === undefined && v.min === undefined && v.max === undefined) return ">";
  if (v.lt !== undefined && v.gt === undefined && v.min === undefined && v.max === undefined) return "<";
  if (v.min !== undefined && v.max !== undefined) {
    return v.min === v.max ? "=" : "entre";
  }
  if (v.min !== undefined) return ">=";
  if (v.max !== undefined) return "<=";
  return ">=";
}

/** Get the primary display value for a criterion */
function getFilterValue(v: RangeVal): number | undefined {
  return v.gt ?? v.min ?? v.lt ?? v.max;
}

/** Build a RangeVal from operator + value(s) */
function buildRangeVal(op: Operator, val: number, val2?: number): RangeVal {
  switch (op) {
    case ">": return { gt: val };
    case ">=": return { min: val };
    case "<": return { lt: val };
    case "<=": return { max: val };
    case "=": return { min: val, max: val };
    case "entre": return { min: val, max: val2 ?? val };
  }
}

/** Format a RangeVal for display as a pill */
function formatRangeLabel(key: string, v: RangeVal): string {
  const op = inferOperator(v);
  const val = getFilterValue(v);
  const label = criteriaLabel(key);
  if (op === "entre") return `${label} ${formatFilterNum(v.min!)}..${formatFilterNum(v.max!)}`;
  if (op === "=") return `${label} = ${formatFilterNum(val!)}`;
  return `${label} ${op} ${formatFilterNum(val!)}`;
}

/** Group criteria by category, excluding already-used keys */
function groupAvailableCriteria(usedKeys: Set<string>): Record<string, typeof CRITERIA_OPTIONS> {
  const byCategory: Record<string, typeof CRITERIA_OPTIONS> = {};
  for (const c of CRITERIA_OPTIONS) {
    if (usedKeys.has(c.key)) continue;
    if (!byCategory[c.category]) byCategory[c.category] = [];
    byCategory[c.category]!.push(c);
  }
  return byCategory;
}

// ─── Reusable criteria row component ──────────────────────
function CriteriaRow({ filterKey, val, onUpdate, onChangeOp, onRemove }: {
  filterKey: string;
  val: RangeVal;
  onUpdate: (field: "val" | "val2", value: string) => void;
  onChangeOp: (op: Operator) => void;
  onRemove: () => void;
}) {
  const meta = CRITERIA_OPTIONS.find((c) => c.key === filterKey);
  const op = inferOperator(val);

  return (
    <div className="criteria-row">
      <span className="criteria-row-label" title={meta?.hint}>
        {meta?.label ?? filterKey}
        {meta?.isPercent && <span className="criteria-row-hint"> (%)</span>}
        {meta?.isCurrency && <span className="criteria-row-hint"> ($)</span>}
      </span>
      <select
        className="filter-select criteria-row-op"
        value={op}
        onChange={(e) => onChangeOp(e.target.value as Operator)}
      >
        {Object.entries(OPERATOR_LABELS).map(([k, lbl]) => (
          <option key={k} value={k}>{lbl}</option>
        ))}
      </select>
      {op === "entre" ? (
        <div className="criteria-row-inputs">
          <input
            className="form-input criteria-row-input"
            type="number"
            step="any"
            placeholder="Min"
            value={val.min ?? ""}
            onChange={(e) => onUpdate("val", e.target.value)}
          />
          <span className="criteria-row-sep">-</span>
          <input
            className="form-input criteria-row-input"
            type="number"
            step="any"
            placeholder="Max"
            value={val.max ?? ""}
            onChange={(e) => onUpdate("val2", e.target.value)}
          />
        </div>
      ) : (
        <div className="criteria-row-inputs">
          <input
            className="form-input criteria-row-input"
            type="number"
            step="any"
            placeholder="Valeur"
            value={getFilterValue(val) ?? ""}
            onChange={(e) => onUpdate("val", e.target.value)}
          />
        </div>
      )}
      <button className="btn-icon btn-icon-danger" title="Retirer" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

// ─── Reusable add-criterion row ───────────────────────────
function AddCriterionRow({ usedKeys, onAdd }: {
  usedKeys: Set<string>;
  onAdd: (key: string, range: RangeVal) => void;
}) {
  const [newKey, setNewKey] = useState("");
  const [newOp, setNewOp] = useState<Operator>(">=");
  const [newVal, setNewVal] = useState("");
  const [newVal2, setNewVal2] = useState("");

  const criteriaByCategory = groupAvailableCriteria(usedKeys);

  function doAdd() {
    if (!newKey || !newVal.trim()) return;
    const v = parseFloat(newVal);
    if (isNaN(v)) return;
    const v2 = newOp === "entre" ? parseFloat(newVal2) : undefined;
    if (newOp === "entre" && (isNaN(v2 ?? NaN))) return;
    onAdd(newKey, buildRangeVal(newOp, v, v2));
    setNewKey("");
    setNewOp(">=");
    setNewVal("");
    setNewVal2("");
  }

  return (
    <>
      <div className="criteria-row criteria-row-add">
        <div className="filter-group" style={{ flex: 1, minWidth: 160 }}>
          <select
            className="filter-select"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">+ Ajouter un critere...</option>
            {Object.entries(criteriaByCategory).map(([cat, items]) => (
              <optgroup key={cat} label={cat}>
                {items.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {newKey && (
          <>
            <select
              className="filter-select criteria-row-op"
              value={newOp}
              onChange={(e) => setNewOp(e.target.value as Operator)}
            >
              {Object.entries(OPERATOR_LABELS).map(([k, lbl]) => (
                <option key={k} value={k}>{lbl}</option>
              ))}
            </select>
            <div className="criteria-row-inputs">
              <input
                className="form-input criteria-row-input"
                type="number"
                step="any"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                placeholder={CRITERIA_OPTIONS.find((c) => c.key === newKey)?.hint?.split(" - ")[0]?.replace("ex: ", "") ?? "Valeur"}
              />
              {newOp === "entre" && (
                <>
                  <span className="criteria-row-sep">-</span>
                  <input
                    className="form-input criteria-row-input"
                    type="number"
                    step="any"
                    value={newVal2}
                    onChange={(e) => setNewVal2(e.target.value)}
                    placeholder={CRITERIA_OPTIONS.find((c) => c.key === newKey)?.hint?.split(" - ")[1] ?? "Max"}
                  />
                </>
              )}
            </div>
            <button
              className="btn btn-primary"
              style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem", whiteSpace: "nowrap" }}
              onClick={doAdd}
              disabled={!newVal.trim()}
            >
              OK
            </button>
          </>
        )}
      </div>
      {newKey && (
        <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>
          {CRITERIA_OPTIONS.find((c) => c.key === newKey)?.isPercent
            ? "Decimales (ex: 0.12 = 12%)"
            : CRITERIA_OPTIONS.find((c) => c.key === newKey)?.isCurrency
              ? "Devise (ex: 1000000000 = 1B)"
              : "Ratio"}
        </div>
      )}
    </>
  );
}

// ─── Logic toggle component ───────────────────────────────
function LogicToggle({ value, onChange }: { value: FilterLogic; onChange: (v: FilterLogic) => void }) {
  return (
    <div className="logic-toggle">
      <span className="logic-toggle-label">Logique :</span>
      <button
        className={`logic-toggle-btn ${value === "AND" ? "logic-toggle-active" : ""}`}
        onClick={() => onChange("AND")}
      >
        ET
      </button>
      <button
        className={`logic-toggle-btn ${value === "OR" ? "logic-toggle-active" : ""}`}
        onClick={() => onChange("OR")}
      >
        OU
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════════════════════════

export default function ScreenerPage() {
  const location = useLocation();
  const incomingState = location.state as LocationState | null;

  const [stocks, setStocks] = useState<StockSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  // Classification filters (dropdowns)
  const [zone, setZone] = useState("");
  const [exchange, setExchange] = useState("");
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");

  // Range filters + logic
  const [rangeFilters, setRangeFilters] = useState<Record<string, RangeVal>>({});
  const [filterLogic, setFilterLogic] = useState<FilterLogic>("AND");
  const [presetName, setPresetName] = useState<string | null>(null);

  // Sort
  const [sortField, setSortField] = useState<SortField>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination (offset-based)
  const [currentPage, setCurrentPage] = useState(1);

  // Alphabet navigation
  const [activeLetter, setActiveLetter] = useState<string | null>(null);

  // Criteria editor (free screen)
  const [showCriteriaPanel, setShowCriteriaPanel] = useState(false);

  // Presets selector
  const [userPresets, setUserPresets] = useState<Preset[]>([]);
  const [showPresets, setShowPresets] = useState(false);

  // Bookmarks
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [togglingBookmark, setTogglingBookmark] = useState<string | null>(null);

  // Save preset (from free screen)
  const [showSave, setShowSave] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  // Inline preset editing
  const [editingPreset, setEditingPreset] = useState<EditingPresetState | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);

  // Expanded preset (read-only detail)
  const [expandedPreset, setExpandedPreset] = useState<string | null>(null);

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

    if (f.filterLogic) {
      setFilterLogic(f.filterLogic as FilterLogic);
      delete f.filterLogic;
    }

    setRangeFilters(f as Record<string, RangeVal>);
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
      if (exchange) {
        filters.exchanges = [exchange];
      } else if (zone && GEOGRAPHIC_ZONES[zone]) {
        filters.exchanges = GEOGRAPHIC_ZONES[zone];
      }
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];
      if (filterLogic !== "AND") filters.filterLogic = filterLogic;

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
  }, [zone, exchange, sector, country, sortField, sortDir, rangeFilters, filterLogic, currentPage, activeLetter]);

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
    setFilterLogic("AND");
    setPresetName(null);
    setZone("");
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

  // ─── Free-screen criterion operations ──────────────────

  function removeCriterion(key: string) {
    setRangeFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    resetPage();
  }

  function updateCriterionValue(key: string, field: "val" | "val2", value: string) {
    setRangeFilters((prev) => {
      const existing = prev[key] ?? {};
      const op = inferOperator(existing);

      if (value.trim() === "") {
        // Clearing a value
        if (op === "entre") {
          if (field === "val") {
            const updated = { ...existing };
            delete updated.min;
            if (updated.max === undefined) { const next = { ...prev }; delete next[key]; return next; }
            return { ...prev, [key]: updated };
          } else {
            const updated = { ...existing };
            delete updated.max;
            if (updated.min === undefined) { const next = { ...prev }; delete next[key]; return next; }
            return { ...prev, [key]: updated };
          }
        }
        const next = { ...prev };
        delete next[key];
        return next;
      }

      const num = parseFloat(value);
      if (isNaN(num)) return prev;

      if (op === "entre") {
        if (field === "val") return { ...prev, [key]: { ...existing, min: num } };
        return { ...prev, [key]: { ...existing, max: num } };
      }
      // Single-value operators: rebuild from operator
      return { ...prev, [key]: buildRangeVal(op, num) };
    });
    resetPage();
  }

  function changeOperator(key: string, newOp: Operator) {
    setRangeFilters((prev) => {
      const existing = prev[key] ?? {};
      const currentVal = getFilterValue(existing) ?? 0;
      return { ...prev, [key]: buildRangeVal(newOp, currentVal, existing.max ?? currentVal) };
    });
    resetPage();
  }

  function addCriterionToFreeScreen(key: string, range: RangeVal) {
    setRangeFilters((prev) => ({ ...prev, [key]: range }));
    resetPage();
  }

  // ─── Preset operations ─────────────────────────────────

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

    if (f.filterLogic) {
      setFilterLogic(f.filterLogic as FilterLogic);
      delete f.filterLogic;
    } else {
      setFilterLogic("AND");
    }

    setRangeFilters(f as Record<string, RangeVal>);
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

  async function handleSaveNewPreset() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const filters: Record<string, unknown> = { ...rangeFilters };
      if (exchange) filters.exchanges = [exchange];
      if (sector) filters.sectors = [sector];
      if (country) filters.countries = [country];
      if (filterLogic !== "AND") filters.filterLogic = filterLogic;

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

  // ─── Inline preset editing ─────────────────────────────

  function startEditPreset(preset: Preset) {
    const f = { ...preset.filters };
    // Extract non-range keys
    delete f.exchanges;
    delete f.sectors;
    delete f.countries;
    const logic = (f.filterLogic as FilterLogic) ?? "AND";
    delete f.filterLogic;

    setEditingPreset({
      id: preset.id,
      name: preset.name,
      filters: f as Record<string, RangeVal>,
      filterLogic: logic,
      newKey: "",
      newOp: ">=",
      newVal: "",
      newVal2: "",
    });
    setExpandedPreset(null);
  }

  function updateEditingFilter(key: string, field: "val" | "val2", value: string) {
    setEditingPreset((prev) => {
      if (!prev) return prev;
      const existing = prev.filters[key] ?? {};
      const op = inferOperator(existing);

      if (value.trim() === "") {
        if (op === "entre") {
          const updated = { ...existing };
          if (field === "val") delete updated.min; else delete updated.max;
          if (updated.min === undefined && updated.max === undefined) {
            const next = { ...prev.filters };
            delete next[key];
            return { ...prev, filters: next };
          }
          return { ...prev, filters: { ...prev.filters, [key]: updated } };
        }
        const next = { ...prev.filters };
        delete next[key];
        return { ...prev, filters: next };
      }

      const num = parseFloat(value);
      if (isNaN(num)) return prev;

      if (op === "entre") {
        if (field === "val") return { ...prev, filters: { ...prev.filters, [key]: { ...existing, min: num } } };
        return { ...prev, filters: { ...prev.filters, [key]: { ...existing, max: num } } };
      }
      return { ...prev, filters: { ...prev.filters, [key]: buildRangeVal(op, num) } };
    });
  }

  function changeEditingOperator(key: string, newOp: Operator) {
    setEditingPreset((prev) => {
      if (!prev) return prev;
      const existing = prev.filters[key] ?? {};
      const currentVal = getFilterValue(existing) ?? 0;
      return { ...prev, filters: { ...prev.filters, [key]: buildRangeVal(newOp, currentVal, existing.max ?? currentVal) } };
    });
  }

  function removeEditingFilter(key: string) {
    setEditingPreset((prev) => {
      if (!prev) return prev;
      const next = { ...prev.filters };
      delete next[key];
      return { ...prev, filters: next };
    });
  }

  function addEditingCriterion(key: string, range: RangeVal) {
    setEditingPreset((prev) => {
      if (!prev) return prev;
      return { ...prev, filters: { ...prev.filters, [key]: range }, newKey: "", newOp: ">=", newVal: "", newVal2: "" };
    });
  }

  async function saveEditingPreset() {
    if (!editingPreset || !editingPreset.name.trim()) return;
    setSavingPreset(true);
    try {
      const filters: Record<string, unknown> = { ...editingPreset.filters };
      if (editingPreset.filterLogic !== "AND") filters.filterLogic = editingPreset.filterLogic;

      const res = await api.updatePreset(editingPreset.id, {
        name: editingPreset.name.trim(),
        filters,
      });
      setUserPresets((prev) => prev.map((p) => (p.id === editingPreset.id ? res.data : p)));
      setEditingPreset(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSavingPreset(false);
    }
  }

  function applyEditingPreset() {
    if (!editingPreset) return;
    const filters: Record<string, unknown> = { ...editingPreset.filters };
    if (editingPreset.filterLogic !== "AND") filters.filterLogic = editingPreset.filterLogic;
    applyPreset(filters, null, editingPreset.name);
    setEditingPreset(null);
  }

  async function handleDeletePreset(id: string) {
    if (!confirm("Supprimer ce preset ?")) return;
    try {
      await api.deletePreset(id);
      setUserPresets((prev) => prev.filter((p) => p.id !== id));
      if (editingPreset?.id === id) setEditingPreset(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur");
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

  const hasActiveFilters = Object.keys(rangeFilters).length > 0 || exchange || sector || country || zone;

  // Exchanges filtered by zone
  const filteredExchanges = zone
    ? filterOptions?.exchanges.filter((ex) => GEOGRAPHIC_ZONES[zone]?.includes(ex.id)) ?? []
    : filterOptions?.exchanges ?? [];
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const usedKeys = new Set(Object.keys(rangeFilters));

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
      {/* Toolbar */}
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
                  onKeyDown={(e) => e.key === "Enter" && handleSaveNewPreset()}
                />
                <button
                  className="btn btn-primary"
                  style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                  onClick={handleSaveNewPreset}
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
                onClick={() => { setShowSave(true); setSaveName(""); }}
              >
                Sauvegarder
              </button>
            )}
          </>
        )}
      </div>

      {/* ═══ Presets panel ═══ */}
      {showPresets && (
        <div className="card screener-panel">
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            {/* User presets */}
            <div style={{ flex: 1, minWidth: 280 }}>
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Mes presets
              </h4>
              {userPresets.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Aucun preset sauvegarde</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {userPresets.map((p) => (
                    <div key={p.id} className="preset-item-wrapper">
                      {editingPreset?.id === p.id ? (
                        /* ─── Inline editing mode ─── */
                        <div className="preset-item preset-editing">
                          <div className="preset-edit-header">
                            <input
                              className="form-input preset-edit-name"
                              value={editingPreset.name}
                              onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                              placeholder="Nom du preset"
                            />
                            <LogicToggle
                              value={editingPreset.filterLogic}
                              onChange={(v) => setEditingPreset({ ...editingPreset, filterLogic: v })}
                            />
                          </div>

                          {/* Editable criteria rows */}
                          {Object.keys(editingPreset.filters).length > 0 && (
                            <div className="criteria-list">
                              {Object.entries(editingPreset.filters).map(([key, val]) => (
                                <CriteriaRow
                                  key={key}
                                  filterKey={key}
                                  val={val}
                                  onUpdate={(f, v) => updateEditingFilter(key, f, v)}
                                  onChangeOp={(op) => changeEditingOperator(key, op)}
                                  onRemove={() => removeEditingFilter(key)}
                                />
                              ))}
                            </div>
                          )}

                          {/* Add criterion */}
                          <AddCriterionRow
                            usedKeys={new Set(Object.keys(editingPreset.filters))}
                            onAdd={addEditingCriterion}
                          />

                          {/* Action buttons */}
                          <div className="preset-edit-actions">
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: "0.75rem" }}
                              onClick={saveEditingPreset}
                              disabled={savingPreset || !editingPreset.name.trim()}
                            >
                              Sauvegarder
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: "0.75rem" }}
                              onClick={applyEditingPreset}
                            >
                              Appliquer
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: "0.75rem" }}
                              onClick={() => setEditingPreset(null)}
                            >
                              Annuler
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ─── Read-only mode ─── */
                        <div className="preset-item" style={{ cursor: "default" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                            <div style={{ flex: 1, cursor: "pointer" }} onClick={() => applyPreset(p.filters, p.sort, p.name)}>
                              <strong>{p.name}</strong>
                              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "0.5rem" }}>
                                {Object.keys(p.filters).filter((k) => k !== "filterLogic").length} criteres
                                {(p.filters as Record<string, unknown>).filterLogic === "OR" && " (OU)"}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: "0.25rem", flexShrink: 0 }}>
                              <button
                                className="btn-icon"
                                title="Voir les criteres"
                                onClick={(e) => { e.stopPropagation(); setExpandedPreset(expandedPreset === p.id ? null : p.id); }}
                              >
                                {expandedPreset === p.id ? "\u25B2" : "\u25BC"}
                              </button>
                              <button
                                className="btn-icon"
                                title="Editer"
                                onClick={(e) => { e.stopPropagation(); startEditPreset(p); }}
                              >
                                ✎
                              </button>
                              <button
                                className="btn-icon btn-icon-danger"
                                title="Supprimer"
                                onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.id); }}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          {expandedPreset === p.id && (
                            <div className="preset-criteria">
                              {Object.entries(p.filters)
                                .filter(([key]) => key !== "filterLogic")
                                .map(([key, val]) => {
                                  const v = val as RangeVal | string[];
                                  if (Array.isArray(v)) {
                                    return <span key={key} className="filter-pill">{key}: {v.join(", ")}</span>;
                                  }
                                  return <span key={key} className="filter-pill">{formatRangeLabel(key, v)}</span>;
                                })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Default presets */}
            <div style={{ flex: 1, minWidth: 280 }}>
              <h4 style={{ marginBottom: "0.5rem", color: "var(--text-muted)", fontSize: "0.8rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Strategies expertes
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {DEFAULT_PRESETS.map((dp) => (
                  <div key={dp.name} className="preset-item-wrapper">
                    <div className="preset-item" style={{ cursor: "default" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                        <div style={{ flex: 1, cursor: "pointer" }} onClick={() => applyPreset(dp.filters as Record<string, unknown>, dp.sort as Record<string, unknown>, dp.name)}>
                          <strong>{dp.name}</strong>
                        </div>
                        <button
                          className="btn-icon"
                          title="Voir les criteres"
                          onClick={(e) => { e.stopPropagation(); setExpandedPreset(expandedPreset === dp.name ? null : dp.name); }}
                        >
                          {expandedPreset === dp.name ? "\u25B2" : "\u25BC"}
                        </button>
                      </div>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {dp.description}
                      </span>
                      {expandedPreset === dp.name && (
                        <div className="preset-criteria">
                          {Object.entries(dp.filters).map(([key, val]) => {
                            const v = val as RangeVal;
                            return <span key={key} className="filter-pill">{formatRangeLabel(key, v)}</span>;
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Free screen criteria editor ═══ */}
      {showCriteriaPanel && (
        <div className="card screener-panel">
          <LogicToggle value={filterLogic} onChange={(v) => { setFilterLogic(v); resetPage(); }} />

          {/* Active criteria — editable rows */}
          {Object.keys(rangeFilters).length > 0 && (
            <div className="criteria-list" style={{ marginTop: "0.75rem" }}>
              {Object.entries(rangeFilters).map(([key, val]) => (
                <CriteriaRow
                  key={key}
                  filterKey={key}
                  val={val}
                  onUpdate={(f, v) => updateCriterionValue(key, f, v)}
                  onChangeOp={(op) => changeOperator(key, op)}
                  onRemove={() => removeCriterion(key)}
                />
              ))}
            </div>
          )}

          {/* Add new criterion */}
          <div style={{ marginTop: "0.5rem" }}>
            <AddCriterionRow usedKeys={usedKeys} onAdd={addCriterionToFreeScreen} />
          </div>
        </div>
      )}

      {/* Filters bar */}
      <div className="filters-bar">
        <div className="filter-group">
          <label>Zone</label>
          <select className="filter-select" value={zone} onChange={(e) => { setZone(e.target.value); setExchange(""); resetPage(); }}>
            <option value="">Toutes</option>
            {Object.keys(GEOGRAPHIC_ZONES).map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label>Exchange</label>
          <select className="filter-select" value={exchange} onChange={(e) => { setExchange(e.target.value); resetPage(); }}>
            <option value="">{zone ? `Tous (${zone})` : "Tous"}</option>
            {filteredExchanges.map((ex) => (
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
            {filterLogic === "OR" && Object.keys(rangeFilters).length > 1 && (
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>OU</span>
            )}
            {Object.entries(rangeFilters).map(([key, val]) => (
              <span
                key={key}
                className="filter-pill"
                onClick={() => removeCriterion(key)}
                title="Cliquer pour retirer"
              >
                {formatRangeLabel(key, val)} ×
              </span>
            ))}
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
              <th className="text-right" onClick={() => handleSort("qualityScore")} title="Score Qualite Pikpik (0-100)">Score{sortIndicator("qualityScore")}</th>
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
                <td className="text-right">
                  {stock.qualityScore != null ? (
                    <span style={{
                      fontWeight: 600,
                      color: stock.qualityScore >= 70 ? "var(--success)" : stock.qualityScore >= 45 ? "var(--warning)" : "var(--danger)",
                    }}>
                      {stock.qualityScore}
                    </span>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {!loading && stocks.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
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
