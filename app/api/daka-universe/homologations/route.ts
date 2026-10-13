import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { asNumber, getSql } from "@/lib/db";
import { candidateScore, HOMOLOGATION_SORTS, suggestionLevel, type HomologationSort } from "@/lib/daka-homologation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCES = ["damasco", "multimax", "ivoo", "venelectronics", "soytechno"] as const;
type SourceSlug = typeof SOURCES[number];

function isSource(value: string): value is SourceSlug {
  return (SOURCES as readonly string[]).includes(value);
}

async function actor(request: NextRequest) {
  const user = await getRequestUser(request);
  return user?.role === "admin" ? user : null;
}

export async function GET(request: NextRequest) {
  try {
    const sql = getSql();
    const params = request.nextUrl.searchParams;
    const mode = params.get("mode") === "candidates" ? "candidates" : "list";
    if (mode === "candidates") {
      const sku = params.get("sku")?.trim().toUpperCase() ?? "";
      const requestedSource = params.get("source")?.trim() ?? "";
      const search = params.get("search")?.trim() ?? "";
      if (!sku || !isSource(requestedSource)) return NextResponse.json({ error: "SKU o competidor inválido" }, { status: 400 });
      const [master] = await sql`SELECT sku, description, brand, line, family FROM daka_sku_master WHERE sku = ${sku}`;
      if (!master) return NextResponse.json({ error: "El SKU no existe en el universo" }, { status: 404 });
      const searchLike = `%${search}%`;
      const candidateLimit = search ? 500 : 3500;
      const rows = await sql`
        WITH latest_job AS (
          SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
          WHERE s.slug = ${requestedSource} AND j.status = 'success' ORDER BY j.started_at DESC LIMIT 1
        )
        SELECT p.id, p.external_id, p.name, p.brand, p.model, p.category, p.url,
          ph.price_usd, ph.in_stock
        FROM products p JOIN sources s ON s.id = p.source_id AND s.slug = ${requestedSource}
        LEFT JOIN price_history ph ON ph.product_id = p.id AND ph.job_id = (SELECT id FROM latest_job)
        WHERE p.active = TRUE
          AND (${search} = '' OR p.name ILIKE ${searchLike} OR p.external_id ILIKE ${searchLike}
            OR COALESCE(p.brand, '') ILIKE ${searchLike} OR COALESCE(p.model, '') ILIKE ${searchLike})
        ORDER BY p.last_seen_at DESC, p.name
        LIMIT ${candidateLimit}
      `;
      const ranked = rows.map((row) => ({
        id: asNumber(row.id), externalId: row.external_id, name: row.name, brand: row.brand ?? null,
        model: row.model ?? null, category: row.category ?? null, url: row.url,
        price: row.price_usd == null ? null : asNumber(row.price_usd), inStock: row.in_stock ?? null,
        score: candidateScore(master as any, row as any)
      })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"));
      const items = (search ? ranked : ranked.filter((item) => item.score >= 0.08)).slice(0, 30).map((item) => ({
        ...item,
        suggestionLevel: suggestionLevel(item.score)
      }));
      return NextResponse.json({ sku, source: requestedSource, items, catalogSize: rows.length, automatic: !search });
    }

    const search = params.get("search")?.trim() ?? "";
    const brand = params.get("brand")?.trim() ?? "";
    const line = params.get("line")?.trim() ?? "";
    const status = ["all", "pending", "complete", "partial", "no_applicable"].includes(params.get("status") ?? "") ? params.get("status")! : "all";
    const requestedSort = params.get("sort") ?? "pending_desc";
    const sort: HomologationSort = HOMOLOGATION_SORTS.includes(requestedSort as HomologationSort) ? requestedSort as HomologationSort : "pending_desc";
    const limit = Math.min(Math.max(Number(params.get("limit")) || 20, 1), 50);
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;
    const brandLike = `%${brand}%`;
    const lineLike = `%${line}%`;
    const rows = await sql`
      WITH latest_prices AS (
        SELECT id, effective_date FROM daka_price_snapshots WHERE is_active ORDER BY effective_date DESC, created_at DESC LIMIT 1
      ), base AS (
        SELECT m.sku, m.description, m.brand, m.line, m.family, m.subfamily, m.active,
          pi.price_usd, lp.effective_date AS price_date, p.id AS web_product_id, p.url AS web_url
        FROM daka_sku_master m
        LEFT JOIN latest_prices lp ON TRUE
        LEFT JOIN daka_price_items pi ON pi.snapshot_id = lp.id AND pi.sku = m.sku
        LEFT JOIN sources ds ON ds.slug = 'daka'
        LEFT JOIN products p ON p.source_id = ds.id AND p.external_id = m.sku
        WHERE (${search} = '' OR m.sku ILIKE ${searchLike} OR m.description ILIKE ${searchLike})
          AND (${brand} = '' OR m.brand ILIKE ${brandLike})
          AND (${line} = '' OR m.line ILIKE ${lineLike})
      ), comparison_gaps AS (
        SELECT um.sku, ABS(latest.price_usd - b.price_usd) AS gap
        FROM daka_universe_matches um
        JOIN base b ON b.sku = um.sku AND b.price_usd IS NOT NULL
        JOIN products cp ON cp.id = um.competitor_product_id
        JOIN LATERAL (
          SELECT ph.price_usd FROM price_history ph JOIN scraping_jobs j ON j.id = ph.job_id
          WHERE ph.product_id = cp.id AND j.status = 'success' AND ph.price_usd IS NOT NULL
          ORDER BY ph.scraped_at DESC LIMIT 1
        ) latest ON TRUE
        WHERE um.status = 'confirmed'
        UNION ALL
        SELECT dp.external_id AS sku, ABS(latest.price_usd - b.price_usd) AS gap
        FROM product_matches pm
        JOIN products dp ON dp.id = pm.daka_product_id
        JOIN base b ON b.sku = dp.external_id AND b.price_usd IS NOT NULL
        JOIN products cp ON cp.id = pm.competitor_product_id
        JOIN LATERAL (
          SELECT ph.price_usd FROM price_history ph JOIN scraping_jobs j ON j.id = ph.job_id
          WHERE ph.product_id = cp.id AND j.status = 'success' AND ph.price_usd IS NOT NULL
          ORDER BY ph.scraped_at DESC LIMIT 1
        ) latest ON TRUE
        WHERE pm.status IN ('auto', 'confirmed')
      ), counts AS (
        SELECT b.*,
          (SELECT COUNT(*) FROM daka_universe_matches um WHERE um.sku = b.sku AND um.status = 'confirmed')::int AS manual_count,
          (SELECT COUNT(*) FROM product_matches pm JOIN products dp ON dp.id = pm.daka_product_id
            WHERE dp.external_id = b.sku AND pm.status IN ('auto', 'confirmed'))::int AS web_count,
          (SELECT COUNT(*) FROM daka_universe_matches um WHERE um.sku = b.sku AND um.status = 'no_applicable')::int AS no_apply_count,
          (SELECT MAX(cg.gap) FROM comparison_gaps cg WHERE cg.sku = b.sku) AS max_gap
        FROM base b
      ), filtered AS (
        SELECT *, LEAST(5, manual_count + web_count + no_apply_count) AS decision_count
        FROM counts
        WHERE (${status} = 'all'
          OR (${status} = 'pending' AND manual_count + web_count + no_apply_count = 0)
          OR (${status} = 'complete' AND manual_count + web_count + no_apply_count >= 5)
          OR (${status} = 'partial' AND manual_count + web_count + no_apply_count BETWEEN 1 AND 4)
          OR (${status} = 'no_applicable' AND no_apply_count > 0))
      )
      SELECT *, COUNT(*) OVER()::int AS total_count FROM filtered
      ORDER BY
        CASE WHEN ${sort} = 'pending_desc' THEN decision_count END ASC,
        CASE WHEN ${sort} = 'pending_asc' THEN decision_count END DESC,
        CASE WHEN ${sort} = 'gap_desc' THEN max_gap END DESC NULLS LAST,
        description ASC, sku ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const skus = rows.map((row) => row.sku);
    const universeMatches = skus.length ? await sql`
      SELECT um.sku, s.slug AS source, um.id, um.status, um.reason, um.notes, um.updated_at,
        p.id AS product_id, p.external_id, p.name, p.brand, p.model, p.category, p.url,
        latest.price_usd, latest.in_stock
      FROM daka_universe_matches um JOIN sources s ON s.id = um.source_id
      LEFT JOIN products p ON p.id = um.competitor_product_id
      LEFT JOIN LATERAL (
        SELECT ph.price_usd, ph.in_stock FROM price_history ph JOIN scraping_jobs j ON j.id = ph.job_id
        WHERE ph.product_id = p.id AND j.status = 'success' ORDER BY ph.scraped_at DESC LIMIT 1
      ) latest ON TRUE
      WHERE um.sku IN ${sql(skus)} AND um.status IN ('confirmed', 'no_applicable')
    ` : [];
    const webMatches = skus.length ? await sql`
      SELECT dp.external_id AS sku, s.slug AS source, pm.id, cp.id AS product_id, cp.external_id,
        cp.name, cp.brand, cp.model, cp.category, cp.url, latest.price_usd, latest.in_stock
      FROM product_matches pm JOIN products dp ON dp.id = pm.daka_product_id
      JOIN products cp ON cp.id = pm.competitor_product_id JOIN sources s ON s.id = cp.source_id
      LEFT JOIN LATERAL (
        SELECT ph.price_usd, ph.in_stock FROM price_history ph JOIN scraping_jobs j ON j.id = ph.job_id
        WHERE ph.product_id = cp.id AND j.status = 'success' ORDER BY ph.scraped_at DESC LIMIT 1
      ) latest ON TRUE
      WHERE dp.external_id IN ${sql(skus)} AND pm.status IN ('auto', 'confirmed')
    ` : [];
    const bySku = new Map<string, Record<string, any>>();
    for (const row of universeMatches) {
      const entries = bySku.get(row.sku) ?? {};
      entries[row.source] = row.status === "no_applicable"
        ? { origin: "universe", matchId: asNumber(row.id), status: "no_applicable", reason: row.reason, notes: row.notes, updatedAt: row.updated_at }
        : { origin: "universe", matchId: asNumber(row.id), status: "confirmed", updatedAt: row.updated_at, product: {
            id: asNumber(row.product_id), externalId: row.external_id, name: row.name, brand: row.brand ?? null,
            model: row.model ?? null, category: row.category ?? null, url: row.url,
            price: row.price_usd == null ? null : asNumber(row.price_usd), inStock: row.in_stock ?? null
          } };
      bySku.set(row.sku, entries);
    }
    for (const row of webMatches) {
      const entries = bySku.get(row.sku) ?? {};
      if (!entries[row.source]) entries[row.source] = { origin: "web", matchId: asNumber(row.id), status: "confirmed", product: {
        id: asNumber(row.product_id), externalId: row.external_id, name: row.name, brand: row.brand ?? null,
        model: row.model ?? null, category: row.category ?? null, url: row.url,
        price: row.price_usd == null ? null : asNumber(row.price_usd), inStock: row.in_stock ?? null
      } };
      bySku.set(row.sku, entries);
    }
    const [filterValues] = await sql`
      SELECT ARRAY(SELECT DISTINCT brand FROM daka_sku_master ORDER BY brand) AS brands,
        ARRAY(SELECT DISTINCT line FROM daka_sku_master ORDER BY line) AS lines
    `;
    return NextResponse.json({
      items: rows.map((row) => ({
        sku: row.sku, description: row.description, brand: row.brand, line: row.line, family: row.family,
        subfamily: row.subfamily, active: row.active, price: row.price_usd == null ? null : asNumber(row.price_usd),
        priceDate: row.price_date, webProductId: row.web_product_id == null ? null : asNumber(row.web_product_id),
        webUrl: row.web_url, matches: bySku.get(row.sku) ?? {}
      })),
      total: rows.length ? asNumber(rows[0].total_count) : 0, offset, limit, sort,
      filters: filterValues ?? { brands: [], lines: [] }, sources: SOURCES
    });
  } catch (error) {
    console.error("Daka universe homologations query failed", error);
    return NextResponse.json({ error: "No fue posible consultar la homologación competitiva. Ejecuta el workflow de preparación actualizado." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await actor(request);
  if (!user) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  try {
    const body = await request.json();
    const sku = String(body.sku ?? "").trim().toUpperCase();
    const source = String(body.source ?? "").trim();
    const action = String(body.action ?? "");
    const productId = Number(body.productId);
    const reason = String(body.reason ?? "").trim().slice(0, 250);
    const notes = String(body.notes ?? "").trim().slice(0, 500) || null;
    if (!sku || !isSource(source) || !["confirm", "no_applicable", "clear"].includes(action)) {
      return NextResponse.json({ error: "Solicitud de homologación inválida" }, { status: 400 });
    }
    if (action === "confirm" && (!Number.isInteger(productId) || productId <= 0)) {
      return NextResponse.json({ error: "Selecciona un producto competidor" }, { status: 400 });
    }
    if (action === "no_applicable" && !reason) {
      return NextResponse.json({ error: "Indica el motivo por el cual este competidor no aplica" }, { status: 400 });
    }
    const sql = getSql();
    const result = await sql.begin(async (tx) => {
      const [master] = await tx`SELECT sku FROM daka_sku_master WHERE sku = ${sku} FOR UPDATE`;
      const [sourceRow] = await tx`SELECT id FROM sources WHERE slug = ${source}`;
      if (!master || !sourceRow) return { error: "SKU o competidor no encontrado", status: 404 };
      const [previous] = await tx`SELECT * FROM daka_universe_matches WHERE sku = ${sku} AND source_id = ${sourceRow.id} FOR UPDATE`;
      if (action === "clear") {
        if (!previous) return { ok: true, unchanged: true };
        await tx`DELETE FROM daka_universe_matches WHERE id = ${previous.id}`;
        await tx`
          INSERT INTO daka_universe_match_audit
            (universe_match_id, sku, source_id, action, previous_value, new_value, notes, actor_user_id, actor_email)
          VALUES (NULL, ${sku}, ${sourceRow.id}, 'cleared', ${tx.json(previous)}::jsonb, '{}'::jsonb,
            ${notes}, ${user.id}::uuid, ${user.email})
        `;
        return { ok: true, action: "cleared" };
      }
      let candidate: any = null;
      if (action === "confirm") {
        [candidate] = await tx`
          SELECT p.id, p.name, p.external_id FROM products p
          WHERE p.id = ${productId} AND p.source_id = ${sourceRow.id} AND p.active = TRUE FOR UPDATE
        `;
        if (!candidate) return { error: "El producto seleccionado no pertenece al competidor", status: 400 };
        const conflicts = await tx`
          SELECT 'universe' AS origin, um.sku FROM daka_universe_matches um
          WHERE um.competitor_product_id = ${productId} AND um.status = 'confirmed' AND um.sku <> ${sku}
          UNION ALL
          SELECT 'web' AS origin, dp.external_id AS sku FROM product_matches pm
          JOIN products dp ON dp.id = pm.daka_product_id
          WHERE pm.competitor_product_id = ${productId} AND pm.status IN ('auto', 'confirmed') AND dp.external_id <> ${sku}
        `;
        if (conflicts.length) return { error: `El producto competidor ya está homologado con el SKU ${conflicts[0].sku}`, status: 409 };
      }
      const next = action === "confirm"
        ? { status: "confirmed", productId, reason: null, notes }
        : { status: "no_applicable", productId: null, reason, notes };
      const [saved] = await tx`
        INSERT INTO daka_universe_matches
          (sku, source_id, competitor_product_id, status, reason, notes, actor_user_id, actor_email)
        VALUES (${sku}, ${sourceRow.id}, ${next.productId}, ${next.status}, ${next.reason}, ${next.notes}, ${user.id}::uuid, ${user.email})
        ON CONFLICT (sku, source_id) DO UPDATE SET competitor_product_id = EXCLUDED.competitor_product_id,
          status = EXCLUDED.status, reason = EXCLUDED.reason, notes = EXCLUDED.notes,
          actor_user_id = EXCLUDED.actor_user_id, actor_email = EXCLUDED.actor_email, updated_at = NOW()
        RETURNING id
      `;
      const auditAction = action === "no_applicable" ? "no_applicable" : previous ? "replaced" : "confirmed";
      const newValue = { ...next, product: candidate ? { id: asNumber(candidate.id), name: candidate.name, externalId: candidate.external_id } : null };
      await tx`
        INSERT INTO daka_universe_match_audit
          (universe_match_id, sku, source_id, action, previous_value, new_value, reason, notes, actor_user_id, actor_email)
        VALUES (${saved.id}, ${sku}, ${sourceRow.id}, ${auditAction}, ${tx.json(previous ?? {})}::jsonb,
          ${tx.json(newValue)}::jsonb, ${reason || null}, ${notes}, ${user.id}::uuid, ${user.email})
      `;
      return { ok: true, action: auditAction, matchId: asNumber(saved.id) };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Daka universe homologation mutation failed", error);
    return NextResponse.json({ error: "No fue posible guardar la homologación" }, { status: 500 });
  }
}
