import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const productId = Number(id);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
    }
    const sql = getSql();
    const rows = await sql`
      SELECT price_usd, scraped_at,
        LAG(price_usd) OVER (ORDER BY scraped_at) AS previous_price
      FROM price_history
      WHERE product_id = ${productId}
      ORDER BY scraped_at DESC
      LIMIT 90
    `;
    return NextResponse.json(rows.map((row) => {
      const price = asNumber(row.price_usd);
      const previous = row.previous_price == null ? null : asNumber(row.previous_price);
      return {
        price,
        scrapedAt: row.scraped_at,
        previousPrice: previous,
        differenceUsd: previous == null ? null : price - previous,
        changePct: previous && previous !== 0 ? ((price - previous) / previous) * 100 : null
      };
    }));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar el histórico" }, { status: 500 });
  }
}
