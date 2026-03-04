/**
 * Pikpik Investment Score — composite 0-100.
 *
 * Reflects the "Pikpik investment fund" philosophy:
 *
 *   1. Croissance  (Growth)         — TCAM CA 5Y, revenue growth YoY   (0-20)
 *   2. Valorisation (Valuation)     — Capi / CF opérationnel           (0-20)
 *   3. Endettement  (Leverage)      — Dette nette / CF opérationnel    (0-20)
 *   4. Valeur       (Intrinsic)     — Equity / Capitalisation          (0-20)
 *   5. Rentabilite  (Profitability) — ROE + Net Margin                 (0-20)
 *
 * Minimum 2 categories required (down from 3) to avoid excluding
 * stocks where only a few data points are available.
 */

export interface StockMetrics {
  revenueCAGR5Y?: number | null;
  revenueGrowth?: number | null;
  earningsGrowth?: number | null;
  priceToOCF?: number | null;
  netDebtToOCF?: number | null;
  equityToMarketCap?: number | null;
  roe?: number | null;
  netMargin?: number | null;
}

function scoreUp(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  const [t3, t6, t8, t10] = thresholds;
  if (value >= t10) return 10;
  if (value >= t8) return 8;
  if (value >= t6) return 6;
  if (value >= t3) return 3;
  return 0;
}

function scoreDown(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  if (value == null || isNaN(value)) return null;
  const [t10, t8, t6, t3] = thresholds;
  if (value <= t10) return 10;
  if (value <= t8) return 8;
  if (value <= t6) return 6;
  if (value <= t3) return 3;
  return 0;
}

/**
 * Score Capi / CF opérationnel — the investor's main valuation metric.
 *
 * His mental model:
 *   ≤7x  = anomaly, "all in" (Meta in 2022)
 *   ~10x = very cheap (no-growth like Total)
 *   ~15x = fair value
 *   ~25x = acceptable for growth companies
 *   >30x = dangerous
 */
function scorePriceToOCF(v: number | null | undefined): number | null {
  if (v == null || isNaN(v)) return null;
  if (v <= 0) return 0;    // Negative OCF = bad sign
  if (v <= 7) return 10;   // Anomaly — all in
  if (v <= 12) return 8;   // Cheap
  if (v <= 20) return 6;   // Fair
  if (v <= 30) return 3;   // Expensive
  return 0;                // Dangerous
}

/**
 * Score Dette nette / CF opérationnel.
 *
 * His rule: should not exceed 3-5x OCF.
 * Negative net debt (net cash) = perfect score.
 */
function scoreNetDebtToOCF(v: number | null | undefined): number | null {
  if (v == null || isNaN(v)) return null;
  if (v < 0) return 10;    // Net cash position = excellent
  if (v <= 1) return 10;   // Very low leverage
  if (v <= 2) return 8;    // Comfortable
  if (v <= 3) return 6;    // Acceptable
  if (v <= 5) return 3;    // Risky
  return 0;                // Avoid
}

export function computeQualityScore(metrics: StockMetrics): number | null {
  const categories: Array<{ score: number; max: number }> = [];

  // ── 1. Croissance (Growth) ──────────────────────────────────
  // Priority: TCAM 5Y > revenueGrowth YoY > earningsGrowth
  // Uses the best available data — doesn't require 5 years.
  const cagr5 = scoreUp(metrics.revenueCAGR5Y, [0.05, 0.10, 0.15, 0.25]);
  const revG = scoreUp(metrics.revenueGrowth, [0.05, 0.10, 0.15, 0.25]);
  const earnG = scoreUp(metrics.earningsGrowth, [0.05, 0.10, 0.15, 0.25]);
  // Pick best available: CAGR 5Y is preferred, then YoY growth
  const growthScore = cagr5 ?? revG ?? earnG;
  if (growthScore != null) {
    categories.push({ score: growthScore * 2, max: 20 });
  }

  // ── 2. Valorisation (Capi / CF opérationnel) ───────────────
  // The investor's PRIMARY indicator.
  const priceOcfScore = scorePriceToOCF(metrics.priceToOCF);
  if (priceOcfScore != null) {
    categories.push({ score: priceOcfScore * 2, max: 20 });
  }

  // ── 3. Endettement (Dette nette / CF opérationnel) ─────────
  const debtScore = scoreNetDebtToOCF(metrics.netDebtToOCF);
  if (debtScore != null) {
    categories.push({ score: debtScore * 2, max: 20 });
  }

  // ── 4. Valeur intrinsèque (Equity / Capitalisation) ────────
  // Higher = more asset backing per euro of market cap.
  // Typical range: 0.1 (tech) to 1.0+ (value traps or beaten-down).
  const eqScore = scoreUp(metrics.equityToMarketCap, [0.15, 0.30, 0.50, 0.80]);
  if (eqScore != null) {
    categories.push({ score: eqScore * 2, max: 20 });
  }

  // ── 5. Rentabilité (ROE + Net Margin) ──────────────────────
  // Confirms business quality — high margins + high ROE = durable advantage.
  const roeScore = scoreUp(metrics.roe, [0.05, 0.10, 0.15, 0.20]);
  const marginScore = scoreUp(metrics.netMargin, [0.05, 0.10, 0.15, 0.20]);
  if (roeScore != null || marginScore != null) {
    const s = (roeScore ?? 0) + (marginScore ?? 0);
    const w = (roeScore != null ? 1 : 0) + (marginScore != null ? 1 : 0);
    categories.push({ score: (s / w) * 2, max: 20 });
  }

  // Need at least 2 categories (relaxed from 3) to be inclusive
  if (categories.length < 2) return null;

  const totalScore = categories.reduce((sum, c) => sum + c.score, 0);
  const totalMax = categories.reduce((sum, c) => sum + c.max, 0);
  return Math.round((totalScore / totalMax) * 100);
}
