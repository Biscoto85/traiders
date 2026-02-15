// ─── Generic API Response ───────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    totalCount: number;
    nextCursor: string | null;
    prevCursor: string | null;
    limit: number;
  };
}

// ─── Error Codes ────────────────────────────────────────

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface ApiError {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

// ─── Sync Status ────────────────────────────────────────

export interface SyncStatus {
  job: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  tickersProcessed: number;
  nextRunAt: Date | null;
}
