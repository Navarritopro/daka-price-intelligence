import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const searchLike = `%${search}%`;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 25, 1), 50);
    const offset = Math.max(Number(request.nextUrl.searchParams.get("offset")) || 0, 0);
    const rows = await sql`
      WITH latest_daka_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'daka' AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      ), latest_damasco_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'damasco' AND j.status = 'success'
        ORDER BY j.started_at DESC LIMIT 1
      )
      SELECT pm.id AS match_id, pm.confidence, pm.match_method, pm.evidence,
        d.id AS daka_id, d.external_id AS daka_sap, d.name AS daka_name,
        d.url AS daka_url, dp.price_usd AS daka_price, dp.in_stock AS daka_in_stock,
        c.id AS competitor_id, c.external_id AS competitor_reference,
        c.name AS competitor_name, c.url AS competitor_url, c.brand AS competitor_brand,
        cp.price_usd AS competitor_price, cp.in_stock AS competitor_in_stock,
        COUNT(*) OVER()::int AS total_count
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources s ON s.id = c.source_id AND s.slug = 'damasco'
      LEFT JOIN price_history dp ON dp.product_id = d.id
        AND dp.job_id = (SELECT id FROM latest_daka_job)
      LEFT JOIN price_history cp ON cp.product_id = c.id
        AND cp.job_id = (SELECT id FROM latest_damasco_job)
      WHERE pm.status = 'review'
        AND (${search} = '' OR d.name ILIKE ${searchLike} OR d.external_id ILIKE ${searchLike}
          OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike})
      ORDER BY pm.confidence DESC, d.name ASC, pm.id ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const items = rows.map((row) => ({
      matchId: asNumber(row.match_id), confidence: asNumber(row.confidence),
      matchMethod: row.match_method, evidence: row.evidence ?? {},
      daka: { id: asNumber(row.daka_id), externalId: row.daka_sap, name: row.daka_name,
        url: row.daka_url, price: row.daka_price == null ? null : asNumber(row.daka_price),
        inStock: row.daka_in_stock },
      competitor: { id: asNumber(row.competitor_id), externalId: row.competitor_reference,
        name: row.competitor_name, url: row.competitor_url, brand: row.competitor_brand,
        price: row.competitor_price == null ? null : asNumber(row.competitor_price),
        inStock: row.competitor_in_stock }
    }));
    const total = rows.length ? asNumber(rows[0].total_count) : 0;
    return NextResponse.json({ items, total, offset, limit, hasMore: offset + items.length < total });
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
    const matchId = Number(body.matchId);
    const action = body.action;
    if (!Number.isInteger(matchId) || matchId <= 0 || !["confirm", "reject"].includes(action)) {
      return NextResponse.json({ error: "Solicitud de homologación inválida" }, { status: 400 });
    }
    const sql = getSql();
    if (action === "reject") {
      const rows = await sql`
        UPDATE product_matches SET status = 'rejected', updated_at = NOW()
        WHERE id = ${matchId} AND status = 'review'
        RETURNING id
      `;
      if (!rows.length) return NextResponse.json({ error: "La coincidencia ya fue procesada" }, { status: 409 });
      return NextResponse.json({ ok: true, status: "rejected" });
    }
    const rows = await sql`
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
    if (!rows.length) return NextResponse.json({ error: "La coincidencia ya fue procesada" }, { status: 409 });
    return NextResponse.json({ ok: true, status: "confirmed" });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "No fue posible guardar la decisión" }, { status: 500 });
  }
}
