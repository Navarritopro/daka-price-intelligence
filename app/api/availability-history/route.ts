import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { resolveComparisonPeriod } from "@/lib/comparison-period";

export const dynamic = "force-dynamic";

const SOURCES = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"] as const;
const MOVEMENTS = ["all", "up", "down", "same", "restocked", "out", "unquantified"] as const;

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "all";
    const source = requestedSource === "all" || SOURCES.includes(requestedSource as (typeof SOURCES)[number])
      ? requestedSource
      : "all";
    const requestedMovement = request.nextUrl.searchParams.get("movement")?.trim() ?? "all";
    const movement = MOVEMENTS.includes(requestedMovement as (typeof MOVEMENTS)[number]) ? requestedMovement : "all";
    const period = resolveComparisonPeriod(request.nextUrl.searchParams);
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const searchLike = `%${search}%`;
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);

    const seriesRows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name FROM sources
        WHERE slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          AND (${source} = 'all' OR slug = ${source})
      ), daily_jobs AS (
        SELECT DISTINCT ON (source_id, capture_date)
          id, source_id, capture_date, completed_at
        FROM (
          SELECT j.id, j.source_id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j
          JOIN selected_sources ss ON ss.id = j.source_id
          WHERE j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY source_id, capture_date, completed_at DESC, id DESC
      ), captures AS (
        SELECT ss.slug AS source_slug, ss.name AS source_name, dj.capture_date,
          p.id AS product_id, ph.available_quantity,
          CASE
            WHEN ph.in_stock IS TRUE OR COALESCE(ph.available_quantity, 0) > 0 THEN TRUE
            WHEN ph.in_stock IS FALSE OR ph.available_quantity = 0 THEN FALSE
            ELSE NULL
          END AS is_available
        FROM daily_jobs dj
        JOIN selected_sources ss ON ss.id = dj.source_id
        JOIN price_history ph ON ph.job_id = dj.id
        JOIN products p ON p.id = ph.product_id
        WHERE (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
          OR COALESCE(p.brand, '') ILIKE ${searchLike} OR COALESCE(p.model, '') ILIKE ${searchLike})
          AND (${category} = '' OR p.category = ${category})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM(${brand})))
      )
      SELECT source_slug, source_name, capture_date,
        COUNT(*)::int AS captured_products,
        COUNT(*) FILTER (WHERE is_available IS TRUE)::int AS available_products,
        COUNT(*) FILTER (WHERE is_available IS FALSE)::int AS unavailable_products,
        COUNT(*) FILTER (WHERE is_available IS NULL)::int AS unknown_products,
        COUNT(*) FILTER (WHERE is_available IS TRUE AND available_quantity IS NULL)::int AS unquantified_products,
        COALESCE(SUM(available_quantity) FILTER (WHERE available_quantity IS NOT NULL), 0)::bigint AS reported_units
      FROM captures
      GROUP BY source_slug, source_name, capture_date
      ORDER BY capture_date, source_name
    `;

    const statsRows = await sql`
      WITH selected_sources AS (
        SELECT id, slug FROM sources
        WHERE slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          AND (${source} = 'all' OR slug = ${source})
      ), daily_jobs AS (
        SELECT DISTINCT ON (source_id, capture_date) id, source_id, capture_date
        FROM (
          SELECT j.id, j.source_id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j JOIN selected_sources ss ON ss.id = j.source_id
          WHERE j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY source_id, capture_date, completed_at DESC, id DESC
      ), captures AS (
        SELECT dj.source_id, dj.capture_date, p.id AS product_id, ph.available_quantity,
          CASE
            WHEN ph.in_stock IS TRUE OR COALESCE(ph.available_quantity, 0) > 0 THEN TRUE
            WHEN ph.in_stock IS FALSE OR ph.available_quantity = 0 THEN FALSE
            ELSE NULL
          END AS is_available
        FROM daily_jobs dj
        JOIN price_history ph ON ph.job_id = dj.id
        JOIN products p ON p.id = ph.product_id
        WHERE (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
          OR COALESCE(p.brand, '') ILIKE ${searchLike} OR COALESCE(p.model, '') ILIKE ${searchLike})
          AND (${category} = '' OR p.category = ${category})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM(${brand})))
      ), ordered AS (
        SELECT *, LAG(is_available) OVER (PARTITION BY source_id, product_id ORDER BY capture_date) AS previous_available
        FROM captures
      )
      SELECT
        COUNT(DISTINCT product_id) FILTER (WHERE previous_available IS FALSE AND is_available IS TRUE)::int AS entered_stock,
        COUNT(DISTINCT product_id) FILTER (WHERE previous_available IS TRUE AND is_available IS FALSE)::int AS left_stock
      FROM ordered
    `;

    const productRows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name FROM sources
        WHERE slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          AND (${source} = 'all' OR slug = ${source})
      ), daily_jobs AS (
        SELECT DISTINCT ON (source_id, capture_date) id, source_id, capture_date
        FROM (
          SELECT j.id, j.source_id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j JOIN selected_sources ss ON ss.id = j.source_id
          WHERE j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY source_id, capture_date, completed_at DESC, id DESC
      ), captures AS (
        SELECT ss.slug AS source_slug, ss.name AS source_name, dj.capture_date,
          p.id, p.external_id, p.name, p.brand, p.category, p.url, ph.available_quantity,
          CASE
            WHEN ph.in_stock IS TRUE OR COALESCE(ph.available_quantity, 0) > 0 THEN TRUE
            WHEN ph.in_stock IS FALSE OR ph.available_quantity = 0 THEN FALSE
            ELSE NULL
          END AS is_available
        FROM daily_jobs dj
        JOIN selected_sources ss ON ss.id = dj.source_id
        JOIN price_history ph ON ph.job_id = dj.id
        JOIN products p ON p.id = ph.product_id
        WHERE (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
          OR COALESCE(p.brand, '') ILIKE ${searchLike} OR COALESCE(p.model, '') ILIKE ${searchLike})
          AND (${category} = '' OR p.category = ${category})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(p.brand, ''))) = LOWER(TRIM(${brand})))
      ), summarized AS (
        SELECT id, MIN(external_id) AS external_id, MIN(name) AS name, MIN(brand) AS brand, MIN(category) AS category,
          MIN(url) AS url, MIN(source_slug) AS source_slug, MIN(source_name) AS source_name,
          COUNT(*)::int AS capture_days,
          (ARRAY_AGG(available_quantity ORDER BY capture_date))[1] AS first_quantity,
          (ARRAY_AGG(available_quantity ORDER BY capture_date DESC))[1] AS latest_quantity,
          MIN(available_quantity) AS minimum_quantity,
          MAX(available_quantity) AS maximum_quantity,
          (ARRAY_AGG(is_available ORDER BY capture_date))[1] AS first_available,
          (ARRAY_AGG(is_available ORDER BY capture_date DESC))[1] AS latest_available,
          (ARRAY_AGG(capture_date ORDER BY capture_date))[1] AS first_date,
          (ARRAY_AGG(capture_date ORDER BY capture_date DESC))[1] AS latest_date
        FROM captures
        GROUP BY id
      ), classified AS (
        SELECT *,
          CASE
            WHEN first_available IS FALSE AND latest_available IS TRUE THEN 'restocked'
            WHEN first_available IS TRUE AND latest_available IS FALSE THEN 'out'
            WHEN first_quantity IS NOT NULL AND latest_quantity IS NOT NULL AND latest_quantity > first_quantity THEN 'up'
            WHEN first_quantity IS NOT NULL AND latest_quantity IS NOT NULL AND latest_quantity < first_quantity THEN 'down'
            WHEN first_quantity IS NOT NULL AND latest_quantity IS NOT NULL AND latest_quantity = first_quantity THEN 'same'
            ELSE 'unquantified'
          END AS movement,
          CASE WHEN first_quantity IS NULL OR latest_quantity IS NULL THEN NULL
            ELSE latest_quantity - first_quantity END AS quantity_difference
        FROM summarized
      ), filtered AS (
        SELECT * FROM classified WHERE ${movement} = 'all' OR movement = ${movement}
      )
      SELECT *, COUNT(*) OVER()::int AS total_count
      FROM filtered
      ORDER BY
        CASE movement WHEN 'out' THEN 1 WHEN 'restocked' THEN 2 WHEN 'down' THEN 3
          WHEN 'up' THEN 4 WHEN 'same' THEN 5 ELSE 6 END,
        ABS(COALESCE(quantity_difference, 0)) DESC, name
      LIMIT ${limit} OFFSET ${offset}
    `;

    const categoryRows = await sql`
      SELECT DISTINCT p.category
      FROM products p JOIN sources s ON s.id = p.source_id
      WHERE s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
        AND (${source} = 'all' OR s.slug = ${source})
        AND p.category IS NOT NULL AND p.category <> ''
      ORDER BY p.category
    `;
    const brandRows = await sql`
      SELECT MIN(TRIM(p.brand)) AS brand
      FROM products p JOIN sources s ON s.id = p.source_id
      WHERE s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
        AND (${source} = 'all' OR s.slug = ${source})
        AND p.brand IS NOT NULL AND TRIM(p.brand) <> ''
      GROUP BY LOWER(TRIM(p.brand))
      ORDER BY brand
    `;

    const series = seriesRows.map((row) => ({
      source: row.source_slug,
      sourceName: row.source_name,
      date: row.capture_date,
      capturedProducts: asNumber(row.captured_products),
      availableProducts: asNumber(row.available_products),
      unavailableProducts: asNumber(row.unavailable_products),
      unknownProducts: asNumber(row.unknown_products),
      unquantifiedProducts: asNumber(row.unquantified_products),
      reportedUnits: asNumber(row.reported_units)
    }));

    const bySource = new Map<string, typeof series>();
    for (const point of series) {
      const points = bySource.get(point.source) ?? [];
      points.push(point);
      bySource.set(point.source, points);
    }
    let availableStart = 0, availableEnd = 0, unitsStart = 0, unitsEnd = 0, unquantifiedEnd = 0;
    for (const points of bySource.values()) {
      const first = points[0], last = points[points.length - 1];
      availableStart += first.availableProducts;
      availableEnd += last.availableProducts;
      unitsStart += first.reportedUnits;
      unitsEnd += last.reportedUnits;
      unquantifiedEnd += last.unquantifiedProducts;
    }

    const stats = statsRows[0];
    const items = productRows.map((row) => ({
      id: asNumber(row.id), externalId: row.external_id, name: row.name, brand: row.brand ?? null, category: row.category ?? null,
      url: row.url, source: row.source_slug, sourceName: row.source_name,
      captureDays: asNumber(row.capture_days), firstQuantity: row.first_quantity == null ? null : asNumber(row.first_quantity),
      latestQuantity: row.latest_quantity == null ? null : asNumber(row.latest_quantity),
      minimumQuantity: row.minimum_quantity == null ? null : asNumber(row.minimum_quantity),
      maximumQuantity: row.maximum_quantity == null ? null : asNumber(row.maximum_quantity),
      firstAvailable: row.first_available, latestAvailable: row.latest_available,
      firstDate: row.first_date, latestDate: row.latest_date, movement: row.movement,
      quantityDifference: row.quantity_difference == null ? null : asNumber(row.quantity_difference)
    }));
    const total = productRows[0] ? asNumber(productRows[0].total_count) : 0;

    return NextResponse.json({
      period, series, items, total, offset, limit, hasMore: offset + items.length < total,
      stats: {
        availableStart, availableEnd, availableNet: availableEnd - availableStart,
        unitsStart, unitsEnd, unitsNet: unitsEnd - unitsStart,
        enteredStock: stats ? asNumber(stats.entered_stock) : 0,
        leftStock: stats ? asNumber(stats.left_stock) : 0,
        unquantifiedEnd
      },
      categories: categoryRows.map((row) => row.category),
      brands: brandRows.map((row) => row.brand)
    });
  } catch (error) {
    console.error("Availability history failed", error);
    const message = error instanceof Error && (error.message.includes("fecha") || error.message.includes("rango personalizado"))
      ? error.message
      : "No fue posible analizar el histórico de disponibilidad";
    return NextResponse.json({ error: message }, { status: message.startsWith("No fue posible") ? 500 : 400 });
  }
}
