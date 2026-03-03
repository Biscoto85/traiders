/**
 * Default screening presets — expert financial criteria.
 * Each preset targets a specific investment strategy.
 */
export const DEFAULT_PRESETS = [
  {
    name: "Value + Quality",
    description: "Entreprises sous-valorisees avec une rentabilite solide et un endettement maitrise",
    filters: {
      peRatio: { min: 3, max: 20 },
      pbRatio: { max: 3 },
      roe: { min: 0.12 },
      netMargin: { min: 0.08 },
      debtToEquity: { max: 1.5 },
      marketCap: { min: 500_000_000 },
      currentRatio: { min: 1.2 },
    },
    sort: { field: "roe" as const, direction: "desc" as const },
  },
  {
    name: "GARP (Growth at a Reasonable Price)",
    description: "Croissance soutenue sans survalorisation — PEG < 1.5, marges en hausse",
    filters: {
      pegRatio: { min: 0.1, max: 1.5 },
      revenueGrowth: { min: 0.10 },
      earningsGrowth: { min: 0.08 },
      netMargin: { min: 0.05 },
      debtToEquity: { max: 2 },
      marketCap: { min: 1_000_000_000 },
    },
    sort: { field: "earningsGrowth" as const, direction: "desc" as const },
  },
  {
    name: "Deep Value (Ben Graham)",
    description: "Approach classique Graham — sous la valeur comptable, P/E bas, tresorerie solide",
    filters: {
      peRatio: { min: 1, max: 12 },
      pbRatio: { max: 1.5 },
      currentRatio: { min: 1.5 },
      debtToEquity: { max: 0.5 },
      marketCap: { min: 100_000_000 },
    },
    sort: { field: "pbRatio" as const, direction: "asc" as const },
  },
  {
    name: "Dividend Aristocrats",
    description: "Rendement dividende eleve, profits stables, entreprises matures",
    filters: {
      dividendYield: { min: 0.025 },
      peRatio: { min: 5, max: 25 },
      netMargin: { min: 0.05 },
      debtToEquity: { max: 2 },
      marketCap: { min: 2_000_000_000 },
      roe: { min: 0.08 },
    },
    sort: { field: "dividendYield" as const, direction: "desc" as const },
  },
  {
    name: "Free Cash Flow Machines",
    description: "Generateurs de cash — FCF yield eleve, marges solides, faible endettement",
    filters: {
      fcfYield: { min: 0.05 },
      operatingMargin: { min: 0.12 },
      debtToEquity: { max: 1.5 },
      marketCap: { min: 500_000_000 },
      roe: { min: 0.10 },
    },
    sort: { field: "fcfYield" as const, direction: "desc" as const },
  },
  {
    name: "Decote 52 semaines",
    description: "Actions 15-40% sous leur plus haut 52s, fondamentaux intacts",
    filters: {
      pctFrom52WeekHigh: { min: -0.40, max: -0.15 },
      peRatio: { min: 3, max: 25 },
      netMargin: { min: 0.05 },
      revenueGrowth: { min: 0 },
      marketCap: { min: 1_000_000_000 },
    },
    sort: { field: "pctFrom52WeekHigh" as const, direction: "asc" as const },
  },
  {
    name: "Small Cap Value",
    description: "Petites capitalisations sous-evaluees avec marges solides",
    filters: {
      marketCap: { min: 100_000_000, max: 2_000_000_000 },
      peRatio: { min: 2, max: 15 },
      roe: { min: 0.10 },
      debtToEquity: { max: 1 },
      netMargin: { min: 0.06 },
    },
    sort: { field: "marketCap" as const, direction: "asc" as const },
  },
  {
    name: "EV/EBITDA Bargains",
    description: "Entreprises peu cheres en valeur d'entreprise par rapport a leur EBITDA",
    filters: {
      evToEbitda: { min: 1, max: 8 },
      operatingMargin: { min: 0.10 },
      debtToEquity: { max: 2 },
      marketCap: { min: 300_000_000 },
    },
    sort: { field: "evToEbitda" as const, direction: "asc" as const },
  },
  {
    name: "Pikpik Investment Fund",
    description: "Anomalies de valorisation via CF operationnel, dette nette et croissance 5 ans — methode Pikpik",
    filters: {
      priceToOCF: { max: 25 },
      netDebtToOCF: { max: 5 },
      revenueCAGR5Y: { min: 0.05 },
      equityToMarketCap: { min: 0.10 },
      marketCap: { min: 500_000_000 },
    },
    sort: { field: "priceToOCF" as const, direction: "asc" as const },
  },
] as const;
