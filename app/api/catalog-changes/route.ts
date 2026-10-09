import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import {
  normalizeCatalogChangeState,
  normalizeCatalogSource,
  resolveCatalogComparisonPeriod
} from "@/lib/catalog-comparison";

export const dynamic = "force-dynamic";

const ABSENCE_FILTERS = ["all", "1", "2-3", "4+"] as const;

export async function GET(request: NextRequest) {
  try {
    const source = normalizeCatalogSource(request.nextUrl.searchParams.get("source"));
    const state = normalizeCatalogChangeState(request.nextUrl.searchParams.get("state"));
    const requestedAbsence = request.nextUrl.searchParams.get("absence") ?? "all";
    const absence = ABSENCE_FILTERS.includes(requestedAbsence as (typeof ABSENCE_FILTERS)[number]) ? requestedAbsence : "all";
    const period = resolveCatalogComparisonPeriod(request.nextUrl.searchParams);
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;
    const comparisonMode = period.mode;
    const startDate = period.startDate ?? "1900-01-01";
    const endDate = period.endDate ?? "2999-12-31";
    const sql = getSql();

    const rows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name
        FROM sources
        WHERE active = TRUE
          AND slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          AND (${source} = 'all' OR slug = ${source})
      ), valid_jobs AS (
        SELECT j.id, j.source_id, j.started_at, j.finished_at, j.products_saved,
          (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS job_date,
          ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at, j.id)::int AS job_sequence
        FROM scraping_jobs j
        JOIN selected_sources ss ON ss.id = j.source_id
        WHERE j.status = 'success' AND j.products_saved > 0
          AND j.products_saved = GREATEST(j.products_found - j.products_without_sku, 0)
      ), job_pairs AS (
        SELECT ss.id AS source_id, ss.slug AS source_slug, ss.name AS source_name,
          CASE WHEN ${comparisonMode} = 'latest' THEN (
            SELECT v.id FROM valid_jobs v WHERE v.source_id = ss.id ORDER BY v.job_sequence DESC LIMIT 1 OFFSET 1
          ) ELSE (
            SELECT v.id FROM valid_jobs v WHERE v.source_id = ss.id AND v.job_date <= ${startDate}::date
            ORDER BY v.job_sequence DESC LIMIT 1
          ) END AS previous_job_id,
          CASE WHEN ${comparisonMode} = 'latest' THEN (
            SELECT v.id FROM valid_jobs v WHERE v.source_id = ss.id ORDER BY v.job_sequence DESC LIMIT 1
          ) ELSE (
            SELECT v.id FROM valid_jobs v WHERE v.source_id = ss.id AND v.job_date <= ${endDate}::date
            ORDER BY v.job_sequence DESC LIMIT 1
          ) END AS current_job_id
        FROM selected_sources ss
      ), pair_details AS (
        SELECT jp.*, previous.job_sequence AS previous_sequence, previous.job_date AS previous_date,
          previous.finished_at AS previous_finished_at, previous.products_saved AS previous_products,
          current.job_sequence AS current_sequence, current.job_date AS current_date,
          current.finished_at AS current_finished_at, current.products_saved AS current_products
        FROM job_pairs jp
        LEFT JOIN valid_jobs previous ON previous.id = jp.previous_job_id
        LEFT JOIN valid_jobs current ON current.id = jp.current_job_id
      ), product_state AS (
        SELECT p.id, p.external_id, p.name, p.brand, p.category, p.url, p.image_url,
          pd.source_slug, pd.source_name, pd.previous_job_id, pd.current_job_id,
          pd.previous_sequence, pd.current_sequence, pd.previous_date, pd.current_date,
          previous_ph.id AS previous_capture_id, current_ph.id AS current_capture_id,
          current_ph.price_usd AS current_price, current_ph.in_stock AS current_in_stock,
          current_ph.available_quantity AS current_quantity, current_ph.scraped_at AS current_scraped_at,
          last_seen.job_sequence AS last_seen_sequence, last_seen.job_date AS last_seen_date,
          last_seen.scraped_at AS last_seen_at, last_seen.price_usd AS last_price,
          last_seen.in_stock AS last_in_stock, last_seen.available_quantity AS last_quantity,
          first_seen.job_sequence AS first_seen_sequence, first_seen.scraped_at AS first_seen_at,
          missing_start.finished_at AS missing_since
        FROM pair_details pd
        JOIN products p ON p.source_id = pd.source_id
        LEFT JOIN price_history previous_ph ON previous_ph.job_id = pd.previous_job_id AND previous_ph.product_id = p.id
        LEFT JOIN price_history current_ph ON current_ph.job_id = pd.current_job_id AND current_ph.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT v.job_sequence, v.job_date, ph.scraped_at, ph.price_usd, ph.in_stock, ph.available_quantity
          FROM valid_jobs v JOIN price_history ph ON ph.job_id = v.id AND ph.product_id = p.id
          WHERE v.source_id = pd.source_id AND v.job_sequence <= pd.current_sequence
          ORDER BY v.job_sequence DESC LIMIT 1
        ) last_seen ON TRUE
        LEFT JOIN LATERAL (
          SELECT v.job_sequence, ph.scraped_at
          FROM valid_jobs v JOIN price_history ph ON ph.job_id = v.id AND ph.product_id = p.id
          WHERE v.source_id = pd.source_id AND v.job_sequence <= pd.current_sequence
          ORDER BY v.job_sequence LIMIT 1
        ) first_seen ON TRUE
        LEFT JOIN valid_jobs missing_start
          ON missing_start.source_id = pd.source_id AND missing_start.job_sequence = last_seen.job_sequence + 1
        WHERE pd.previous_job_id IS NOT NULL AND pd.current_job_id IS NOT NULL
      ), classified AS (
        SELECT ps.*,
          GREATEST(COALESCE(ps.current_sequence - ps.last_seen_sequence, 0), 0)::int AS consecutive_absences,
          CASE
            WHEN ps.current_capture_id IS NULL AND ps.last_seen_sequence < ps.current_sequence
              THEN CASE WHEN ps.current_sequence - ps.last_seen_sequence >= 2 THEN 'confirmed' ELSE 'missing' END
            WHEN ps.current_capture_id IS NOT NULL AND ps.previous_capture_id IS NULL
              THEN CASE WHEN ps.first_seen_sequence > ps.previous_sequence THEN 'new' ELSE 'recovered' END
            ELSE NULL
          END AS change_state
        FROM product_state ps
        WHERE
          (ps.current_capture_id IS NULL AND ps.last_seen_sequence IS NOT NULL AND ps.last_seen_sequence < ps.current_sequence
            AND (${comparisonMode} = 'latest' OR ps.last_seen_date >= ${startDate}::date))
          OR (ps.current_capture_id IS NOT NULL AND ps.previous_capture_id IS NULL)
      ), base_filtered AS (
        SELECT * FROM classified c
        WHERE c.change_state IS NOT NULL
          AND (${search} = '' OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike}
            OR COALESCE(c.brand, '') ILIKE ${searchLike})
          AND (${brand} = '' OR LOWER(TRIM(COALESCE(c.brand, ''))) = LOWER(TRIM(${brand})))
          AND (${category} = '' OR c.category = ${category})
          AND (${absence} = 'all'
            OR (${absence} = '1' AND c.consecutive_absences = 1)
            OR (${absence} = '2-3' AND c.consecutive_absences BETWEEN 2 AND 3)
            OR (${absence} = '4+' AND c.consecutive_absences >= 4))
      ), result_filtered AS (
        SELECT * FROM base_filtered WHERE ${state} = 'all' OR change_state = ${state}
      ), stats AS (
        SELECT COUNT(*) FILTER (WHERE change_state = 'missing')::int AS missing,
          COUNT(*) FILTER (WHERE change_state = 'confirmed')::int AS confirmed,
          COUNT(*) FILTER (WHERE change_state = 'new')::int AS new_products,
          COUNT(*) FILTER (WHERE change_state = 'recovered')::int AS recovered
        FROM base_filtered
      )
      SELECT rf.*, COUNT(rf.id) OVER()::int AS total_count,
        stats.missing, stats.confirmed, stats.new_products, stats.recovered
      FROM stats LEFT JOIN result_filtered rf ON TRUE
      ORDER BY CASE rf.change_state WHEN 'confirmed' THEN 1 WHEN 'missing' THEN 2 WHEN 'recovered' THEN 3 ELSE 4 END,
        rf.consecutive_absences DESC, rf.last_seen_at DESC, rf.name
      LIMIT ${limit} OFFSET ${offset}
    `;

    const comparisonRows = await sql`
      WITH selected_sources AS (
        SELECT id, slug, name FROM sources
        WHERE active = TRUE
          AND slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          AND (${source} = 'all' OR slug = ${source})
      ), valid_jobs AS (
        SELECT j.id, j.source_id, j.started_at, j.finished_at, j.products_saved,
          (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS job_date,
          ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at, j.id)::int AS job_sequence
        FROM scraping_jobs j JOIN selected_sources ss ON ss.id = j.source_id
        WHERE j.status = 'success' AND j.products_saved > 0
          AND j.products_saved = GREATEST(j.products_found - j.products_without_sku, 0)
      ), pairs AS (
        SELECT ss.slug, ss.name,
          CASE WHEN ${comparisonMode} = 'latest' THEN (
            SELECT id FROM valid_jobs v WHERE v.source_id = ss.id ORDER BY job_sequence DESC LIMIT 1 OFFSET 1
          ) ELSE (
            SELECT id FROM valid_jobs v WHERE v.source_id = ss.id AND job_date <= ${startDate}::date ORDER BY job_sequence DESC LIMIT 1
          ) END AS previous_job_id,
          CASE WHEN ${comparisonMode} = 'latest' THEN (
            SELECT id FROM valid_jobs v WHERE v.source_id = ss.id ORDER BY job_sequence DESC LIMIT 1
          ) ELSE (
            SELECT id FROM valid_jobs v WHERE v.source_id = ss.id AND job_date <= ${endDate}::date ORDER BY job_sequence DESC LIMIT 1
          ) END AS current_job_id
        FROM selected_sources ss
      )
      SELECT p.slug, p.name, p.previous_job_id, p.current_job_id,
        previous.finished_at AS previous_finished_at, current.finished_at AS current_finished_at,
        previous.products_saved AS previous_products, current.products_saved AS current_products
      FROM pairs p
      LEFT JOIN valid_jobs previous ON previous.id = p.previous_job_id
      LEFT JOIN valid_jobs current ON current.id = p.current_job_id
      ORDER BY CASE p.slug WHEN 'daka' THEN 1 WHEN 'damasco' THEN 2 WHEN 'multimax' THEN 3
        WHEN 'ivoo' THEN 4 WHEN 'venelectronics' THEN 5 ELSE 6 END
    `;

    const [categoryRows, brandRows] = await Promise.all([
      sql`SELECT DISTINCT p.category FROM products p JOIN sources s ON s.id = p.source_id
          WHERE s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
            AND (${source} = 'all' OR s.slug = ${source}) AND p.category IS NOT NULL AND p.category <> '' ORDER BY p.category`,
      sql`SELECT MIN(TRIM(p.brand)) AS brand FROM products p JOIN sources s ON s.id = p.source_id
          WHERE s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
            AND (${source} = 'all' OR s.slug = ${source}) AND p.brand IS NOT NULL AND TRIM(p.brand) <> ''
          GROUP BY LOWER(TRIM(p.brand)) ORDER BY brand`
    ]);

    const items = rows.filter((row) => row.id != null).map((row) => ({
      id: asNumber(row.id), externalId: row.external_id, name: row.name,
      brand: row.brand ?? null, category: row.category ?? null, url: row.url, imageUrl: row.image_url ?? null,
      source: row.source_slug, sourceName: row.source_name, state: row.change_state,
      consecutiveAbsences: asNumber(row.consecutive_absences), firstSeenAt: row.first_seen_at ?? null,
      lastSeenAt: row.last_seen_at ?? null, missingSince: row.missing_since ?? null,
      lastPrice: row.last_price == null ? null : asNumber(row.last_price),
      currentPrice: row.current_price == null ? null : asNumber(row.current_price),
      lastInStock: row.last_in_stock, currentInStock: row.current_in_stock,
      lastQuantity: row.last_quantity == null ? null : asNumber(row.last_quantity),
      currentQuantity: row.current_quantity == null ? null : asNumber(row.current_quantity)
    }));
    const first = rows[0];
    const total = first ? asNumber(first.total_count) : 0;

    return NextResponse.json({
      period,
      items, total, offset, limit, hasMore: offset + items.length < total,
      stats: {
        missing: first ? asNumber(first.missing) : 0,
        confirmed: first ? asNumber(first.confirmed) : 0,
        newProducts: first ? asNumber(first.new_products) : 0,
        recovered: first ? asNumber(first.recovered) : 0
      },
      comparisons: comparisonRows.map((row) => ({
        source: row.slug, sourceName: row.name,
        previousJobId: row.previous_job_id ?? null, currentJobId: row.current_job_id ?? null,
        previousFinishedAt: row.previous_finished_at ?? null, currentFinishedAt: row.current_finished_at ?? null,
        previousProducts: asNumber(row.previous_products), currentProducts: asNumber(row.current_products),
        ready: Boolean(row.previous_job_id && row.current_job_id && row.previous_job_id !== row.current_job_id)
      })),
      categories: categoryRows.map((row) => row.category),
      brands: brandRows.map((row) => row.brand)
    });
  } catch (error) {
    console.error("Catalog changes failed", error);
    const message = error instanceof Error && (error.message.includes("fecha") || error.message.includes("comparación"))
      ? error.message
      : "No fue posible analizar los cambios de catálogo";
    return NextResponse.json({ error: message }, { status: message.startsWith("No fue posible") ? 500 : 400 });
  }
}
