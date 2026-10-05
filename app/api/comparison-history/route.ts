import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { resolveComparisonPeriod } from "@/lib/comparison-period";

export const dynamic = "force-dynamic";

const SOURCES = ["damasco", "multimax", "ivoo", "venelectronics"];

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source") ?? "damasco";
    const source = SOURCES.includes(requestedSource) ? requestedSource : "damasco";
    const period = resolveComparisonPeriod(request.nextUrl.searchParams);
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const searchLike = `%${search}%`;
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
    const position = request.nextUrl.searchParams.get("position") ?? "all";
    const movement = request.nextUrl.searchParams.get("movement") ?? "all";
    const availability = request.nextUrl.searchParams.get("availability") ?? "both";
    const minGap = Math.min(Math.max(Number(request.nextUrl.searchParams.get("minGap")) || 0, 0), 100);
    const sort = request.nextUrl.searchParams.get("sort") ?? "opportunity";
    const exporting = request.nextUrl.searchParams.get("export") === "1";
    const limit = exporting ? 5000 : Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);

    const rows = await sql`
      WITH source_ids AS (
        SELECT
          MAX(id) FILTER (WHERE slug = 'daka') AS daka_id,
          MAX(id) FILTER (WHERE slug = ${source}) AS competitor_id
        FROM sources
      ), daka_jobs AS (
        SELECT DISTINCT ON (capture_date) id, capture_date
        FROM (
          SELECT j.id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j, source_ids s
          WHERE j.source_id = s.daka_id AND j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY capture_date, completed_at DESC
      ), competitor_jobs AS (
        SELECT DISTINCT ON (capture_date) id, capture_date
        FROM (
          SELECT j.id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j, source_ids s
          WHERE j.source_id = s.competitor_id AND j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY capture_date, completed_at DESC
      ), paired_jobs AS (
        SELECT d.capture_date, d.id AS daka_job_id, c.id AS competitor_job_id
        FROM daka_jobs d JOIN competitor_jobs c USING (capture_date)
      ), daily AS (
        SELECT pm.id AS match_id, pj.capture_date,
          d.id AS daka_product_id, d.external_id AS daka_sap, d.name AS daka_name,
          d.brand AS daka_brand, d.category, d.url AS daka_url,
          c.id AS competitor_product_id, c.external_id AS competitor_reference,
          c.name AS competitor_name, c.brand AS competitor_brand, c.url AS competitor_url,
          dp.price_usd AS daka_price, cp.price_usd AS competitor_price,
          dp.in_stock AS daka_in_stock, cp.in_stock AS competitor_in_stock,
          dp.price_usd - cp.price_usd AS gap_usd,
          ROUND(((dp.price_usd - cp.price_usd) / NULLIF(cp.price_usd, 0)) * 100, 2) AS gap_pct,
          CASE WHEN dp.price_usd < cp.price_usd THEN 'daka_lower'
               WHEN dp.price_usd > cp.price_usd THEN 'competitor_lower'
               ELSE 'equal' END AS price_position
        FROM paired_jobs pj
        JOIN product_matches pm ON pm.status IN ('auto', 'confirmed')
        JOIN products d ON d.id = pm.daka_product_id
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources cs ON cs.id = c.source_id AND cs.slug = ${source}
        JOIN price_history dp ON dp.job_id = pj.daka_job_id AND dp.product_id = d.id
        JOIN price_history cp ON cp.job_id = pj.competitor_job_id AND cp.product_id = c.id
        WHERE dp.price_usd IS NOT NULL AND cp.price_usd IS NOT NULL
          AND (${search} = '' OR (d.name || ' ' || d.external_id || ' ' || c.name || ' ' || c.external_id) ILIKE ${searchLike})
          AND (${category} = '' OR d.category = ${category})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(d.brand, ''))) = LOWER(TRIM(${brand}))
            OR LOWER(TRIM(COALESCE(c.brand, ''))) = LOWER(TRIM(${brand})))
      ), positioned AS (
        SELECT *, LAG(price_position) OVER (PARTITION BY match_id ORDER BY capture_date) AS previous_position
        FROM daily
      ), summarized AS (
        SELECT match_id,
          MIN(daka_product_id) AS daka_product_id,
          MIN(daka_sap) AS daka_sap, MIN(daka_name) AS daka_name,
          MIN(category) AS category, MIN(daka_url) AS daka_url,
          MIN(competitor_product_id) AS competitor_product_id,
          MIN(competitor_reference) AS competitor_reference,
          MIN(competitor_name) AS competitor_name, MIN(competitor_url) AS competitor_url,
          COUNT(*)::int AS capture_days,
          COUNT(*) FILTER (WHERE price_position = 'daka_lower')::int AS daka_lower_days,
          COUNT(*) FILTER (WHERE price_position = 'competitor_lower')::int AS competitor_lower_days,
          COUNT(*) FILTER (WHERE price_position = 'equal')::int AS equal_days,
          COUNT(*) FILTER (WHERE previous_position IS NOT NULL AND previous_position <> price_position)::int AS leadership_changes,
          (ARRAY_AGG(capture_date ORDER BY capture_date))[1] AS first_date,
          (ARRAY_AGG(capture_date ORDER BY capture_date DESC))[1] AS latest_date,
          (ARRAY_AGG(daka_price ORDER BY capture_date))[1] AS first_daka_price,
          (ARRAY_AGG(daka_price ORDER BY capture_date DESC))[1] AS latest_daka_price,
          (ARRAY_AGG(competitor_price ORDER BY capture_date))[1] AS first_competitor_price,
          (ARRAY_AGG(competitor_price ORDER BY capture_date DESC))[1] AS latest_competitor_price,
          (ARRAY_AGG(gap_usd ORDER BY capture_date DESC))[1] AS latest_gap_usd,
          (ARRAY_AGG(gap_pct ORDER BY capture_date))[1] AS first_gap_pct,
          (ARRAY_AGG(gap_pct ORDER BY capture_date DESC))[1] AS latest_gap_pct,
          (ARRAY_AGG(daka_in_stock ORDER BY capture_date DESC))[1] AS latest_daka_in_stock,
          (ARRAY_AGG(competitor_in_stock ORDER BY capture_date DESC))[1] AS latest_competitor_in_stock,
          AVG(ABS(gap_pct))::numeric(10,2) AS average_abs_gap_pct,
          MIN(gap_pct) AS best_daka_gap_pct,
          MAX(gap_pct) AS worst_daka_gap_pct
        FROM positioned
        GROUP BY match_id
      ), filtered AS (
        SELECT *, latest_gap_pct - first_gap_pct AS gap_change_pct,
          CASE WHEN latest_gap_pct < first_gap_pct - 0.01 THEN 'gained'
               WHEN latest_gap_pct > first_gap_pct + 0.01 THEN 'lost'
               ELSE 'stable' END AS movement
        FROM summarized
        WHERE (${position} = 'all'
          OR (${position} = 'daka_lower' AND latest_gap_pct < 0)
          OR (${position} = 'competitor_lower' AND latest_gap_pct > 0)
          OR (${position} = 'equal' AND latest_gap_pct = 0))
          AND (${movement} = 'all'
            OR (${movement} = 'gained' AND latest_gap_pct < first_gap_pct - 0.01)
            OR (${movement} = 'lost' AND latest_gap_pct > first_gap_pct + 0.01)
            OR (${movement} = 'stable' AND ABS(latest_gap_pct - first_gap_pct) <= 0.01)
            OR (${movement} = 'switched' AND leadership_changes > 0))
          AND ABS(latest_gap_pct) >= ${minGap}
          AND (${availability} = 'all'
            OR (${availability} = 'both' AND latest_daka_in_stock IS DISTINCT FROM FALSE AND latest_competitor_in_stock IS DISTINCT FROM FALSE)
            OR (${availability} = 'competitor' AND latest_competitor_in_stock IS DISTINCT FROM FALSE))
      )
      SELECT *,
        COUNT(*) OVER()::int AS total_count,
        COUNT(*) FILTER (WHERE latest_gap_pct < 0) OVER()::int AS stat_daka_lower,
        COUNT(*) FILTER (WHERE latest_gap_pct > 0) OVER()::int AS stat_competitor_lower,
        COUNT(*) FILTER (WHERE movement = 'gained') OVER()::int AS stat_gained,
        COUNT(*) FILTER (WHERE movement = 'lost') OVER()::int AS stat_lost,
        COUNT(*) FILTER (WHERE leadership_changes > 0) OVER()::int AS stat_switched,
        COALESCE(AVG(ABS(latest_gap_pct)) OVER(), 0)::numeric(10,2) AS stat_average_gap
      FROM filtered
      ORDER BY
        CASE WHEN ${sort} = 'opportunity' THEN latest_gap_pct END DESC NULLS LAST,
        CASE WHEN ${sort} = 'favorable' THEN latest_gap_pct END ASC NULLS LAST,
        CASE WHEN ${sort} = 'deteriorated' THEN gap_change_pct END DESC NULLS LAST,
        CASE WHEN ${sort} = 'improved' THEN gap_change_pct END ASC NULLS LAST,
        CASE WHEN ${sort} = 'sustained' THEN competitor_lower_days END DESC NULLS LAST,
        daka_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const categoryRows = await sql`
      SELECT DISTINCT d.category
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
      WHERE pm.status IN ('auto', 'confirmed') AND d.category IS NOT NULL
      ORDER BY d.category
    `;
    const brandRows = await sql`
      SELECT MIN(brand) AS brand
      FROM (
        SELECT TRIM(d.brand) AS brand
        FROM product_matches pm
        JOIN products d ON d.id = pm.daka_product_id
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
        WHERE pm.status IN ('auto', 'confirmed') AND d.brand IS NOT NULL AND TRIM(d.brand) <> ''
        UNION ALL
        SELECT TRIM(c.brand) AS brand
        FROM product_matches pm
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
        WHERE pm.status IN ('auto', 'confirmed') AND c.brand IS NOT NULL AND TRIM(c.brand) <> ''
      ) matched_brands
      GROUP BY LOWER(brand)
      ORDER BY brand
    `;
    const first = rows[0];
    const items = rows.map((row) => ({
      matchId: asNumber(row.match_id),
      daka: { id: asNumber(row.daka_product_id), externalId: row.daka_sap, name: row.daka_name, category: row.category, url: row.daka_url, price: asNumber(row.latest_daka_price), inStock: row.latest_daka_in_stock },
      competitor: { id: asNumber(row.competitor_product_id), externalId: row.competitor_reference, name: row.competitor_name, url: row.competitor_url, price: asNumber(row.latest_competitor_price), inStock: row.latest_competitor_in_stock },
      captureDays: asNumber(row.capture_days), dakaLowerDays: asNumber(row.daka_lower_days), competitorLowerDays: asNumber(row.competitor_lower_days), equalDays: asNumber(row.equal_days), leadershipChanges: asNumber(row.leadership_changes),
      firstDate: row.first_date, latestDate: row.latest_date,
      firstDakaPrice: asNumber(row.first_daka_price), firstCompetitorPrice: asNumber(row.first_competitor_price),
      latestGapUsd: asNumber(row.latest_gap_usd), firstGapPct: asNumber(row.first_gap_pct), latestGapPct: asNumber(row.latest_gap_pct), gapChangePct: asNumber(row.gap_change_pct),
      averageAbsGapPct: asNumber(row.average_abs_gap_pct), bestDakaGapPct: asNumber(row.best_daka_gap_pct), worstDakaGapPct: asNumber(row.worst_daka_gap_pct), movement: row.movement
    }));
    const total = first ? asNumber(first.total_count) : 0;
    return NextResponse.json({ source, days: period.days, period, items, total, offset, limit, hasMore: offset + items.length < total, categories: categoryRows.map((row) => row.category), brands: brandRows.map((row) => row.brand), stats: {
      total, dakaLower: first ? asNumber(first.stat_daka_lower) : 0, competitorLower: first ? asNumber(first.stat_competitor_lower) : 0,
      gained: first ? asNumber(first.stat_gained) : 0, lost: first ? asNumber(first.stat_lost) : 0,
      switched: first ? asNumber(first.stat_switched) : 0, averageGapPct: first ? asNumber(first.stat_average_gap) : 0
    }});
  } catch (error) {
    console.error("Comparison history failed", error);
    const message = error instanceof Error && error.message.includes("fecha") || error instanceof Error && error.message.includes("rango personalizado")
      ? error.message
      : "No fue posible analizar el histórico competitivo";
    return NextResponse.json({ error: message }, { status: message.startsWith("No fue posible") ? 500 : 400 });
  }
}
