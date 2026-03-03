import type { PrismaClient } from "@prisma/client";
import { createTransport, type Transporter } from "nodemailer";

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/**
 * Metric label mapping for readable email/UI display.
 */
const METRIC_LABELS: Record<string, string> = {
  lastPrice: "Prix",
  marketCap: "Capitalisation",
  peRatio: "P/E Ratio",
  forwardPe: "Forward P/E",
  pegRatio: "PEG Ratio",
  pbRatio: "P/B Ratio",
  psRatio: "P/S Ratio",
  evToEbitda: "EV/EBITDA",
  evToRevenue: "EV/Revenue",
  dividendYield: "Rendement div.",
  revenueGrowth: "Croissance CA",
  earningsGrowth: "Croissance benefice",
  grossMargin: "Marge brute",
  operatingMargin: "Marge operationnelle",
  netMargin: "Marge nette",
  roe: "ROE",
  roa: "ROA",
  debtToEquity: "Debt/Equity",
  currentRatio: "Current Ratio",
  fcfYield: "FCF Yield",
  beta: "Beta",
  qualityScore: "Score Qualite",
};

function formatValue(metric: string, value: number): string {
  const pctMetrics = [
    "dividendYield", "revenueGrowth", "earningsGrowth",
    "grossMargin", "operatingMargin", "netMargin", "roe", "roa", "fcfYield",
  ];
  if (pctMetrics.includes(metric)) {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (metric === "marketCap") {
    if (value >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  }
  if (metric === "qualityScore") return String(Math.round(value));
  return value.toFixed(2);
}

/**
 * Check all active, non-triggered alerts against current stock data.
 * Sends email notifications for triggered alerts.
 */
export async function runCheckAlerts(
  prisma: PrismaClient,
  mailConfig: MailConfig,
  appUrl = "http://localhost:5173",
): Promise<void> {
  const jobName = "check-alerts";
  console.log(`[${jobName}] Checking alerts...`);

  const alerts = await prisma.alert.findMany({
    where: { isActive: true, isTriggered: false },
    include: {
      stock: {
        select: {
          ticker: true,
          exchangeId: true,
          name: true,
          lastPrice: true,
          marketCap: true,
          peRatio: true,
          forwardPe: true,
          pegRatio: true,
          pbRatio: true,
          psRatio: true,
          evToEbitda: true,
          evToRevenue: true,
          dividendYield: true,
          revenueGrowth: true,
          earningsGrowth: true,
          grossMargin: true,
          operatingMargin: true,
          netMargin: true,
          roe: true,
          roa: true,
          debtToEquity: true,
          currentRatio: true,
          fcfYield: true,
          beta: true,
          qualityScore: true,
        },
      },
      user: {
        select: { email: true, name: true, isActive: true },
      },
    },
  });

  if (alerts.length === 0) {
    console.log(`[${jobName}] No active alerts to check`);
    return;
  }

  let mailer: Transporter | null = null;
  if (mailConfig.host) {
    mailer = createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      auth: { user: mailConfig.user, pass: mailConfig.pass },
    });
  }

  let triggered = 0;
  let emailsSent = 0;

  // Group alerts by user for batched email
  const triggeredByUser = new Map<string, Array<{
    alertId: string;
    ticker: string;
    exchangeId: string;
    stockName: string;
    metric: string;
    operator: string;
    threshold: number;
    currentValue: number;
    userEmail: string;
    userName: string;
  }>>();

  for (const alert of alerts) {
    if (!alert.user.isActive) continue;

    // Get current value for the metric
    const currentValue = (alert.stock as Record<string, unknown>)[alert.metric] as number | null;
    if (currentValue == null) continue;

    // Check condition
    const isTriggered =
      (alert.operator === "above" && currentValue >= alert.threshold) ||
      (alert.operator === "below" && currentValue <= alert.threshold);

    if (!isTriggered) continue;

    // Mark as triggered
    await prisma.alert.update({
      where: { id: alert.id },
      data: { isTriggered: true, lastTriggeredAt: new Date() },
    });

    triggered++;

    // Collect for email
    const existing = triggeredByUser.get(alert.userId) ?? [];
    existing.push({
      alertId: alert.id,
      ticker: alert.stock.ticker,
      exchangeId: alert.stock.exchangeId,
      stockName: alert.stock.name,
      metric: alert.metric,
      operator: alert.operator,
      threshold: alert.threshold,
      currentValue,
      userEmail: alert.user.email,
      userName: alert.user.name,
    });
    triggeredByUser.set(alert.userId, existing);
  }

  // Send emails (one per user with all triggered alerts)
  if (mailer && triggeredByUser.size > 0) {
    for (const [, userAlerts] of triggeredByUser) {
      try {
        const { userEmail, userName } = userAlerts[0]!;

        const rows = userAlerts.map((a) => {
          const label = METRIC_LABELS[a.metric] ?? a.metric;
          const op = a.operator === "above" ? "≥" : "≤";
          const stockUrl = `${appUrl}/stock/${encodeURIComponent(a.ticker)}?exchange=${encodeURIComponent(a.exchangeId)}`;
          return `
            <tr>
              <td style="padding:6px 8px"><a href="${stockUrl}" style="color:#6366f1;font-weight:bold;text-decoration:none">${a.ticker}.${a.exchangeId}</a></td>
              <td style="padding:6px 8px">${a.stockName}</td>
              <td style="padding:6px 8px">${label} ${op} ${formatValue(a.metric, a.threshold)}</td>
              <td style="padding:6px 8px;font-weight:bold">${formatValue(a.metric, a.currentValue)}</td>
            </tr>`;
        }).join("");

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto">
            <h2 style="color:#6366f1">Traiders — Alertes declenchees</h2>
            <p style="color:#666">Bonjour ${userName}, ${userAlerts.length} alerte${userAlerts.length > 1 ? "s" : ""} declenchee${userAlerts.length > 1 ? "s" : ""} :</p>
            <table style="border-collapse:collapse;width:100%;font-size:13px">
              <thead>
                <tr style="background:#f5f5f5;border-bottom:2px solid #ddd">
                  <th style="padding:6px 8px;text-align:left">Ticker</th>
                  <th style="padding:6px 8px;text-align:left">Nom</th>
                  <th style="padding:6px 8px;text-align:left">Condition</th>
                  <th style="padding:6px 8px;text-align:left">Valeur actuelle</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="color:#999;font-size:12px;margin-top:16px">Les alertes declenchees sont automatiquement desactivees. Reactivez-les depuis l'onglet Alertes.</p>
            <div style="margin-top:20px;text-align:center">
              <a href="${appUrl}/alerts" style="display:inline-block;padding:10px 24px;background:#6366f1;color:white;border-radius:6px;text-decoration:none;font-weight:bold">Voir mes alertes</a>
            </div>
          </div>`;

        await mailer.sendMail({
          from: mailConfig.from,
          to: userEmail,
          subject: `Traiders — ${userAlerts.length} alerte${userAlerts.length > 1 ? "s" : ""} declenchee${userAlerts.length > 1 ? "s" : ""}`,
          html,
        });

        emailsSent++;
      } catch (error) {
        console.error(
          `[${jobName}] Email error:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  console.log(`[${jobName}] Done: ${triggered} triggered, ${emailsSent} emails sent (of ${alerts.length} checked)`);
}
