import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "daka";
    const source = ["daka", "damasco"].includes(requestedSource) ? requestedSource : "daka";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const change = request.nextUrl.searchParams.get("change")?.trim() ?? "all";
    const requestedStatus = request.nextUrl.searchParams.get("status")?.trim() ?? "current";
    const status = ["current", "missing", "all"].includes(requestedStatus) ? requestedStatus : "current";
    const requestedStock = request.nextUrl.searchParams.get("stock")?.trim() ?? "all";
    const stock = ["all", "in", "out"].includes(requestedStock) ? requestedStock : "all";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;

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
      ), ranked AS (
        SELECT
          ph.product_id, ph.price_usd, ph.list_price_usd, ph.in_stock,
          ph.available_quantity, ph.scraped_at,
          LAG(ph.price_usd) OVER (PARTITION BY ph.product_id ORDER BY ph.scraped_at) AS previous_price,
          ROW_NUMBER() OVER (PARTITION BY ph.product_id ORDER BY ph.scraped_at DESC) AS rn
        FROM price_history ph
        JOIN products ranked_product ON ranked_product.id = ph.product_id
        WHERE ranked_product.source_id = (SELECT id FROM selected_source)
      ), current_prices AS (
        SELECT product_id, price_usd, list_price_usd, in_stock,
          available_quantity, previous_price, scraped_at,
          CASE WHEN previous_price IS NULL OR previous_price = 0 THEN NULL
          ELSE ROUND(((price_usd - previous_price) / previous_price) * 100, 2) END AS change_pct
        FROM ranked WHERE rn = 1
      )
      SELECT p.id, p.external_id, p.name, p.category, p.url, p.last_seen_at,
        p.brand, p.model,
        COUNT(*) OVER()::int AS total_count,
        cp.price_usd, cp.list_price_usd, cp.in_stock, cp.available_quantity,
        cp.previous_price, cp.change_pct, cp.scraped_at,
        EXISTS (
          SELECT 1
          FROM price_history latest_ph
          WHERE latest_ph.product_id = p.id
            AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
        ) AS seen_in_latest
      FROM products p
      LEFT JOIN current_prices cp ON cp.product_id = p.id
      WHERE p.source_id = (SELECT id FROM selected_source)
        AND (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
          OR COALESCE(p.brand, '') ILIKE ${searchLike} OR COALESCE(p.model, '') ILIKE ${searchLike})
        AND (${category} = '' OR p.category = ${category})
        AND (
          ${status} = 'all'
          OR NOT EXISTS (SELECT 1 FROM latest_successful_job)
          OR (${status} = 'current' AND EXISTS (
            SELECT 1 FROM price_history latest_ph
            WHERE latest_ph.product_id = p.id
              AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
          ))
          OR (${status} = 'missing' AND NOT EXISTS (
            SELECT 1 FROM price_history latest_ph
            WHERE latest_ph.product_id = p.id
              AND latest_ph.job_id = (SELECT id FROM latest_successful_job)
          ))
        )
        AND (
          ${change} = 'all'
          OR (${change} = 'down' AND cp.change_pct < 0)
          OR (${change} = 'up' AND cp.change_pct > 0)
          OR (${change} = 'same' AND COALESCE(cp.change_pct, 0) = 0)
        )
        AND (
          ${stock} = 'all'
          OR (${stock} = 'in' AND cp.in_stock IS TRUE)
          OR (${stock} = 'out' AND cp.in_stock IS FALSE)
        )
      ORDER BY ABS(COALESCE(cp.change_pct, 0)) DESC, p.name ASC, p.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const items = rows.map((row) => ({
      id: asNumber(row.id),
      externalId: row.external_id,
      name: row.name,
      category: row.category,
      url: row.url,
      currentPrice: row.price_usd == null ? null : asNumber(row.price_usd),
      previousPrice: row.previous_price == null ? null : asNumber(row.previous_price),
      changePct: row.change_pct == null ? null : asNumber(row.change_pct),
      scrapedAt: row.scraped_at ?? null,
      seenInLatest: Boolean(row.seen_in_latest),
      lastSeenAt: row.last_seen_at ?? null,
      brand: row.brand ?? null,
      model: row.model ?? null,
      listPrice: row.list_price_usd == null ? null : asNumber(row.list_price_usd),
      inStock: row.in_stock,
      availableQuantity: row.available_quantity == null ? null : asNumber(row.available_quantity)
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar los productos" }, { status: 500 });
  }
}
