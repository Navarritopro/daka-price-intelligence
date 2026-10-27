import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "damasco";
    const source = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"].includes(requestedSource) ? requestedSource : "damasco";
    const sql = getSql();
    const [summary] = await sql`
      WITH selected_source AS (
        SELECT id, name FROM sources WHERE slug = ${source}
      ), latest_successful_job AS (
        SELECT id, started_at, finished_at
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM selected_source) AND status = 'success'
        ORDER BY started_at DESC
        LIMIT 1
      ), latest_job AS (
        SELECT status, started_at, finished_at
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM selected_source)
        ORDER BY started_at DESC
        LIMIT 1
      ), latest_snapshot AS (
        SELECT product_id, price_usd, in_stock
        FROM display_price_history
        WHERE job_id = (SELECT id FROM latest_successful_job)
      )
      SELECT
        (SELECT name FROM selected_source) AS source_name,
        COUNT(p.id)::int AS products_historical,
        COUNT(ls.product_id)::int AS products_current,
        (COUNT(p.id) - COUNT(ls.product_id))::int AS products_not_seen,
        COUNT(ls.price_usd)::int AS products_with_price,
        COUNT(*) FILTER (WHERE ls.in_stock IS TRUE)::int AS products_in_stock,
        COUNT(*) FILTER (WHERE ls.in_stock IS FALSE)::int AS products_out_of_stock,
        COALESCE(AVG(ls.price_usd), 0)::numeric(12,2) AS average_price,
        (SELECT finished_at FROM latest_successful_job) AS last_scrape_at,
        (SELECT status FROM latest_job) AS last_job_status,
        EXTRACT(EPOCH FROM ((SELECT finished_at FROM latest_job) - (SELECT started_at FROM latest_job)))::int AS duration_seconds,
        ARRAY(
          SELECT DISTINCT p2.category FROM products p2
          WHERE p2.source_id = (SELECT id FROM selected_source)
            AND p2.category IS NOT NULL AND p2.category <> ''
          ORDER BY p2.category
        ) AS categories,
        ARRAY(
          SELECT MIN(TRIM(p3.brand)) FROM products p3
          WHERE p3.source_id = (SELECT id FROM selected_source)
            AND p3.brand IS NOT NULL AND TRIM(p3.brand) <> ''
          GROUP BY LOWER(TRIM(p3.brand))
          ORDER BY MIN(TRIM(p3.brand))
        ) AS brands
      FROM products p
      LEFT JOIN latest_snapshot ls ON ls.product_id = p.id
      WHERE p.source_id = (SELECT id FROM selected_source)
    `;
    return NextResponse.json({
      source: summary?.source_name ?? source,
      productsCurrent: asNumber(summary?.products_current),
      productsHistorical: asNumber(summary?.products_historical),
      productsNotSeen: asNumber(summary?.products_not_seen),
      productsWithPrice: asNumber(summary?.products_with_price),
      productsInStock: asNumber(summary?.products_in_stock),
      productsOutOfStock: asNumber(summary?.products_out_of_stock),
      averagePrice: asNumber(summary?.average_price),
      lastScrapeAt: summary?.last_scrape_at ?? null,
      lastJobStatus: summary?.last_job_status ?? null,
      lastJobDurationSeconds: summary?.duration_seconds == null ? null : asNumber(summary.duration_seconds),
      categories: Array.isArray(summary?.categories) ? summary.categories : [],
      brands: Array.isArray(summary?.brands) ? summary.brands : []
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar el resumen del catálogo" }, { status: 500 });
  }
}
