import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Evidence = {
  brand?: string;
  productType?: string;
  sharedModels?: string[];
  sharedAttributes?: string[];
  warnings?: string[];
  conflicts?: string[];
  candidateRank?: number;
  candidateCount?: number;
  candidateTotal?: number;
};

function isBulkEligible(confidence: number, method: string, evidence: Evidence) {
  const numericAttributes = (evidence.sharedAttributes ?? []).filter((value) => !value.startsWith("tech:"));
  const strongIdentity = (evidence.sharedModels?.length ?? 0) > 0 || numericAttributes.length >= 2;
  return confidence >= 0.85
    && evidence.candidateRank === 1
    && Boolean(evidence.brand && evidence.productType)
    && strongIdentity
    && (evidence.warnings?.length ?? 0) === 0
    && (evidence.conflicts?.length ?? 0) === 0
    && ["model_brand", "brand_type_attributes"].includes(method);
}

async function confirmOne(sql: ReturnType<typeof getSql>, matchId: number) {
  return sql`
    WITH target AS (
      SELECT pm.id, pm.daka_product_id, pm.competitor_product_id, c.source_id
      FROM product_matches pm JOIN products c ON c.id = pm.competitor_product_id
      WHERE pm.id = ${matchId} AND pm.status = 'review'
    ), rejected_conflicts AS (
      UPDATE product_matches other SET status = 'rejected', updated_at = NOW()
      FROM target
      WHERE other.id <> target.id AND other.status IN ('auto', 'review')
        AND (
          other.competitor_product_id = target.competitor_product_id
          OR (other.daka_product_id = target.daka_product_id AND EXISTS (
            SELECT 1 FROM products other_competitor
            WHERE other_competitor.id = other.competitor_product_id
              AND other_competitor.source_id = target.source_id
          ))
        )
      RETURNING other.id
    )
    UPDATE product_matches pm SET status = 'confirmed', updated_at = NOW()
    FROM target WHERE pm.id = target.id RETURNING pm.id
  `;
}

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "damasco";
    const source = ["damasco", "multimax", "ivoo"].includes(requestedSource) ? requestedSource : "damasco";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const searchLike = `%${search}%`;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 15, 1), 25);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const rows = await sql`
      WITH latest_daka_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'daka' AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      ), latest_competitor_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = ${source} AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      )
      SELECT pm.id AS match_id, pm.confidence, pm.match_method, pm.evidence,
        d.id AS daka_id, d.external_id AS daka_sap, d.name AS daka_name,
        d.brand AS daka_brand, d.model AS daka_model, d.category AS daka_category,
        d.url AS daka_url, dp.price_usd AS daka_price, dp.in_stock AS daka_in_stock,
        c.id AS competitor_id, c.external_id AS competitor_reference,
        c.name AS competitor_name, c.url AS competitor_url, c.brand AS competitor_brand,
        c.model AS competitor_model, c.category AS competitor_category,
        cp.price_usd AS competitor_price, cp.in_stock AS competitor_in_stock
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
      LEFT JOIN price_history dp ON dp.product_id = d.id
        AND dp.job_id = (SELECT id FROM latest_daka_job)
      LEFT JOIN price_history cp ON cp.product_id = c.id
        AND cp.job_id = (SELECT id FROM latest_competitor_job)
      WHERE pm.status = 'review'
        AND (${search} = '' OR d.name ILIKE ${searchLike} OR d.external_id ILIKE ${searchLike}
          OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike})
      ORDER BY d.id, pm.confidence DESC, pm.id ASC
    `;

    const grouped = new Map<number, any>();
    for (const row of rows) {
      const dakaId = asNumber(row.daka_id);
      if (!grouped.has(dakaId)) {
        grouped.set(dakaId, {
          daka: {
            id: dakaId, externalId: row.daka_sap, name: row.daka_name, url: row.daka_url,
            price: row.daka_price == null ? null : asNumber(row.daka_price), inStock: row.daka_in_stock,
            brand: row.daka_brand ?? null, model: row.daka_model ?? null, category: row.daka_category ?? null,
          },
          candidates: [],
        });
      }
      const evidence = (row.evidence ?? {}) as Evidence;
      const confidence = asNumber(row.confidence);
      grouped.get(dakaId).candidates.push({
        matchId: asNumber(row.match_id), confidence, matchMethod: row.match_method, evidence,
        bulkEligible: isBulkEligible(confidence, row.match_method, evidence),
        competitor: {
          id: asNumber(row.competitor_id), externalId: row.competitor_reference,
          name: row.competitor_name, url: row.competitor_url, brand: row.competitor_brand ?? null,
          model: row.competitor_model ?? null, category: row.competitor_category ?? null,
          price: row.competitor_price == null ? null : asNumber(row.competitor_price),
          inStock: row.competitor_in_stock,
        },
      });
    }
    const groups = [...grouped.values()].sort((left, right) =>
      (right.candidates[0]?.confidence ?? 0) - (left.candidates[0]?.confidence ?? 0)
      || left.daka.name.localeCompare(right.daka.name, "es")
    );
    const page = groups.slice(offset, offset + limit);
    return NextResponse.json({
      source,
      groups: page,
      totalProducts: groups.length,
      totalAlternatives: rows.length,
      safeCandidates: groups.filter((group) => group.candidates.some((candidate: any) => candidate.bulkEligible)).length,
      offset,
      limit,
      hasMore: offset + page.length < groups.length,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible cargar las homologaciones pendientes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey || request.headers.get("x-admin-key") !== configuredKey) {
    return NextResponse.json({ error: "Clave administrativa incorrecta" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const sql = getSql();
    if (body.action === "confirm_bulk") {
      const submittedIds: unknown[] = Array.isArray(body.matchIds) ? body.matchIds : [];
      const matchIds: number[] = [...new Set<number>(submittedIds
        .map((value) => Number(value))
        .filter((id) => Number.isInteger(id) && id > 0))]
        .slice(0, 50);
      if (!matchIds.length) return NextResponse.json({ error: "No seleccionaste coincidencias válidas" }, { status: 400 });
      let confirmed = 0;
      let skipped = 0;
      for (const matchId of matchIds) {
        const candidateRows = await sql`SELECT confidence, match_method, evidence FROM product_matches WHERE id = ${matchId} AND status = 'review'`;
        const candidate = candidateRows[0];
        if (!candidate || !isBulkEligible(asNumber(candidate.confidence), candidate.match_method, candidate.evidence ?? {})) {
          skipped += 1;
          continue;
        }
        const rows = await confirmOne(sql, matchId);
        if (rows.length) confirmed += 1;
        else skipped += 1;
      }
      return NextResponse.json({ ok: true, status: "confirmed", confirmed, skipped });
    }

    const matchId = Number(body.matchId);
    const action = body.action;
    if (!Number.isInteger(matchId) || matchId <= 0 || !["confirm", "reject"].includes(action)) {
      return NextResponse.json({ error: "Solicitud de homologación inválida" }, { status: 400 });
    }
    if (action === "reject") {
      const rows = await sql`
        UPDATE product_matches SET status = 'rejected', updated_at = NOW()
        WHERE id = ${matchId} AND status = 'review'
        RETURNING id
      `;
      if (!rows.length) return NextResponse.json({ error: "La coincidencia ya fue procesada" }, { status: 409 });
      return NextResponse.json({ ok: true, status: "rejected" });
    }
    const rows = await confirmOne(sql, matchId);
    if (!rows.length) return NextResponse.json({ error: "La coincidencia ya fue procesada" }, { status: 409 });
    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible guardar la decisión" }, { status: 500 });
  }
}
