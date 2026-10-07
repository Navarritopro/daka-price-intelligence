import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { resolveComparisonPeriod } from "@/lib/comparison-period";

export const dynamic = "force-dynamic";
const SOURCES = ["damasco", "multimax", "ivoo", "venelectronics", "soytechno"];

export async function GET(request: NextRequest, context: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId: rawMatchId } = await context.params;
    const matchId = Number(rawMatchId);
    if (!Number.isInteger(matchId) || matchId <= 0) return NextResponse.json({ error: "Comparación inválida" }, { status: 400 });
    const requestedSource = request.nextUrl.searchParams.get("source") ?? "damasco";
    const source = SOURCES.includes(requestedSource) ? requestedSource : "damasco";
    const period = resolveComparisonPeriod(request.nextUrl.searchParams);
    const sql = getSql();
    const rows = await sql`
      WITH daka_jobs AS (
        SELECT DISTINCT ON (capture_date) id, capture_date
        FROM (
          SELECT j.id, (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
          WHERE s.slug = 'daka' AND j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY capture_date, completed_at DESC
      ), competitor_jobs AS (
        SELECT DISTINCT ON (capture_date) id, capture_date
        FROM (
          SELECT j.id, (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
          WHERE s.slug = ${source} AND j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY capture_date, completed_at DESC
      ), paired_jobs AS (
        SELECT d.capture_date, d.id AS daka_job_id, c.id AS competitor_job_id
        FROM daka_jobs d JOIN competitor_jobs c USING (capture_date)
      )
      SELECT pj.capture_date, d.name AS daka_name, d.external_id AS daka_sap,
        c.name AS competitor_name, c.external_id AS competitor_reference,
        dp.price_usd AS daka_price, cp.price_usd AS competitor_price,
        dp.in_stock AS daka_in_stock, cp.in_stock AS competitor_in_stock,
        dp.price_usd - cp.price_usd AS gap_usd,
        ROUND(((dp.price_usd - cp.price_usd) / NULLIF(cp.price_usd, 0)) * 100, 2) AS gap_pct
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources cs ON cs.id = c.source_id AND cs.slug = ${source}
      JOIN paired_jobs pj ON TRUE
      JOIN price_history dp ON dp.job_id = pj.daka_job_id AND dp.product_id = d.id
      JOIN price_history cp ON cp.job_id = pj.competitor_job_id AND cp.product_id = c.id
      WHERE pm.id = ${matchId} AND pm.status IN ('auto', 'confirmed')
        AND dp.price_usd IS NOT NULL AND cp.price_usd IS NOT NULL
      ORDER BY pj.capture_date ASC
    `;
    if (!rows.length) return NextResponse.json({ error: "No existen capturas comparables en el período" }, { status: 404 });
    const points = rows.map((row) => ({ date: row.capture_date, dakaPrice: asNumber(row.daka_price), competitorPrice: asNumber(row.competitor_price), gapUsd: asNumber(row.gap_usd), gapPct: asNumber(row.gap_pct), dakaInStock: row.daka_in_stock, competitorInStock: row.competitor_in_stock }));
    return NextResponse.json({ matchId, source, days: period.days, period, dakaName: rows[0].daka_name, dakaSap: rows[0].daka_sap, competitorName: rows[0].competitor_name, competitorReference: rows[0].competitor_reference, points });
  } catch (error) {
    console.error("Comparison history detail failed", error);
    const message = error instanceof Error && (error.message.includes("fecha") || error.message.includes("rango personalizado"))
      ? error.message
      : "No fue posible cargar la evolución competitiva";
    return NextResponse.json({ error: message }, { status: message.startsWith("No fue posible") ? 500 : 400 });
  }
}
