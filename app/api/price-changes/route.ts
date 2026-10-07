import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "daka";
    const source = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"].includes(requestedSource) ? requestedSource : "daka";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
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
    const currentJob = request.nextUrl.searchParams.get("currentJob")?.trim() ?? "";
    const previousJob = request.nextUrl.searchParams.get("previousJob")?.trim() ?? "";

    if (Boolean(currentJob) !== Boolean(previousJob)) {
      return NextResponse.json({ error: "La comparación requiere ambas ejecuciones" }, { status: 400 });
    }

    const brandRows = await sql`
      SELECT MIN(TRIM(p.brand)) AS brand
      FROM products p JOIN sources s ON s.id = p.source_id
      WHERE s.slug = ${source} AND p.brand IS NOT NULL AND TRIM(p.brand) <> ''
      GROUP BY LOWER(TRIM(p.brand))
      ORDER BY brand
    `;

    if (currentJob && previousJob) {
      const exactRows = await sql`
        WITH selected_source AS (
          SELECT id FROM sources WHERE slug = ${source}
        ), valid_jobs AS (
          SELECT
            COUNT(*) FILTER (WHERE j.id::text = ${currentJob})::int AS current_count,
            COUNT(*) FILTER (WHERE j.id::text = ${previousJob})::int AS previous_count
          FROM scraping_jobs j
          WHERE j.source_id = (SELECT id FROM selected_source)
            AND j.status = 'success'
            AND j.id::text IN (${currentJob}, ${previousJob})
        ), current_prices AS (
          SELECT ph.product_id, ph.price_usd, ph.scraped_at
          FROM price_history ph
          JOIN products cp ON cp.id = ph.product_id
          WHERE ph.job_id::text = ${currentJob}
            AND cp.source_id = (SELECT id FROM selected_source)
            AND (SELECT current_count FROM valid_jobs) = 1
        ), previous_prices AS (
          SELECT ph.product_id, ph.price_usd
          FROM price_history ph
          JOIN products pp ON pp.id = ph.product_id
          WHERE ph.job_id::text = ${previousJob}
            AND pp.source_id = (SELECT id FROM selected_source)
            AND (SELECT previous_count FROM valid_jobs) = 1
        ), exact_changes AS (
          SELECT
            cp.product_id,
            pp.price_usd AS previous_price,
            cp.price_usd,
            cp.scraped_at,
            cp.price_usd - pp.price_usd AS difference_usd,
            ROUND(((cp.price_usd - pp.price_usd) / NULLIF(pp.price_usd, 0)) * 100, 2) AS change_pct
          FROM current_prices cp
          JOIN previous_prices pp ON pp.product_id = cp.product_id
          WHERE cp.price_usd IS NOT NULL
            AND pp.price_usd IS NOT NULL
            AND pp.price_usd <> 0
            AND cp.price_usd IS DISTINCT FROM pp.price_usd
        ), eligible_changes AS (
          SELECT ec.*
          FROM exact_changes ec
          JOIN products p ON p.id = ec.product_id
          WHERE ABS(ec.change_pct) >= ${threshold}
            AND (
              ${movement} = 'all'
              OR (${movement} = 'down' AND ec.difference_usd < 0)
              OR (${movement} = 'up' AND ec.difference_usd > 0)
            )
            AND (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
              OR COALESCE(p.brand, '') ILIKE ${searchLike}
              OR COALESCE(p.model, '') ILIKE ${searchLike})
            AND (${brand} = '' OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM(${brand})))
        )
        SELECT
          p.id, p.external_id, p.name, p.category, p.url, p.last_seen_at,
          p.brand, p.model,
          1::int AS change_count,
          ec.previous_price AS initial_price,
          ec.price_usd AS final_price,
          ec.scraped_at AS latest_change_at,
          ABS(ec.change_pct) AS largest_change_pct,
          ec.difference_usd AS net_difference_usd,
          ec.change_pct AS net_change_pct,
          COUNT(*) OVER()::int AS total_count,
          COUNT(*) OVER()::int AS total_changes,
          COUNT(*) FILTER (WHERE ec.difference_usd < 0) OVER()::int AS drops,
          COUNT(*) FILTER (WHERE ec.difference_usd > 0) OVER()::int AS increases,
          TRUE AS seen_in_latest
        FROM eligible_changes ec
        JOIN products p ON p.id = ec.product_id
        ORDER BY ABS(ec.change_pct) DESC, p.id ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const items = exactRows.map((row) => ({
        id: asNumber(row.id), externalId: row.external_id, name: row.name,
        category: row.category, url: row.url,
        currentPrice: row.final_price == null ? null : asNumber(row.final_price),
        previousPrice: row.initial_price == null ? null : asNumber(row.initial_price),
        changePct: row.net_change_pct == null ? null : asNumber(row.net_change_pct),
        scrapedAt: row.latest_change_at ?? null, seenInLatest: true,
        lastSeenAt: row.last_seen_at ?? null, changeCount: 1,
        initialPrice: row.initial_price == null ? null : asNumber(row.initial_price),
        finalPrice: row.final_price == null ? null : asNumber(row.final_price),
        netDifferenceUsd: row.net_difference_usd == null ? null : asNumber(row.net_difference_usd),
        netChangePct: row.net_change_pct == null ? null : asNumber(row.net_change_pct),
        largestChangePct: row.largest_change_pct == null ? null : asNumber(row.largest_change_pct),
        latestChangeAt: row.latest_change_at ?? null, brand: row.brand ?? null, model: row.model ?? null
      }));
      const total = exactRows.length ? asNumber(exactRows[0].total_count) : 0;
      return NextResponse.json({
        items, total, offset, limit, hasMore: offset + items.length < total,
        comparison: { source, currentJob, previousJob },
        brands: brandRows.map((row) => row.brand),
        stats: {
          productsChanged: total,
          totalChanges: exactRows.length ? asNumber(exactRows[0].total_changes) : 0,
          drops: exactRows.length ? asNumber(exactRows[0].drops) : 0,
          increases: exactRows.length ? asNumber(exactRows[0].increases) : 0
        }
      });
    }

    const rows = await sql`
      WITH selected_source AS (
        SELECT id FROM sources WHERE slug = ${source}
      ), latest_successful_job AS (
        SELECT id
        FROM scraping_jobs
        WHERE source_id = (SELECT id FROM selected_source)
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
        JOIN products ordered_product ON ordered_product.id = ph.product_id
        WHERE ordered_product.source_id = (SELECT id FROM selected_source)
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
        WHERE eligible_product.source_id = (SELECT id FROM selected_source)
          AND (${search} = '' OR eligible_product.name ILIKE ${searchLike} OR eligible_product.external_id ILIKE ${searchLike}
            OR COALESCE(eligible_product.brand, '') ILIKE ${searchLike}
            OR COALESCE(eligible_product.model, '') ILIKE ${searchLike})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(eligible_product.brand, ''))) = LOWER(TRIM(${brand})))
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
        p.brand, p.model,
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
      latestChangeAt: row.latest_change_at ?? null,
      brand: row.brand ?? null,
      model: row.model ?? null
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
      brands: brandRows.map((row) => row.brand),
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
