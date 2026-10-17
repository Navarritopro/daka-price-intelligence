import { NextResponse } from "next/server";
import { assessSourceQuality } from "@/lib/data-quality";
import { asNumber, getSql } from "@/lib/db";
import type { DataQualityResponse, DataQualitySourceSummary, JobSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const sourceOrder = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"];

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`
      WITH successful AS (
        SELECT j.*,
          ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at DESC) AS position
        FROM scraping_jobs j
        WHERE j.status = 'success'
      ), pairs AS (
        SELECT source_id,
          (MAX(id::text) FILTER (WHERE position = 1))::uuid AS current_job_id,
          (MAX(id::text) FILTER (WHERE position = 2))::uuid AS previous_job_id,
          MAX(COALESCE(finished_at, started_at)) FILTER (WHERE position = 1) AS latest_success_at,
          MAX(products_found) FILTER (WHERE position = 1) AS products_found,
          MAX(products_saved) FILTER (WHERE position = 1) AS products_saved,
          MAX(products_without_sku) FILTER (WHERE position = 1) AS products_without_sku,
          MAX(pages_scanned) FILTER (WHERE position = 1) AS pages_scanned
        FROM successful
        WHERE position <= 2
        GROUP BY source_id
      ), latest_attempt AS (
        SELECT DISTINCT ON (source_id) source_id, status, started_at
        FROM scraping_jobs
        ORDER BY source_id, started_at DESC
      )
      SELECT s.slug AS source_slug, s.name AS source_name, s.base_url,
        p.latest_success_at, la.status AS latest_attempt_status, la.started_at AS latest_attempt_at,
        COALESCE(p.products_found, 0)::int AS products_found,
        COALESCE(p.products_saved, 0)::int AS products_saved,
        COALESCE(p.products_without_sku, 0)::int AS products_without_sku,
        COALESCE(p.pages_scanned, 0)::int AS pages_scanned,
        COALESCE(current_stats.total, 0)::int AS current_products,
        CASE WHEN p.previous_job_id IS NULL THEN NULL ELSE COALESCE(previous_stats.total, 0)::int END AS previous_products,
        COALESCE(current_stats.with_price, 0)::int AS products_with_price,
        COALESCE(changes.missing, 0)::int AS missing_products,
        COALESCE(changes.added, 0)::int AS new_products,
        COALESCE(match_stats.matched, 0)::int AS matched_products,
        COALESCE(match_stats.review, 0)::int AS review_matches
      FROM sources s
      LEFT JOIN pairs p ON p.source_id = s.id
      LEFT JOIN latest_attempt la ON la.source_id = s.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE ph.price_usd IS NOT NULL)::int AS with_price
        FROM price_history ph
        WHERE ph.job_id = p.current_job_id
      ) current_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total
        FROM price_history ph
        WHERE ph.job_id = p.previous_job_id
      ) previous_stats ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE side = 'missing')::int AS missing,
          COUNT(*) FILTER (WHERE side = 'added')::int AS added
        FROM (
          SELECT 'missing' AS side
          FROM price_history previous_ph
          WHERE previous_ph.job_id = p.previous_job_id
            AND NOT EXISTS (
              SELECT 1 FROM price_history current_ph
              WHERE current_ph.job_id = p.current_job_id
                AND current_ph.product_id = previous_ph.product_id
            )
          UNION ALL
          SELECT 'added' AS side
          FROM price_history current_ph
          WHERE current_ph.job_id = p.current_job_id
            AND NOT EXISTS (
              SELECT 1 FROM price_history previous_ph
              WHERE previous_ph.job_id = p.previous_job_id
                AND previous_ph.product_id = current_ph.product_id
            )
        ) differences
      ) changes ON p.previous_job_id IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM product_matches pm
            WHERE pm.status IN ('auto', 'confirmed')
              AND (CASE WHEN s.slug = 'daka' THEN pm.daka_product_id ELSE pm.competitor_product_id END) = ph.product_id
          ))::int AS matched,
          COUNT(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM product_matches pm
            WHERE pm.status = 'review'
              AND (CASE WHEN s.slug = 'daka' THEN pm.daka_product_id ELSE pm.competitor_product_id END) = ph.product_id
          ))::int AS review
        FROM price_history ph
        WHERE ph.job_id = p.current_job_id
      ) match_stats ON TRUE
      WHERE s.active = TRUE
        AND s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
      ORDER BY CASE s.slug
        WHEN 'daka' THEN 1 WHEN 'damasco' THEN 2 WHEN 'multimax' THEN 3
        WHEN 'ivoo' THEN 4 WHEN 'venelectronics' THEN 5 WHEN 'soytechno' THEN 6 ELSE 99 END
    `;

    const sources: DataQualitySourceSummary[] = rows.map((row) => {
      const currentProducts = asNumber(row.current_products);
      const matchedProducts = asNumber(row.matched_products);
      const latestSuccessAt = row.latest_success_at ? new Date(row.latest_success_at).toISOString() : null;
      const latestAttemptAt = row.latest_attempt_at ? new Date(row.latest_attempt_at).toISOString() : null;
      const assessment = assessSourceQuality({
        latestSuccessAt,
        latestAttemptStatus: row.latest_attempt_status ? String(row.latest_attempt_status) : null,
        latestAttemptAt,
        productsFound: asNumber(row.products_found),
        productsSaved: asNumber(row.products_saved),
        productsWithoutSku: asNumber(row.products_without_sku),
        currentProducts,
        previousProducts: row.previous_products == null ? null : asNumber(row.previous_products),
        productsWithPrice: asNumber(row.products_with_price)
      });
      return {
        source: String(row.source_slug) as JobSummary["source"],
        sourceName: String(row.source_name),
        baseUrl: String(row.base_url),
        ...assessment,
        latestSuccessAt,
        latestAttemptStatus: row.latest_attempt_status ? String(row.latest_attempt_status) : null,
        latestAttemptAt,
        productsFound: asNumber(row.products_found),
        productsSaved: asNumber(row.products_saved),
        productsWithoutSku: asNumber(row.products_without_sku),
        pagesScanned: asNumber(row.pages_scanned),
        currentProducts,
        previousProducts: row.previous_products == null ? null : asNumber(row.previous_products),
        missingProducts: asNumber(row.missing_products),
        newProducts: asNumber(row.new_products),
        productsWithPrice: asNumber(row.products_with_price),
        matchedProducts,
        reviewMatches: asNumber(row.review_matches),
        matchCoveragePercent: currentProducts > 0 ? Math.round((matchedProducts / currentProducts) * 1000) / 10 : null
      };
    }).sort((a, b) => sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source));

    const summary: DataQualityResponse["summary"] = { healthy: 0, warning: 0, critical: 0, pending: 0 };
    for (const source of sources) summary[source.level] += 1;
    return NextResponse.json({ generatedAt: new Date().toISOString(), summary, sources } satisfies DataQualityResponse);
  } catch (error) {
    console.error("data-quality", error);
    return NextResponse.json({ error: "No fue posible evaluar la calidad y cobertura de los datos" }, { status: 500 });
  }
}
