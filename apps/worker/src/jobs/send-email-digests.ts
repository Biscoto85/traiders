import type { PrismaClient } from "@prisma/client";
import { createTransport, type Transporter } from "nodemailer";
import { formatMarketCap, formatPercent, formatRatio } from "@stock-screener/shared";

interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

function createMailer(config: MailConfig): Transporter {
  return createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });
}

/**
 * Run active email digests: execute each digest's screener filters
 * and send a summary email to the user.
 */
export async function runEmailDigests(
  prisma: PrismaClient,
  schedule: "daily" | "weekly",
  mailConfig: MailConfig,
  appUrl = "http://localhost:5173",
): Promise<void> {
  const jobName = `email-digest-${schedule}`;
  console.log(`[${jobName}] Starting...`);

  const digests = await prisma.emailDigest.findMany({
    where: { isActive: true, schedule },
    include: { user: { select: { email: true, name: true, isActive: true } } },
  });

  if (digests.length === 0) {
    console.log(`[${jobName}] No active digests found`);
    return;
  }

  const mailer = createMailer(mailConfig);
  let sent = 0;
  let errors = 0;

  for (const digest of digests) {
    if (!digest.user.isActive) continue;

    try {
      // Build WHERE from filters (simplified — reuses filter logic)
      const filters = digest.filters as Record<string, unknown>;
      const where: Record<string, unknown> = { isActive: true };

      // Classification filters
      if (Array.isArray(filters.exchanges) && filters.exchanges.length > 0) {
        where.exchangeId = { in: filters.exchanges };
      }
      if (Array.isArray(filters.sectors) && filters.sectors.length > 0) {
        where.sector = { in: filters.sectors };
      }
      if (Array.isArray(filters.countries) && filters.countries.length > 0) {
        where.exchange = { country: { in: filters.countries } };
      }

      // Range filters
      const rangeFields = [
        "peRatio", "forwardPe", "pegRatio", "pbRatio", "psRatio",
        "evToEbitda", "evToRevenue", "marketCap", "grossMargin",
        "operatingMargin", "netMargin", "roe", "roa", "revenueGrowth",
        "earningsGrowth", "dividendYield", "fcfYield", "beta",
        "debtToEquity", "currentRatio", "pctFrom52WeekHigh", "pctFrom52WeekLow",
      ];

      for (const field of rangeFields) {
        const range = filters[field] as { min?: number; max?: number } | undefined;
        if (range) {
          const cond: Record<string, number> = {};
          if (range.min !== undefined) cond.gte = range.min;
          if (range.max !== undefined) cond.lte = range.max;
          where[field === "price" ? "lastPrice" : field] = cond;
        }
      }

      const stocks = await prisma.stock.findMany({
        where: where as never,
        orderBy: { marketCap: "desc" },
        take: 30,
        select: {
          ticker: true,
          exchangeId: true,
          name: true,
          lastPrice: true,
          marketCap: true,
          peRatio: true,
          roe: true,
          netMargin: true,
          dividendYield: true,
          pctFrom52WeekHigh: true,
        },
      });

      if (stocks.length === 0) {
        console.log(`[${jobName}] Digest "${digest.name}" — no matching stocks, skipping`);
        continue;
      }

      // Build HTML email
      const stockUrl = (ticker: string, exId: string) =>
        `${appUrl}/stock/${encodeURIComponent(ticker)}?exchange=${encodeURIComponent(exId)}`;

      const rows = stocks
        .map(
          (s) => `
          <tr>
            <td style="padding:4px 8px"><a href="${stockUrl(s.ticker, s.exchangeId)}" style="color:#6366f1;font-weight:bold;text-decoration:none">${s.ticker}.${s.exchangeId}</a></td>
            <td style="padding:4px 8px;max-width:200px;overflow:hidden;text-overflow:ellipsis">${s.name}</td>
            <td style="padding:4px 8px;text-align:right">${s.lastPrice?.toFixed(2) ?? "—"}</td>
            <td style="padding:4px 8px;text-align:right">${formatMarketCap(s.marketCap)}</td>
            <td style="padding:4px 8px;text-align:right">${formatRatio(s.peRatio)}</td>
            <td style="padding:4px 8px;text-align:right">${formatPercent(s.roe)}</td>
            <td style="padding:4px 8px;text-align:right">${formatPercent(s.netMargin)}</td>
            <td style="padding:4px 8px;text-align:right">${formatPercent(s.dividendYield)}</td>
            <td style="padding:4px 8px;text-align:right;color:${(s.pctFrom52WeekHigh ?? 0) < -0.1 ? "#ef4444" : "#22c55e"}">${formatPercent(s.pctFrom52WeekHigh)}</td>
          </tr>`,
        )
        .join("");

      const html = `
        <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
          <h2 style="color:#6366f1">Traiders — ${digest.name}</h2>
          <p style="color:#666">Bonjour ${digest.user.name}, voici vos ${stocks.length} actions correspondant a vos criteres :</p>
          <table style="border-collapse:collapse;width:100%;font-size:13px">
            <thead>
              <tr style="background:#f5f5f5;border-bottom:2px solid #ddd">
                <th style="padding:6px 8px;text-align:left">Ticker</th>
                <th style="padding:6px 8px;text-align:left">Nom</th>
                <th style="padding:6px 8px;text-align:right">Prix</th>
                <th style="padding:6px 8px;text-align:right">Mkt Cap</th>
                <th style="padding:6px 8px;text-align:right">P/E</th>
                <th style="padding:6px 8px;text-align:right">ROE</th>
                <th style="padding:6px 8px;text-align:right">Marge N.</th>
                <th style="padding:6px 8px;text-align:right">Div.</th>
                <th style="padding:6px 8px;text-align:right">vs 52w H</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div style="margin-top:20px;text-align:center">
            <a href="${appUrl}" style="display:inline-block;padding:10px 24px;background:#6366f1;color:white;border-radius:6px;text-decoration:none;font-weight:bold">Ouvrir Traiders</a>
          </div>
          <p style="color:#999;font-size:12px;margin-top:20px;text-align:center">Genere par Traiders le ${new Date().toLocaleDateString("fr-FR")} &middot; Cliquez sur un ticker pour voir le detail</p>
        </div>
      `;

      await mailer.sendMail({
        from: mailConfig.from,
        to: digest.user.email,
        subject: `Traiders — ${digest.name} (${stocks.length} resultats)`,
        html,
      });

      await prisma.emailDigest.update({
        where: { id: digest.id },
        data: { lastSentAt: new Date() },
      });

      sent++;
      console.log(`[${jobName}] Sent "${digest.name}" to ${digest.user.email} — ${stocks.length} stocks`);
    } catch (error) {
      errors++;
      console.error(
        `[${jobName}] Error on digest "${digest.name}":`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`[${jobName}] Done: ${sent} sent, ${errors} errors`);
}
