import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim() ?? "";
    const change = request.nextUrl.searchParams.get("change")?.trim() ?? "all";
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 200);
    const searchLike = `%${search}%`;

    const rows = await sql`
      WITH ranked AS (
        SELECT
          ph.product_id, ph.price_usd, ph.scraped_at,
          LAG(ph.price_usd) OVER (PARTITION BY ph.product_id ORDER BY ph.scraped_at) AS previous_price,
          ROW_NUMBER() OVER (PARTITION BY ph.product_id ORDER BY ph.scraped_at DESC) AS rn
        FROM price_history ph
      ), current_prices AS (
        SELECT product_id, price_usd, previous_price, scraped_at,
          CASE WHEN previous_price IS NULL OR previous_price = 0 THEN NULL
          ELSE ROUND(((price_usd - previous_price) / previous_price) * 100, 2) END AS change_pct
        FROM ranked WHERE rn = 1
      )
      SELECT p.id, p.external_id, p.name, p.category, p.url,
        cp.price_usd, cp.previous_price, cp.change_pct, cp.scraped_at
      FROM products p
      JOIN sources s ON s.id = p.source_id AND s.slug = 'daka'
      LEFT JOIN current_prices cp ON cp.product_id = p.id
      WHERE (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike})
        AND (${category} = '' OR p.category = ${category})
        AND (
          ${change} = 'all'
          OR (${change} = 'down' AND cp.change_pct < 0)
          OR (${change} = 'up' AND cp.change_pct > 0)
          OR (${change} = 'same' AND COALESCE(cp.change_pct, 0) = 0)
        )
      ORDER BY ABS(COALESCE(cp.change_pct, 0)) DESC, p.name ASC
      LIMIT ${limit}
    `;

    return NextResponse.json(rows.map((row) => ({
      id: asNumber(row.id),
      externalId: row.external_id,
      name: row.name,
      category: row.category,
      url: row.url,
      currentPrice: row.price_usd == null ? null : asNumber(row.price_usd),
      previousPrice: row.previous_price == null ? null : asNumber(row.previous_price),
      changePct: row.change_pct == null ? null : asNumber(row.change_pct),
      scrapedAt: row.scraped_at ?? null
    })));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar los productos" }, { status: 500 });
  }
}
