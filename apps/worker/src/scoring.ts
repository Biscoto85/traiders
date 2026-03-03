/**
 * Pikpik Quality Score — composite 0-100 score.
 *
 * 5 categories, each 0-20:
 *   1. Rentabilite (Profitability)  — ROE + Net Margin
 *   2. Croissance  (Growth)         — Revenue Growth + CAGR 5Y
 *   3. Sante       (Financial Health)— Debt/Equity + Current Ratio
 *   4. Valorisation (Valuation)     — P/E + FCF Yield
 *   5. Cash Flow                    — Price/OCF + Net Debt/OCF
 *
 * Each sub-metric is scored 0-10 with stepped thresholds.
 * Returns null if insufficient data (< 3 sub-metrics available).
 */

interface StockMetrics {
  roe?: number | null;
  netMargin?: number | null;
  revenueGrowth?: number | null;
  revenueCAGR5Y?: number | null;
  earningsGrowth?: number | null;
  debtToEquity?: number | null;
  currentRatio?: number | null;
  peRatio?: number | null;
  fcfYield?: number | null;
  priceToOCF?: number | null;
  netDebtToOCF?: number | null;
}

function scoreUp(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  // Higher is better: score increases as value crosses thresholds
  if (value == null || isNaN(value)) return null;
  const [t3, t6, t8, t10] = thresholds;
  if (value >= t10) return 10;
  if (value >= t8) return 8;
  if (value >= t6) return 6;
  if (value >= t3) return 3;
  return 0;
}

function scoreDown(value: number | null | undefined, thresholds: [number, number, number, number]): number | null {
  // Lower is better: score increases as value drops below thresholds
  if (value == null || isNaN(value)) return null;
  const [t10, t8, t6, t3] = thresholds;
  if (value <= t10) return 10;
  if (value <= t8) return 8;
  if (value <= t6) return 6;
  if (value <= t3) return 3;
  return 0;
}

function scorePeRatio(pe: number | null | undefined): number | null {
  if (pe == null || isNaN(pe)) return null;
  if (pe <= 0) return 0;             // Negative earnings
  if (pe <= 10) return 10;
  if (pe <= 15) return 8;
  if (pe <= 20) return 6;
  if (pe <= 30) return 3;
  return 0;
}

export function computeQualityScore(metrics: StockMetrics): number | null {
  const scores: Array<{ score: number; weight: number }> = [];
  let totalAvailable = 0;

  // 1. Rentabilite
  const roe = scoreUp(metrics.roe, [0.05, 0.10, 0.15, 0.20]);
  const margin = scoreUp(metrics.netMargin, [0.05, 0.10, 0.15, 0.20]);
  if (roe != null || margin != null) {
    const s = (roe ?? 0) + (margin ?? 0);
    const w = (roe != null ? 1 : 0) + (margin != null ? 1 : 0);
    scores.push({ score: (s / w) * 2, weight: 20 }); // Normalize to 0-20
    totalAvailable++;
  }

  // 2. Croissance
  const revGrowth = scoreUp(metrics.revenueGrowth, [0.05, 0.10, 0.15, 0.25]);
  const cagr = scoreUp(metrics.revenueCAGR5Y ?? metrics.earningsGrowth, [0.03, 0.08, 0.12, 0.20]);
  if (revGrowth != null || cagr != null) {
    const s = (revGrowth ?? 0) + (cagr ?? 0);
    const w = (revGrowth != null ? 1 : 0) + (cagr != null ? 1 : 0);
    scores.push({ score: (s / w) * 2, weight: 20 });
    totalAvailable++;
  }

  // 3. Sante financiere
  const debtEq = scoreDown(metrics.debtToEquity, [0.3, 0.5, 1.0, 2.0]);
  const curRatio = scoreUp(metrics.currentRatio, [1.0, 1.2, 1.5, 2.0]);
  if (debtEq != null || curRatio != null) {
    const s = (debtEq ?? 0) + (curRatio ?? 0);
    const w = (debtEq != null ? 1 : 0) + (curRatio != null ? 1 : 0);
    scores.push({ score: (s / w) * 2, weight: 20 });
    totalAvailable++;
  }

  // 4. Valorisation
  const pe = scorePeRatio(metrics.peRatio);
  const fcfY = scoreUp(metrics.fcfYield, [0.01, 0.03, 0.05, 0.08]);
  if (pe != null || fcfY != null) {
    const s = (pe ?? 0) + (fcfY ?? 0);
    const w = (pe != null ? 1 : 0) + (fcfY != null ? 1 : 0);
    scores.push({ score: (s / w) * 2, weight: 20 });
    totalAvailable++;
  }

  // 5. Cash Flow
  const pOcf = scoreDown(metrics.priceToOCF, [8, 12, 18, 25]);
  let ndOcf = scoreDown(metrics.netDebtToOCF, [1, 2, 3, 5]);
  // Net cash (negative net debt) = perfect score
  if (metrics.netDebtToOCF != null && metrics.netDebtToOCF < 0) ndOcf = 10;
  if (pOcf != null || ndOcf != null) {
    const s = (pOcf ?? 0) + (ndOcf ?? 0);
    const w = (pOcf != null ? 1 : 0) + (ndOcf != null ? 1 : 0);
    scores.push({ score: (s / w) * 2, weight: 20 });
    totalAvailable++;
  }

  // Need at least 3 categories to compute a meaningful score
  if (totalAvailable < 3) return null;

  // Weighted average, scaled to 0-100
  const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  return Math.round((totalScore / totalWeight) * 100);
}
