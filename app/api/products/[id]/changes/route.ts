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

    const requestedPeriod = request.nextUrl.searchParams.get("days") ?? "30";
    const period = ["1", "7", "30", "90", "all"].includes(requestedPeriod) ? requestedPeriod : "30";
    const days = period === "all" ? 30 : Number(period);
    const requestedMovement = request.nextUrl.searchParams.get("movement") ?? "all";
    const movement = ["all", "down", "up"].includes(requestedMovement) ? requestedMovement : "all";
    const requestedThreshold = Number(request.nextUrl.searchParams.get("threshold")) || 0;
    const threshold = [0, 5, 10, 20].includes(requestedThreshold) ? requestedThreshold : 0;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 50, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const sql = getSql();

    const rows = await sql`
      WITH ordered_prices AS (
        SELECT
          ph.price_usd,
          ph.scraped_at,
          LAG(ph.price_usd) OVER (ORDER BY ph.scraped_at) AS previous_price
        FROM price_history ph
        WHERE ph.product_id = ${productId}
      ), changes AS (
        SELECT
          price_usd,
          previous_price,
          scraped_at,
          price_usd - previous_price AS difference_usd,
          ROUND(((price_usd - previous_price) / NULLIF(previous_price, 0)) * 100, 2) AS change_pct
        FROM ordered_prices
        WHERE previous_price IS NOT NULL
          AND price_usd IS DISTINCT FROM previous_price
      )
      SELECT
        price_usd, previous_price, scraped_at, difference_usd, change_pct,
        COUNT(*) OVER()::int AS total_count
      FROM changes
      WHERE (
          ${period} = 'all'
          OR scraped_at >= CASE
            WHEN ${days} = 1 THEN
              date_trunc('day', NOW() AT TIME ZONE 'America/Caracas') AT TIME ZONE 'America/Caracas'
            ELSE NOW() - (${days} * INTERVAL '1 day')
          END
        )
        AND ABS(change_pct) >= ${threshold}
        AND (
          ${movement} = 'all'
          OR (${movement} = 'down' AND difference_usd < 0)
          OR (${movement} = 'up' AND difference_usd > 0)
        )
      ORDER BY scraped_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const items = rows.map((row) => ({
      price: asNumber(row.price_usd),
      previousPrice: asNumber(row.previous_price),
      scrapedAt: row.scraped_at,
      differenceUsd: asNumber(row.difference_usd),
      changePct: asNumber(row.change_pct)
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
    return NextResponse.json({ error: "No fue posible cargar los movimientos del producto" }, { status: 500 });
  }
}
