import { NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT j.id, j.trigger_type, j.status, j.started_at, j.finished_at,
        j.products_found, j.products_saved, j.products_without_sku,
        j.pages_scanned, j.error_message, j.logs,
        EXTRACT(EPOCH FROM (j.finished_at - j.started_at))::int AS duration_seconds
      FROM scraping_jobs j
      JOIN sources s ON s.id = j.source_id AND s.slug = 'daka'
      ORDER BY j.started_at DESC
      LIMIT 20
    `;
    return NextResponse.json(rows.map((row) => ({
      id: row.id,
      triggerType: row.trigger_type,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      productsFound: asNumber(row.products_found),
      productsSaved: asNumber(row.products_saved),
      productsWithoutSku: asNumber(row.products_without_sku),
      pagesScanned: asNumber(row.pages_scanned),
      durationSeconds: row.duration_seconds == null ? null : asNumber(row.duration_seconds),
      errorMessage: row.error_message,
      logs: Array.isArray(row.logs) ? row.logs : []
    })));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar las ejecuciones" }, { status: 500 });
  }
}
