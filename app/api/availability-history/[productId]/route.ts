import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { resolveComparisonPeriod } from "@/lib/comparison-period";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId: rawProductId } = await context.params;
    const productId = Number(rawProductId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
    }
    const period = resolveComparisonPeriod(request.nextUrl.searchParams);
    const sql = getSql();
    const rows = await sql`
      WITH product_source AS (
        SELECT p.id, p.external_id, p.name, p.category, p.url, p.source_id,
          s.slug AS source_slug, s.name AS source_name
        FROM products p JOIN sources s ON s.id = p.source_id
        WHERE p.id = ${productId}
      ), daily_jobs AS (
        SELECT DISTINCT ON (capture_date) id, capture_date
        FROM (
          SELECT j.id,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS capture_date,
            COALESCE(j.finished_at, j.started_at) AS completed_at
          FROM scraping_jobs j JOIN product_source ps ON ps.source_id = j.source_id
          WHERE j.status = 'success'
        ) jobs
        WHERE capture_date BETWEEN ${period.startDate}::date AND ${period.endDate}::date
        ORDER BY capture_date, completed_at DESC, id DESC
      ), captures AS (
        SELECT ps.*, dj.capture_date, ph.available_quantity,
          CASE
            WHEN ph.in_stock IS TRUE OR COALESCE(ph.available_quantity, 0) > 0 THEN TRUE
            WHEN ph.in_stock IS FALSE OR ph.available_quantity = 0 THEN FALSE
            ELSE NULL
          END AS is_available
        FROM daily_jobs dj CROSS JOIN product_source ps
        LEFT JOIN price_history ph ON ph.job_id = dj.id AND ph.product_id = ps.id
      ), observed AS (
        SELECT *, LAG(available_quantity) OVER (ORDER BY capture_date) AS previous_quantity
        FROM captures WHERE available_quantity IS NOT NULL OR is_available IS NOT NULL
      )
      SELECT * FROM observed ORDER BY capture_date
    `;
    if (!rows.length) {
      const productRows = await sql`
        SELECT p.id, p.external_id, p.name, p.category, p.url, s.slug AS source_slug, s.name AS source_name
        FROM products p JOIN sources s ON s.id = p.source_id WHERE p.id = ${productId}
      `;
      if (!productRows.length) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
      const product = productRows[0];
      return NextResponse.json({ period, product: { id: asNumber(product.id), externalId: product.external_id, name: product.name, category: product.category, url: product.url, source: product.source_slug, sourceName: product.source_name }, points: [] });
    }
    const product = rows[0];
    return NextResponse.json({
      period,
      product: { id: asNumber(product.id), externalId: product.external_id, name: product.name, category: product.category, url: product.url, source: product.source_slug, sourceName: product.source_name },
      points: rows.map((row) => ({
        date: row.capture_date,
        quantity: row.available_quantity == null ? null : asNumber(row.available_quantity),
        previousQuantity: row.previous_quantity == null ? null : asNumber(row.previous_quantity),
        difference: row.available_quantity == null || row.previous_quantity == null ? null : asNumber(row.available_quantity) - asNumber(row.previous_quantity),
        available: row.is_available
      }))
    });
  } catch (error) {
    console.error("Product availability history failed", error);
    const message = error instanceof Error && (error.message.includes("fecha") || error.message.includes("rango personalizado"))
      ? error.message
      : "No fue posible consultar el histórico del producto";
    return NextResponse.json({ error: message }, { status: message.startsWith("No fue posible") ? 500 : 400 });
  }
}
