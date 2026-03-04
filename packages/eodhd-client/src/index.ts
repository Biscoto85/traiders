export { EODHDClient, EODHDError } from "./client.js";
export type { EODHDConfig } from "./client.js";

// Re-export endpoint types for consumers
export type { EODHDEodBar, EODHDExchangeSymbol } from "./endpoints/eod.js";
export type {
  EODHDFundamentals,
  EODHDIndexComponent,
  EODHDBalanceSheet,
  EODHDIncomeStatement,
  EODHDCashFlow,
} from "./endpoints/fundamentals.js";
export type { EODHDBulkEodItem } from "./endpoints/bulk.js";
export type {
  EODHDScreenerResult,
  EODHDScreenerFilters,
} from "./endpoints/screener.js";
