import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { buildExecutivePosition, type ExecutiveSource, type PairSnapshot, type SourceSnapshot } from "@/lib/executive-summary";

export const dynamic = "force-dynamic";

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch { return ""; }
}

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const section = request.nextUrl.searchParams.get("section");
    const [sourceRows, pairRows] = await Promise.all([
      section === "position" ? Promise.resolve([]) : sql`
        SELECT s.slug, s.name, current_job.captured_at AS current_at,
          previous_job.captured_at AS previous_at,
          COUNT(ph.product_id)::int AS captured,
          COUNT(*) FILTER (WHERE ph.price_usd > 0)::int AS with_price,
          COUNT(*) FILTER (WHERE ph.product_id IS NOT NULL AND ph.in_stock = TRUE)::int AS available,
          COUNT(*) FILTER (WHERE ph.product_id IS NOT NULL AND ph.in_stock = FALSE)::int AS unavailable,
          COUNT(*) FILTER (WHERE ph.product_id IS NOT NULL AND ph.in_stock IS NULL)::int AS unknown_availability,
          COUNT(*) FILTER (WHERE ph.price_usd > old.price_usd AND old.price_usd > 0)::int AS increased,
          COUNT(*) FILTER (WHERE ph.price_usd < old.price_usd AND ph.price_usd > 0)::int AS decreased,
          COUNT(*) FILTER (WHERE ph.price_usd = old.price_usd AND ph.price_usd > 0)::int AS unchanged,
          COUNT(*) FILTER (WHERE ph.price_usd > 0 AND old.price_usd > 0)::int AS compared
        FROM sources s
        LEFT JOIN LATERAL (
          SELECT j.id, COALESCE(j.finished_at, j.started_at) AS captured_at
          FROM scraping_jobs j WHERE j.source_id = s.id AND j.status = 'success'
          ORDER BY j.started_at DESC LIMIT 1
        ) current_job ON TRUE
        LEFT JOIN LATERAL (
          SELECT j.id, COALESCE(j.finished_at, j.started_at) AS captured_at
          FROM scraping_jobs j WHERE j.source_id = s.id AND j.status = 'success'
          ORDER BY j.started_at DESC LIMIT 1 OFFSET 1
        ) previous_job ON TRUE
        LEFT JOIN display_price_history ph ON ph.job_id = current_job.id
        LEFT JOIN display_price_history old ON old.job_id = previous_job.id AND old.product_id = ph.product_id
        WHERE s.active = TRUE AND s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
        GROUP BY s.slug, s.name, current_job.captured_at, previous_job.captured_at
        ORDER BY CASE s.slug
          WHEN 'daka' THEN 1 WHEN 'damasco' THEN 2 WHEN 'multimax' THEN 3
          WHEN 'ivoo' THEN 4 WHEN 'venelectronics' THEN 5 ELSE 6 END
      `,
      section === "activity" ? Promise.resolve([]) : sql`
        WITH latest_jobs AS (
          SELECT j.id, s.id AS source_id, j.captured_at
          FROM sources s
          JOIN LATERAL (
            SELECT id, COALESCE(finished_at, started_at) AS captured_at
            FROM scraping_jobs WHERE source_id = s.id AND status = 'success'
            ORDER BY started_at DESC LIMIT 1
          ) j ON TRUE
          WHERE s.active = TRUE AND s.slug IN ('daka', 'damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
        ), selected_matches AS (
          SELECT DISTINCT ON (pm.daka_product_id, cs.id)
            pm.daka_product_id, pm.competitor_product_id, cs.id AS competitor_source_id
          FROM product_matches pm
          JOIN products c ON c.id = pm.competitor_product_id
          JOIN sources cs ON cs.id = c.source_id AND cs.active = TRUE
            AND cs.slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
          WHERE pm.status IN ('auto', 'confirmed')
          ORDER BY pm.daka_product_id, cs.id,
            CASE WHEN pm.status = 'confirmed' THEN 0 ELSE 1 END,
            pm.confidence DESC, pm.updated_at DESC, pm.id DESC
        )
        SELECT
          d.id AS daka_id, d.external_id AS daka_sku, d.name AS daka_name, d.url AS daka_url,
          cs.slug AS competitor_source, cs.name AS competitor_source_name,
          c.name AS competitor_name, c.url AS competitor_url,
          dp.price_usd AS daka_price, cp.price_usd AS competitor_price,
          dp.in_stock AS daka_available, cp.in_stock AS competitor_available,
          dj.captured_at AS daka_at, cj.captured_at AS competitor_at
        FROM selected_matches sm
        JOIN products d ON d.id = sm.daka_product_id
        JOIN sources ds ON ds.id = d.source_id AND ds.slug = 'daka'
        JOIN products c ON c.id = sm.competitor_product_id
        JOIN sources cs ON cs.id = sm.competitor_source_id
        JOIN latest_jobs dj ON dj.source_id = ds.id
        JOIN latest_jobs cj ON cj.source_id = cs.id
        JOIN display_price_history dp ON dp.product_id = d.id AND dp.job_id = dj.id
        JOIN display_price_history cp ON cp.product_id = c.id AND cp.job_id = cj.id
        WHERE dp.price_usd > 0 AND cp.price_usd > 0
          AND dp.in_stock = TRUE AND cp.in_stock = TRUE
          AND dj.captured_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()
          AND cj.captured_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW()
      `
    ]);

    const sources: SourceSnapshot[] = sourceRows.map((row) => ({
      source: String(row.slug) as ExecutiveSource,
      name: String(row.name), currentAt: iso(row.current_at), previousAt: iso(row.previous_at),
      captured: asNumber(row.captured), withPrice: asNumber(row.with_price),
      available: asNumber(row.available), unavailable: asNumber(row.unavailable),
      unknownAvailability: asNumber(row.unknown_availability),
      increased: asNumber(row.increased), decreased: asNumber(row.decreased),
      unchanged: asNumber(row.unchanged), compared: asNumber(row.compared)
    }));
    const pairs: PairSnapshot[] = pairRows.map((row) => ({
      dakaId: asNumber(row.daka_id), dakaSku: String(row.daka_sku), dakaName: String(row.daka_name),
      dakaUrl: safeUrl(row.daka_url), source: String(row.competitor_source) as PairSnapshot["source"],
      sourceName: String(row.competitor_source_name), competitorName: String(row.competitor_name),
      competitorUrl: safeUrl(row.competitor_url),
      dakaPrice: row.daka_price == null ? null : asNumber(row.daka_price),
      competitorPrice: row.competitor_price == null ? null : asNumber(row.competitor_price),
      dakaAvailable: row.daka_available == null ? null : Boolean(row.daka_available),
      competitorAvailable: row.competitor_available == null ? null : Boolean(row.competitor_available),
      dakaAt: iso(row.daka_at), competitorAt: iso(row.competitor_at)
    }));
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      definition: "Últimas dos capturas exitosas por fuente; comparación web homologada con precios y disponibilidad confirmados en las últimas 48 horas.",
      sources, position: buildExecutivePosition(pairs)
    });
  } catch (error) {
    console.error("executive-summary", error);
    return NextResponse.json({ error: "No fue posible preparar el resumen ejecutivo" }, { status: 500 });
  }
}
