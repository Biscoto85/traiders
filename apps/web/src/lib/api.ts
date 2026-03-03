const API_BASE = "/api/v1";

function getToken(): string | null {
  return localStorage.getItem("token");
}

export function setToken(token: string): void {
  localStorage.setItem("token", token);
}

export function clearToken(): void {
  localStorage.removeItem("token");
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };

  // Only set Content-Type when there's a body (avoids Fastify 400 on empty DELETE)
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `Request failed: ${response.status}`);
  }

  return data;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ success: true; data: { user: User; token: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, name: string) =>
    request<{ success: true; data: { user: User; token: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    }),

  me: () =>
    request<{ success: true; data: User }>("/auth/me"),

  // Screener
  screener: (body: ScreenerRequest) =>
    request<ScreenerApiResponse>("/screener", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Stocks
  stock: (ticker: string, exchange?: string) =>
    request<{ success: true; data: StockDetail }>(
      `/stocks/${ticker}${exchange ? `?exchange=${exchange}` : ""}`,
    ),

  prices: (ticker: string, query?: { from?: string; to?: string; exchange?: string }) => {
    const params = new URLSearchParams();
    if (query?.from) params.set("from", query.from);
    if (query?.to) params.set("to", query.to);
    if (query?.exchange) params.set("exchange", query.exchange);
    const qs = params.toString();
    return request<{ success: true; data: PriceBar[] }>(
      `/stocks/${ticker}/prices${qs ? `?${qs}` : ""}`,
    );
  },

  fundamentals: (ticker: string, query?: { type?: string; limit?: number; exchange?: string }) => {
    const params = new URLSearchParams();
    if (query?.type) params.set("type", query.type);
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.exchange) params.set("exchange", query.exchange);
    const qs = params.toString();
    return request<{ success: true; data: FundamentalPeriod[] }>(
      `/stocks/${ticker}/fundamentals${qs ? `?${qs}` : ""}`,
    );
  },

  // Filters
  filterOptions: () =>
    request<{ success: true; data: FilterOptions }>("/filters/options"),

  // Presets
  presets: () =>
    request<{ success: true; data: Preset[] }>("/presets"),

  createPreset: (body: { name: string; filters: Record<string, unknown>; sort?: Record<string, unknown>; isPublic?: boolean }) =>
    request<{ success: true; data: Preset }>("/presets", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deletePreset: (id: string) =>
    request<{ success: true; data: null }>(`/presets/${id}`, { method: "DELETE" }),

  // Email digests
  emailDigests: () =>
    request<{ success: true; data: EmailDigest[] }>("/email-digests"),

  createEmailDigest: (body: { name: string; filters: Record<string, unknown>; schedule?: string }) =>
    request<{ success: true; data: EmailDigest }>("/email-digests", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateEmailDigest: (id: string, body: { name?: string; filters?: Record<string, unknown>; schedule?: string; isActive?: boolean }) =>
    request<{ success: true; data: EmailDigest }>(`/email-digests/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteEmailDigest: (id: string) =>
    request<{ success: true; data: null }>(`/email-digests/${id}`, { method: "DELETE" }),

  // Presets update
  updatePreset: (id: string, body: { name?: string; filters?: Record<string, unknown>; sort?: Record<string, unknown>; isPublic?: boolean }) =>
    request<{ success: true; data: Preset }>(`/presets/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // Bookmarks
  bookmarkIds: () =>
    request<{ success: true; data: string[] }>("/bookmarks/ids"),

  bookmarks: () =>
    request<{ success: true; data: BookmarkedStock[] }>("/bookmarks"),

  addBookmark: (stockId: string) =>
    request<{ success: true; data: { id: string; stockId: string } }>(`/bookmarks/${stockId}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  removeBookmark: (stockId: string) =>
    request<{ success: true; data: null }>(`/bookmarks/${stockId}`, { method: "DELETE" }),

  // Admin
  adminUsers: () =>
    request<{ success: true; data: AdminUser[] }>("/admin/users"),

  adminCreateUser: (body: { email: string; password: string; name: string; role?: string }) =>
    request<{ success: true; data: AdminUser }>("/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  adminUpdateUser: (id: string, body: { name?: string; role?: string; isActive?: boolean; password?: string }) =>
    request<{ success: true; data: AdminUser }>(`/admin/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  adminDeleteUser: (id: string) =>
    request<{ success: true; data: null }>(`/admin/users/${id}`, { method: "DELETE" }),

  adminSyncStatus: () =>
    request<{ success: true; data: SyncJob[]; pendingSync: string | null }>("/admin/sync-status"),

  adminTriggerSync: (jobName: string) =>
    request<{ success: true; data: { message: string; jobName: string } }>(`/admin/sync-trigger/${jobName}`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  adminAbortSync: () =>
    request<{ success: true; data: { message: string } }>("/admin/sync-abort", {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // Admin config
  adminGetConfig: () =>
    request<{ success: true; data: Record<string, string> }>("/admin/config"),

  adminUpdateConfig: (key: string, value: string) =>
    request<{ success: true; data: { key: string; value: string; updatedAt: string } }>("/admin/config", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    }),
};

// ─── Types ──────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt?: string;
}

export interface StockSummary {
  id: string;
  ticker: string;
  exchangeId: string;
  name: string;
  sector: string | null;
  industry: string | null;
  currency: string;
  lastPrice: number | null;
  lastVolume: string | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  revenueGrowth: number | null;
  week52High: number | null;
  week52Low: number | null;
  beta: number | null;
  qualityScore: number | null;
}

export interface StockDetail extends StockSummary {
  forwardPe: number | null;
  pegRatio: number | null;
  eps: number | null;
  dilutedEps: number | null;
  earningsGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  roa: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  evToEbitda: number | null;
  evToRevenue: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  enterpriseValue: number | null;
  ebitda: number | null;
  freeCashFlow: number | null;
  fcfYield: number | null;
  operatingCashFlow: number | null;
  totalDebt: number | null;
  cashAndEquiv: number | null;
  totalEquity: number | null;
  netDebt: number | null;
  priceToOCF: number | null;
  netDebtToOCF: number | null;
  equityToMarketCap: number | null;
  revenueCAGR5Y: number | null;
  targetPrice: number | null;
  pctInsiders: number | null;
  pctInstitutions: number | null;
  shortPctFloat: number | null;
  pctFrom52WeekHigh: number | null;
  pctFrom52WeekLow: number | null;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: string;
}

export interface FundamentalPeriod {
  id: string;
  period: string;
  type: string;
  date: string;
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  ebitda: number | null;
  totalAssets: number | null;
  totalDebt: number | null;
  totalEquity: number | null;
  cashAndEquiv: number | null;
  operatingCF: number | null;
  freeCashFlow: number | null;
}

export interface FilterOptions {
  sectors: string[];
  industries: string[];
  exchanges: Array<{ id: string; name: string; country: string }>;
  countries: string[];
}

export interface ScreenerRequest {
  filters: Record<string, unknown>;
  sort?: { field: string; direction: "asc" | "desc" };
  cursor?: string;
  offset?: number;
  limit?: number;
  tickerStartsWith?: string;
}

export interface ScreenerApiResponse {
  success: true;
  data: StockSummary[];
  pagination: {
    totalCount: number;
    nextCursor: string | null;
    limit: number;
  };
  appliedFilters: Record<string, unknown>;
}

export interface Preset {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown> | null;
  isPublic: boolean;
  userId: string;
  user?: { name: string };
  createdAt: string;
}

export interface EmailDigest {
  id: string;
  name: string;
  filters: Record<string, unknown>;
  schedule: string;
  isActive: boolean;
  lastSentAt: string | null;
  createdAt: string;
}

export interface BookmarkedStock {
  id: string;
  stockId: string;
  createdAt: string;
  stock: {
    id: string;
    ticker: string;
    exchangeId: string;
    name: string;
    sector: string | null;
    industry: string | null;
    lastPrice: number | null;
    marketCap: number | null;
    peRatio: number | null;
    dividendYield: number | null;
    revenueGrowth: number | null;
  };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { presets: number; emailDigests: number };
}

export interface SyncJob {
  jobName: string;
  lastRunAt: string | null;
  status: string;
  details: string | null;
  updatedAt: string;
}
