import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const requestedPeriod = request.nextUrl.searchParams.get("days") ?? "30";
    const period = ["1", "7", "30", "90", "all"].includes(requestedPeriod) ? requestedPeriod : "30";
    const days = period === "all" ? 30 : Number(period);
    const requestedMovement = request.nextUrl.searchParams.get("movement") ?? "all";
    const movement = ["all", "down", "up"].includes(requestedMovement) ? requestedMovement : "all";
    const requestedThreshold = Number(request.nextUrl.searchParams.get("threshold")) || 0;
    const threshold = [0, 5, 10, 20].includes(requestedThreshold) ? requestedThreshold : 0;
    const requestedStatus = request.nextUrl.searchParams.get("status") ?? "current";
    const status = ["current", "missing", "all"].includes(requestedStatus) ? requestedStatus : "current";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;

    const rows = await sql`
      WITH daka_source AS (
        SELECT id FROM sources WHERE slug = 'daka'
      ), latest_successful_job AS (
        SELECT id
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM daka_source)
          AND status = 'success'
        ORDER BY started_at DESC
        LIMIT 1
      ), ordered_prices AS (
        SELECT
          ph.product_id,
          ph.price_usd,
          ph.scraped_at,
          LAG(ph.price_usd) OVER (
            PARTITION BY ph.product_id
            ORDER BY ph.scraped_at
          ) AS previous_price
        FROM price_history ph
      ), filtered_changes AS (
        SELECT
          op.product_id,
          op.previous_price,
          op.price_usd,
          op.scraped_at,
          op.price_usd - op.previous_price AS difference_usd,
          ROUND(((op.price_usd - op.previous_price) / NULLIF(op.previous_price, 0)) * 100, 2) AS change_pct
        FROM ordered_prices op
        WHERE op.previous_price IS NOT NULL
          AND op.price_usd IS DISTINCT FROM op.previous_price
          AND (
            ${period} = 'all'
            OR op.scraped_at >= CASE
              WHEN ${days} = 1 THEN
                date_trunc('day', NOW() AT TIME ZONE 'America/Caracas') AT TIME ZONE 'America/Caracas'
              ELSE NOW() - (${days} * INTERVAL '1 day')
            END
          )
      ), matching_changes AS (
        SELECT fc.*
        FROM filtered_changes fc
        WHERE ABS(fc.change_pct) >= ${threshold}
          AND (
            ${movement} = 'all'
            OR (${movement} = 'down' AND fc.difference_usd < 0)
            OR (${movement} = 'up' AND fc.difference_usd > 0)
          )
      ), eligible_changes AS (
        SELECT mc.*
        FROM matching_changes mc
        JOIN products eligible_product ON eligible_product.id = mc.product_id
        WHERE eligible_product.source_id = (SELECT id FROM daka_source)
          AND (${search} = '' OR eligible_product.name ILIKE ${searchLike} OR eligible_product.external_id ILIKE ${searchLike})
          AND (
            ${status} = 'all'
            OR NOT EXISTS (SELECT 1 FROM latest_successful_job)
            OR (${status} = 'current' AND EXISTS (
              SELECT 1 FROM price_history latest_ph
              WHERE latest_ph.product_id = eligible_product.id
                AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
            ))
            OR (${status} = 'missing' AND NOT EXISTS (
              SELECT 1 FROM price_history latest_ph
              WHERE latest_ph.product_id = eligible_product.id
                AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
            ))
          )
      ), product_changes AS (
        SELECT
          ec.product_id,
          COUNT(*)::int AS change_count,
          (ARRAY_AGG(ec.previous_price ORDER BY ec.scraped_at ASC))[1] AS initial_price,
          (ARRAY_AGG(ec.price_usd ORDER BY ec.scraped_at DESC))[1] AS final_price,
          MAX(ec.scraped_at) AS latest_change_at,
          MAX(ABS(ec.change_pct)) AS largest_change_pct
        FROM eligible_changes ec
        GROUP BY ec.product_id
      )
      SELECT
        p.id, p.external_id, p.name, p.category, p.url, p.last_seen_at,
        pc.change_count, pc.initial_price, pc.final_price, pc.latest_change_at,
        pc.largest_change_pct,
        pc.final_price - pc.initial_price AS net_difference_usd,
        ROUND(((pc.final_price - pc.initial_price) / NULLIF(pc.initial_price, 0)) * 100, 2) AS net_change_pct,
        COUNT(*) OVER()::int AS total_count,
        (SELECT COUNT(*)::int FROM eligible_changes) AS total_changes,
        (SELECT COUNT(*) FILTER (WHERE difference_usd < 0)::int FROM eligible_changes) AS drops,
        (SELECT COUNT(*) FILTER (WHERE difference_usd > 0)::int FROM eligible_changes) AS increases,
        EXISTS (
          SELECT 1 FROM price_history latest_ph
          WHERE latest_ph.product_id = p.id
            AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
        ) AS seen_in_latest
      FROM product_changes pc
      JOIN products p ON p.id = pc.product_id
      ORDER BY pc.latest_change_at DESC, ABS(pc.largest_change_pct) DESC, p.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const items = rows.map((row) => ({
      id: asNumber(row.id),
      externalId: row.external_id,
      name: row.name,
      category: row.category,
      url: row.url,
      currentPrice: row.final_price == null ? null : asNumber(row.final_price),
      previousPrice: row.initial_price == null ? null : asNumber(row.initial_price),
      changePct: row.net_change_pct == null ? null : asNumber(row.net_change_pct),
      scrapedAt: row.latest_change_at ?? null,
      seenInLatest: Boolean(row.seen_in_latest),
      lastSeenAt: row.last_seen_at ?? null,
      changeCount: asNumber(row.change_count),
      initialPrice: row.initial_price == null ? null : asNumber(row.initial_price),
      finalPrice: row.final_price == null ? null : asNumber(row.final_price),
      netDifferenceUsd: row.net_difference_usd == null ? null : asNumber(row.net_difference_usd),
      netChangePct: row.net_change_pct == null ? null : asNumber(row.net_change_pct),
      largestChangePct: row.largest_change_pct == null ? null : asNumber(row.largest_change_pct),
      latestChangeAt: row.latest_change_at ?? null
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
      stats: {
        productsChanged: total,
        totalChanges: rows.length ? asNumber(rows[0].total_changes) : 0,
        drops: rows.length ? asNumber(rows[0].drops) : 0,
        increases: rows.length ? asNumber(rows[0].increases) : 0
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar los cambios de precios" }, { status: 500 });
  }
}
