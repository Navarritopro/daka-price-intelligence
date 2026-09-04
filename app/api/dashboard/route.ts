import { NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    const [summary] = await sql`
      WITH daka_source AS (
        SELECT id FROM sources WHERE slug = 'daka'
      ), latest_successful_job AS (
        SELECT id, started_at, finished_at
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM daka_source)
          AND status = 'success'
        ORDER BY started_at DESC
        LIMIT 1
      ), latest_prices AS (
        SELECT DISTINCT ON (ph.product_id)
          ph.product_id, ph.price_usd, ph.scraped_at
        FROM price_history ph
        ORDER BY ph.product_id, ph.scraped_at DESC
      ), latest_snapshot AS (
        SELECT ph.product_id, ph.price_usd, ph.scraped_at
        FROM price_history ph
        WHERE ph.job_id = (SELECT id FROM latest_successful_job)
      ), latest_job AS (
        SELECT status, started_at, finished_at
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM daka_source)
        ORDER BY started_at DESC LIMIT 1
      ), today_changes AS (
        SELECT
          COUNT(*) FILTER (WHERE ABS(a.change_pct) >= 5) AS total,
          COUNT(*) FILTER (WHERE a.change_pct <= -5) AS drops,
          COUNT(*) FILTER (WHERE a.change_pct >= 5) AS increases
        FROM alerts a
        WHERE a.source_id = (SELECT id FROM daka_source)
          AND (a.created_at AT TIME ZONE 'America/Caracas')::date =
              (NOW() AT TIME ZONE 'America/Caracas')::date
      )
      SELECT
        COUNT(p.id)::int AS products_historical,
        COUNT(ls.product_id)::int AS products_current,
        (COUNT(p.id) - COUNT(ls.product_id))::int AS products_not_seen,
        COUNT(ls.price_usd)::int AS products_with_price,
        COALESCE(AVG(ls.price_usd), 0)::numeric(12,2) AS average_price,
        MAX(ls.scraped_at) AS last_successful_scrape_at,
        MAX(lp.scraped_at) AS last_recorded_price_at,
        COALESCE(tc.total, 0)::int AS changes_today,
        COALESCE(tc.drops, 0)::int AS drops_today,
        COALESCE(tc.increases, 0)::int AS increases_today,
        lj.status AS last_job_status,
        EXTRACT(EPOCH FROM (lj.finished_at - lj.started_at))::int AS duration_seconds
      FROM products p
      JOIN sources s ON s.id = p.source_id AND s.slug = 'daka'
      LEFT JOIN latest_prices lp ON lp.product_id = p.id
      LEFT JOIN latest_snapshot ls ON ls.product_id = p.id
      CROSS JOIN today_changes tc
      LEFT JOIN latest_job lj ON TRUE
      GROUP BY tc.total, tc.drops, tc.increases, lj.status, lj.started_at, lj.finished_at
    `;

    return NextResponse.json({
      source: "Tiendas Daka",
      productsMonitored: asNumber(summary?.products_current),
      productsHistorical: asNumber(summary?.products_historical),
      productsNotSeen: asNumber(summary?.products_not_seen),
      productsWithPrice: asNumber(summary?.products_with_price),
      changesToday: asNumber(summary?.changes_today),
      priceDropsToday: asNumber(summary?.drops_today),
      priceIncreasesToday: asNumber(summary?.increases_today),
      averagePrice: asNumber(summary?.average_price),
      lastScrapeAt: summary?.last_successful_scrape_at ?? summary?.last_recorded_price_at ?? null,
      lastJobStatus: summary?.last_job_status ?? null,
      lastJobDurationSeconds: summary?.duration_seconds == null ? null : asNumber(summary.duration_seconds),
      nextRun: "09:00 AM VET"
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar el resumen" }, { status: 500 });
  }
}
