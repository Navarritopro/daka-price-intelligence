import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const productId = Number(id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
    }
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 100);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const sql = getSql();
    const rows = await sql`
      WITH ordered AS (
        SELECT ph.price_usd, ph.list_price_usd, ph.in_stock,
          ph.available_quantity, ph.scraped_at,
          LAG(ph.price_usd) OVER (ORDER BY ph.scraped_at) AS previous_price
        FROM price_history ph
        WHERE ph.product_id = ${productId}
      )
      SELECT *, COUNT(*) OVER()::int AS total_count,
        MIN(price_usd) OVER() AS historical_min_price,
        MAX(price_usd) OVER() AS historical_max_price
      FROM ordered
      ORDER BY scraped_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const items = rows.map((row) => {
      const price = row.price_usd == null ? null : asNumber(row.price_usd);
      const previous = row.previous_price == null ? null : asNumber(row.previous_price);
      return {
        price,
        listPrice: row.list_price_usd == null ? null : asNumber(row.list_price_usd),
        scrapedAt: row.scraped_at,
        previousPrice: previous,
        differenceUsd: price == null || previous == null ? null : price - previous,
        changePct: price == null || !previous ? null : ((price - previous) / previous) * 100,
        inStock: row.in_stock,
        availableQuantity: row.available_quantity == null ? null : asNumber(row.available_quantity)
      };
    });
    const total = rows.length ? asNumber(rows[0].total_count) : 0;
    return NextResponse.json({
      items, total, offset, limit, hasMore: offset + items.length < total,
      minPrice: rows.length && rows[0].historical_min_price != null ? asNumber(rows[0].historical_min_price) : null,
      maxPrice: rows.length && rows[0].historical_max_price != null ? asNumber(rows[0].historical_max_price) : null
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar las capturas del producto" }, { status: 500 });
  }
}
