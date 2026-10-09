import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { caracasToday, isValidIsoDate, shiftIsoDate } from "@/lib/catalog-comparison";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  try {
    const { productId: rawProductId } = await context.params;
    const productId = Number(rawProductId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return NextResponse.json({ error: "Producto inválido" }, { status: 400 });
    }
    const today = caracasToday();
    const requestedStart = request.nextUrl.searchParams.get("startDate") ?? shiftIsoDate(today, -29);
    const requestedEnd = request.nextUrl.searchParams.get("endDate") ?? today;
    if (!isValidIsoDate(requestedStart) || !isValidIsoDate(requestedEnd) || requestedStart > requestedEnd || requestedEnd > today) {
      return NextResponse.json({ error: "Rango histórico inválido" }, { status: 400 });
    }
    const sql = getSql();
    const productRows = await sql`
      SELECT p.id, p.external_id, p.name, p.brand, p.category, p.url, p.image_url,
        p.first_seen_at, p.last_seen_at, p.source_id, s.slug AS source_slug, s.name AS source_name
      FROM products p JOIN sources s ON s.id = p.source_id WHERE p.id = ${productId}
    `;
    if (!productRows.length) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    const product = productRows[0];
    const rows = await sql`
      WITH daily_jobs AS (
        SELECT DISTINCT ON (job_date) id, job_date, finished_at
        FROM (
          SELECT j.id, COALESCE(j.finished_at, j.started_at) AS finished_at,
            (COALESCE(j.finished_at, j.started_at) AT TIME ZONE 'America/Caracas')::date AS job_date
          FROM scraping_jobs j
          WHERE j.source_id = ${product.source_id} AND j.status = 'success' AND j.products_saved > 0
            AND j.products_saved = GREATEST(j.products_found - j.products_without_sku, 0)
        ) valid
        WHERE job_date BETWEEN ${requestedStart}::date AND ${requestedEnd}::date
        ORDER BY job_date, finished_at DESC, id DESC
      )
      SELECT dj.id AS job_id, dj.job_date, dj.finished_at,
        ph.id IS NOT NULL AS detected, ph.price_usd, ph.list_price_usd,
        ph.in_stock, ph.available_quantity, ph.scraped_at
      FROM daily_jobs dj
      LEFT JOIN price_history ph ON ph.job_id = dj.id AND ph.product_id = ${productId}
      ORDER BY dj.job_date
    `;
    let consecutiveAbsences = 0;
    const points = rows.map((row) => {
      if (row.detected) consecutiveAbsences = 0;
      else consecutiveAbsences += 1;
      return {
        jobId: row.job_id, date: row.job_date, finishedAt: row.finished_at,
        detected: Boolean(row.detected), consecutiveAbsences,
        price: row.price_usd == null ? null : asNumber(row.price_usd),
        listPrice: row.list_price_usd == null ? null : asNumber(row.list_price_usd),
        inStock: row.in_stock,
        availableQuantity: row.available_quantity == null ? null : asNumber(row.available_quantity),
        scrapedAt: row.scraped_at ?? null
      };
    });
    return NextResponse.json({
      period: { startDate: requestedStart, endDate: requestedEnd },
      product: {
        id: asNumber(product.id), externalId: product.external_id, name: product.name,
        brand: product.brand ?? null, category: product.category ?? null, url: product.url,
        imageUrl: product.image_url ?? null, source: product.source_slug, sourceName: product.source_name,
        firstSeenAt: product.first_seen_at, lastSeenAt: product.last_seen_at
      },
      points
    });
  } catch (error) {
    console.error("Catalog product history failed", error);
    return NextResponse.json({ error: "No fue posible consultar el historial de presencia" }, { status: 500 });
  }
}
