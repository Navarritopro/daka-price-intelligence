import { NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    const [rows, sourceRows, matchRows] = await Promise.all([
      sql`
        WITH ranked_jobs AS (
          SELECT j.*, s.slug AS source_slug, s.name AS source_name,
            ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at DESC) AS source_position
          FROM scraping_jobs j
          JOIN sources s ON s.id = j.source_id
          WHERE s.active = TRUE
        )
        SELECT id, source_slug, source_name, trigger_type, status, started_at, finished_at,
          products_found, products_saved, products_without_sku,
          pages_scanned, error_message, logs,
          EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS duration_seconds
        FROM ranked_jobs
        WHERE source_position <= 20
        ORDER BY started_at DESC
      `,
      sql`
        WITH latest_success AS (
          SELECT DISTINCT ON (j.source_id) j.source_id, j.id
          FROM scraping_jobs j
          WHERE j.status = 'success'
          ORDER BY j.source_id, j.started_at DESC
        )
        SELECT s.slug AS source_slug, s.name AS source_name, s.base_url,
          COUNT(ph.id)::int AS current_products,
          COUNT(ph.id) FILTER (WHERE ph.price_usd IS NOT NULL)::int AS products_with_price,
          COUNT(ph.id) FILTER (WHERE ph.in_stock IS TRUE)::int AS in_stock,
          COUNT(ph.id) FILTER (WHERE ph.in_stock IS FALSE)::int AS out_of_stock
        FROM sources s
        LEFT JOIN latest_success ls ON ls.source_id = s.id
        LEFT JOIN price_history ph ON ph.job_id = ls.id
        WHERE s.active = TRUE
        GROUP BY s.id, s.slug, s.name, s.base_url
        ORDER BY CASE s.slug
          WHEN 'daka' THEN 1 WHEN 'damasco' THEN 2 WHEN 'multimax' THEN 3 WHEN 'ivoo' THEN 4 WHEN 'venelectronics' THEN 5
          ELSE 99 END, s.slug
      `,
      sql`
        SELECT s.slug AS source_slug, pm.status, COUNT(*)::int AS total
        FROM product_matches pm
        JOIN products competitor ON competitor.id = pm.competitor_product_id
        JOIN sources s ON s.id = competitor.source_id
        WHERE s.active = TRUE AND s.slug <> 'daka'
        GROUP BY s.slug, pm.status
      `
    ]);

    const jobs = rows.map((row) => ({
      id: row.id,
      source: row.source_slug,
      sourceName: row.source_name,
      triggerType: row.trigger_type,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      productsFound: asNumber(row.products_found),
      productsSaved: asNumber(row.products_saved),
      productsWithoutSku: asNumber(row.products_without_sku),
      pagesScanned: asNumber(row.pages_scanned),
      durationSeconds: row.duration_seconds == null ? null : asNumber(row.duration_seconds),
      errorMessage: row.error_message,
      logs: Array.isArray(row.logs) ? row.logs : []
    }));
    const matches = new Map<string, Record<string, number>>();
    for (const row of matchRows) {
      const current = matches.get(String(row.source_slug)) ?? {};
      current[String(row.status)] = asNumber(row.total);
      matches.set(String(row.source_slug), current);
    }
    const sources = sourceRows.map((row) => {
      const sourceMatches = matches.get(String(row.source_slug)) ?? {};
      return {
        source: row.source_slug,
        sourceName: row.source_name,
        baseUrl: row.base_url,
        currentProducts: asNumber(row.current_products),
        productsWithPrice: asNumber(row.products_with_price),
        inStock: asNumber(row.in_stock),
        outOfStock: asNumber(row.out_of_stock),
        autoMatches: sourceMatches.auto ?? 0,
        confirmedMatches: sourceMatches.confirmed ?? 0,
        reviewMatches: sourceMatches.review ?? 0
      };
    });
    return NextResponse.json({ items: jobs, sources });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar las ejecuciones" }, { status: 500 });
  }
}
