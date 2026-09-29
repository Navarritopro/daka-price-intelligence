import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

const COMPETITOR_SOURCES = ["damasco", "multimax", "ivoo", "venelectronics"] as const;
const MOVEMENTS = ["all", "up", "down", "same", "restocked", "out", "unquantified", "no_baseline", "not_seen"] as const;

export async function GET(request: NextRequest) {
  try {
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "all";
    const source = requestedSource === "all" || COMPETITOR_SOURCES.includes(requestedSource as (typeof COMPETITOR_SOURCES)[number])
      ? requestedSource
      : "all";
    const requestedMovement = request.nextUrl.searchParams.get("movement")?.trim() ?? "all";
    const movement = MOVEMENTS.includes(requestedMovement as (typeof MOVEMENTS)[number]) ? requestedMovement : "all";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;
    const sql = getSql();

    const rows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name
        FROM sources
        WHERE slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics')
          AND (${source} = 'all' OR slug = ${source})
      ), ranked_jobs AS (
        SELECT
          sj.id, sj.source_id, sj.started_at, sj.finished_at,
          ROW_NUMBER() OVER (PARTITION BY sj.source_id ORDER BY sj.started_at DESC, sj.id DESC) AS job_rank
        FROM scraping_jobs sj
        JOIN selected_sources ss ON ss.id = sj.source_id
        WHERE sj.status = 'success'
      ), job_pairs AS (
        SELECT
          ss.id AS source_id, ss.slug AS source_slug, ss.name AS source_name,
          (MAX(rj.id::text) FILTER (WHERE rj.job_rank = 1))::uuid AS current_job_id,
          (MAX(rj.id::text) FILTER (WHERE rj.job_rank = 2))::uuid AS previous_job_id
        FROM selected_sources ss
        LEFT JOIN ranked_jobs rj ON rj.source_id = ss.id AND rj.job_rank <= 2
        GROUP BY ss.id, ss.slug, ss.name
      ), snapshots AS (
        SELECT
          p.id, p.external_id, p.name, p.category, p.url, p.brand, p.model,
          jp.source_slug, jp.source_name,
          current_ph.id AS current_capture_id,
          current_ph.available_quantity AS current_quantity,
          current_ph.in_stock AS current_in_stock,
          current_ph.scraped_at AS current_scraped_at,
          previous_ph.id AS previous_capture_id,
          previous_ph.available_quantity AS previous_quantity,
          previous_ph.in_stock AS previous_in_stock,
          previous_ph.scraped_at AS previous_scraped_at
        FROM job_pairs jp
        JOIN products p ON p.source_id = jp.source_id
        LEFT JOIN price_history current_ph
          ON current_ph.product_id = p.id AND current_ph.job_id = jp.current_job_id
        LEFT JOIN price_history previous_ph
          ON previous_ph.product_id = p.id AND previous_ph.job_id = jp.previous_job_id
        WHERE current_ph.id IS NOT NULL OR previous_ph.id IS NOT NULL
      ), classified AS (
        SELECT
          s.*,
          CASE
            WHEN s.current_capture_id IS NULL THEN 'not_seen'
            WHEN s.previous_capture_id IS NULL THEN 'no_baseline'
            WHEN s.current_quantity IS NOT NULL AND s.previous_quantity IS NOT NULL AND s.previous_quantity = 0 AND s.current_quantity > 0 THEN 'restocked'
            WHEN s.current_quantity IS NOT NULL AND s.previous_quantity IS NOT NULL AND s.previous_quantity > 0 AND s.current_quantity = 0 THEN 'out'
            WHEN s.current_quantity IS NOT NULL AND s.previous_quantity IS NOT NULL AND s.current_quantity > s.previous_quantity THEN 'up'
            WHEN s.current_quantity IS NOT NULL AND s.previous_quantity IS NOT NULL AND s.current_quantity < s.previous_quantity THEN 'down'
            WHEN s.current_quantity IS NOT NULL AND s.previous_quantity IS NOT NULL AND s.current_quantity = s.previous_quantity THEN 'same'
            WHEN s.previous_in_stock IS FALSE AND s.current_in_stock IS TRUE THEN 'restocked'
            WHEN s.previous_in_stock IS TRUE AND s.current_in_stock IS FALSE THEN 'out'
            ELSE 'unquantified'
          END AS movement,
          CASE
            WHEN s.current_quantity IS NULL OR s.previous_quantity IS NULL THEN NULL
            ELSE s.current_quantity - s.previous_quantity
          END AS quantity_difference,
          CASE
            WHEN s.current_quantity IS NULL OR s.previous_quantity IS NULL OR s.previous_quantity = 0 THEN NULL
            ELSE ROUND(((s.current_quantity - s.previous_quantity)::numeric / s.previous_quantity) * 100, 2)
          END AS quantity_change_pct
        FROM snapshots s
      ), base_filtered AS (
        SELECT *
        FROM classified c
        WHERE (${search} = '' OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike}
          OR COALESCE(c.brand, '') ILIKE ${searchLike} OR COALESCE(c.model, '') ILIKE ${searchLike})
          AND (${category} = '' OR c.category = ${category})
      ), movement_filtered AS (
        SELECT *
        FROM base_filtered bf
        WHERE ${movement} = 'all' OR bf.movement = ${movement}
      ), stats AS (
        SELECT
          COUNT(*) FILTER (WHERE current_capture_id IS NOT NULL AND previous_capture_id IS NOT NULL)::int AS products_compared,
          COUNT(*) FILTER (WHERE movement = 'up')::int AS increased,
          COUNT(*) FILTER (WHERE movement = 'down')::int AS decreased,
          COUNT(*) FILTER (WHERE movement = 'same')::int AS unchanged,
          COUNT(*) FILTER (WHERE movement IN ('restocked', 'out'))::int AS status_changes,
          COUNT(*) FILTER (WHERE movement = 'unquantified')::int AS unquantified
        FROM base_filtered
      )
      SELECT
        mf.*,
        (SELECT COUNT(*)::int FROM movement_filtered) AS total_count,
        stats.products_compared, stats.increased, stats.decreased,
        stats.unchanged, stats.status_changes, stats.unquantified
      FROM stats
      LEFT JOIN movement_filtered mf ON TRUE
      ORDER BY
        CASE mf.movement
          WHEN 'out' THEN 1 WHEN 'restocked' THEN 2 WHEN 'down' THEN 3 WHEN 'up' THEN 4
          WHEN 'same' THEN 5 WHEN 'unquantified' THEN 6 WHEN 'no_baseline' THEN 7 ELSE 8
        END,
        ABS(COALESCE(mf.quantity_difference, 0)) DESC,
        mf.name ASC,
        mf.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const comparisonRows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name
        FROM sources
        WHERE slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics')
          AND (${source} = 'all' OR slug = ${source})
      ), ranked_jobs AS (
        SELECT
          sj.source_id, sj.finished_at,
          ROW_NUMBER() OVER (PARTITION BY sj.source_id ORDER BY sj.started_at DESC, sj.id DESC) AS job_rank
        FROM scraping_jobs sj
        JOIN selected_sources ss ON ss.id = sj.source_id
        WHERE sj.status = 'success'
      )
      SELECT
        ss.slug, ss.name,
        MAX(rj.finished_at) FILTER (WHERE rj.job_rank = 1) AS current_finished_at,
        MAX(rj.finished_at) FILTER (WHERE rj.job_rank = 2) AS previous_finished_at
      FROM selected_sources ss
      LEFT JOIN ranked_jobs rj ON rj.source_id = ss.id AND rj.job_rank <= 2
      GROUP BY ss.id, ss.slug, ss.name
      ORDER BY ss.name
    `;

    const categoryRows = await sql`
      SELECT DISTINCT p.category
      FROM products p
      JOIN sources s ON s.id = p.source_id
      WHERE s.slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics')
        AND (${source} = 'all' OR s.slug = ${source})
        AND p.category IS NOT NULL AND p.category <> ''
      ORDER BY p.category
    `;

    const items = rows.filter((row) => row.id != null).map((row) => ({
      id: asNumber(row.id),
      externalId: row.external_id,
      name: row.name,
      category: row.category ?? null,
      url: row.url,
      brand: row.brand ?? null,
      model: row.model ?? null,
      source: row.source_slug,
      sourceName: row.source_name,
      previousQuantity: row.previous_quantity == null ? null : asNumber(row.previous_quantity),
      currentQuantity: row.current_quantity == null ? null : asNumber(row.current_quantity),
      previousInStock: row.previous_in_stock,
      currentInStock: row.current_in_stock,
      previousScrapedAt: row.previous_scraped_at ?? null,
      currentScrapedAt: row.current_scraped_at ?? null,
      quantityDifference: row.quantity_difference == null ? null : asNumber(row.quantity_difference),
      quantityChangePct: row.quantity_change_pct == null ? null : asNumber(row.quantity_change_pct),
      movement: row.movement
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
      stats: {
        productsCompared: rows.length ? asNumber(rows[0].products_compared) : 0,
        increased: rows.length ? asNumber(rows[0].increased) : 0,
        decreased: rows.length ? asNumber(rows[0].decreased) : 0,
        unchanged: rows.length ? asNumber(rows[0].unchanged) : 0,
        statusChanges: rows.length ? asNumber(rows[0].status_changes) : 0,
        unquantified: rows.length ? asNumber(rows[0].unquantified) : 0
      },
      comparisons: comparisonRows.map((row) => ({
        source: row.slug,
        sourceName: row.name,
        currentFinishedAt: row.current_finished_at ?? null,
        previousFinishedAt: row.previous_finished_at ?? null
      })),
      categories: categoryRows.map((row) => row.category)
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible calcular las variaciones de disponibilidad" }, { status: 500 });
  }
}
