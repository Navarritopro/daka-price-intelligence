import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const requestedPosition = request.nextUrl.searchParams.get("position") ?? "all";
    const position = ["all", "daka_lower", "competitor_lower", "equal"].includes(requestedPosition)
      ? requestedPosition : "all";
    const requestedSort = request.nextUrl.searchParams.get("sort") ?? "gap_desc";
    const sort = ["gap_desc", "gap_asc", "recent", "confidence"].includes(requestedSort)
      ? requestedSort : "gap_desc";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;

    const rows = await sql`
      WITH daka_source AS (
        SELECT id FROM sources WHERE slug = 'daka'
      ), damasco_source AS (
        SELECT id FROM sources WHERE slug = 'damasco'
      ), latest_daka_job AS (
        SELECT id FROM scraping_jobs
        WHERE source_id = (SELECT id FROM daka_source) AND status = 'success'
        ORDER BY started_at DESC LIMIT 1
      ), latest_damasco_job AS (
        SELECT id FROM scraping_jobs
        WHERE source_id = (SELECT id FROM damasco_source) AND status = 'success'
        ORDER BY started_at DESC LIMIT 1
      ), comparisons AS (
        SELECT
          pm.id AS match_id, pm.confidence, pm.match_method,
          d.id AS daka_id, d.external_id AS daka_sap, d.name AS daka_name,
          d.category AS daka_category, d.url AS daka_url,
          dp.price_usd AS daka_price, dp.in_stock AS daka_in_stock,
          dp.scraped_at AS daka_scraped_at,
          c.id AS competitor_id, c.external_id AS competitor_reference,
          c.name AS competitor_name, c.brand AS competitor_brand,
          c.category AS competitor_category, c.url AS competitor_url,
          cp.price_usd AS competitor_price, cp.list_price_usd AS competitor_list_price,
          cp.in_stock AS competitor_in_stock, cp.available_quantity,
          cp.scraped_at AS competitor_scraped_at,
          d.category AS category,
          d.name || ' ' || d.external_id || ' ' || c.name || ' ' || c.external_id AS searchable,
          calc.price_gap
        FROM product_matches pm
        JOIN products d ON d.id = pm.daka_product_id
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources cs ON cs.id = c.source_id AND cs.slug = 'damasco'
        JOIN price_history dp
          ON dp.product_id = d.id AND dp.job_id = (SELECT id FROM latest_daka_job)
        JOIN price_history cp
          ON cp.product_id = c.id AND cp.job_id = (SELECT id FROM latest_damasco_job)
        CROSS JOIN LATERAL (
          SELECT dp.price_usd - cp.price_usd AS price_gap
        ) calc
        WHERE pm.status IN ('auto', 'confirmed')
          AND dp.price_usd IS NOT NULL AND cp.price_usd IS NOT NULL
      ), filtered AS (
        SELECT *,
          ROUND((price_gap / NULLIF(competitor_price, 0)) * 100, 2) AS gap_pct
        FROM comparisons
        WHERE (${search} = '' OR searchable ILIKE ${searchLike})
          AND (${category} = '' OR category = ${category})
          AND (
            ${position} = 'all'
            OR (${position} = 'daka_lower' AND price_gap < 0)
            OR (${position} = 'competitor_lower' AND price_gap > 0)
            OR (${position} = 'equal' AND price_gap = 0)
          )
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM filtered
      ORDER BY
        CASE WHEN ${sort} = 'gap_desc' THEN ABS(gap_pct) END DESC NULLS LAST,
        CASE WHEN ${sort} = 'gap_asc' THEN ABS(gap_pct) END ASC NULLS LAST,
        CASE WHEN ${sort} = 'recent' THEN competitor_scraped_at END DESC NULLS LAST,
        CASE WHEN ${sort} = 'confidence' THEN confidence END DESC NULLS LAST,
        daka_name ASC, match_id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const [stats] = await sql`
      WITH damasco_source AS (
        SELECT id FROM sources WHERE slug = 'damasco'
      ), latest_daka_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'daka' AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      ), latest_damasco_job AS (
        SELECT j.id, j.finished_at FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'damasco' AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      ), valid AS (
        SELECT dp.price_usd AS daka_price, cp.price_usd AS competitor_price
        FROM product_matches pm
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN price_history dp ON dp.product_id = pm.daka_product_id
          AND dp.job_id = (SELECT id FROM latest_daka_job)
        JOIN price_history cp ON cp.product_id = pm.competitor_product_id
          AND cp.job_id = (SELECT id FROM latest_damasco_job)
        WHERE c.source_id = (SELECT id FROM damasco_source)
          AND pm.status IN ('auto', 'confirmed')
          AND dp.price_usd IS NOT NULL AND cp.price_usd IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*) FROM products WHERE source_id = (SELECT id FROM damasco_source))::int AS competitor_products,
        (SELECT COUNT(*) FROM product_matches pm JOIN products c ON c.id = pm.competitor_product_id
          WHERE c.source_id = (SELECT id FROM damasco_source) AND pm.status = 'review')::int AS review_pending,
        COUNT(*)::int AS matched_products,
        COUNT(*) FILTER (WHERE daka_price < competitor_price)::int AS daka_lower,
        COUNT(*) FILTER (WHERE daka_price > competitor_price)::int AS competitor_lower,
        COUNT(*) FILTER (WHERE daka_price = competitor_price)::int AS equal_price,
        COALESCE(AVG(ABS(((daka_price - competitor_price) / NULLIF(competitor_price, 0)) * 100)), 0)::numeric(10,2) AS average_gap_pct,
        (SELECT finished_at FROM latest_damasco_job) AS competitor_last_scrape_at
      FROM valid
    `;

    const categoryRows = await sql`
      SELECT DISTINCT d.category
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources s ON s.id = c.source_id AND s.slug = 'damasco'
      WHERE pm.status IN ('auto', 'confirmed') AND d.category IS NOT NULL
      ORDER BY d.category
    `;

    const items = rows.map((row) => ({
      matchId: asNumber(row.match_id),
      confidence: asNumber(row.confidence),
      matchMethod: row.match_method,
      daka: {
        id: asNumber(row.daka_id), externalId: row.daka_sap, name: row.daka_name,
        category: row.daka_category, url: row.daka_url,
        price: asNumber(row.daka_price), inStock: row.daka_in_stock,
        scrapedAt: row.daka_scraped_at
      },
      competitor: {
        id: asNumber(row.competitor_id), externalId: row.competitor_reference,
        name: row.competitor_name, brand: row.competitor_brand,
        category: row.competitor_category, url: row.competitor_url,
        price: asNumber(row.competitor_price),
        listPrice: row.competitor_list_price == null ? null : asNumber(row.competitor_list_price),
        inStock: row.competitor_in_stock,
        availableQuantity: row.available_quantity == null ? null : asNumber(row.available_quantity),
        scrapedAt: row.competitor_scraped_at
      },
      differenceUsd: asNumber(row.price_gap),
      differencePct: asNumber(row.gap_pct)
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;

    return NextResponse.json({
      items, total, offset, limit, hasMore: offset + items.length < total,
      categories: categoryRows.map((row) => row.category),
      stats: {
        competitorProducts: asNumber(stats?.competitor_products),
        reviewPending: asNumber(stats?.review_pending),
        matchedProducts: asNumber(stats?.matched_products),
        dakaLower: asNumber(stats?.daka_lower),
        competitorLower: asNumber(stats?.competitor_lower),
        equalPrice: asNumber(stats?.equal_price),
        averageGapPct: asNumber(stats?.average_gap_pct),
        competitorLastScrapeAt: stats?.competitor_last_scrape_at ?? null
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar el comparador DAKA vs. Damasco" }, { status: 500 });
  }
}
