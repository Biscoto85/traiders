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
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };

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

  // Filters
  filterOptions: () =>
    request<{ success: true; data: FilterOptions }>("/filters/options"),
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
}

export interface StockDetail extends StockSummary {
  forwardPe: number | null;
  pegRatio: number | null;
  eps: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null;
  debtToEquity: number | null;
  evToEbitda: number | null;
  pbRatio: number | null;
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
  limit?: number;
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
