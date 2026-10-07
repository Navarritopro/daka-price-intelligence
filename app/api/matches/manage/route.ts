import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth";
import { asNumber, getSql } from "@/lib/db";
import { parseMatchManagementCommand } from "@/lib/match-management";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_SOURCES = new Set(["damasco", "multimax", "ivoo", "venelectronics", "soytechno"]);

async function adminActor(request: NextRequest) {
  const user = await getRequestUser(request);
  if (user?.role === "admin") return { userId: user.id, email: user.email };
  const configuredKey = process.env.ADMIN_API_KEY;
  if (configuredKey && request.headers.get("x-admin-key") === configuredKey) {
    return { userId: null, email: "ADMIN_API_KEY" };
  }
  return null;
}

function product(row: any, prefix: "daka" | "competitor") {
  return {
    id: asNumber(row[`${prefix}_id`]),
    externalId: row[`${prefix}_external_id`],
    name: row[`${prefix}_name`],
    brand: row[`${prefix}_brand`] ?? null,
    model: row[`${prefix}_model`] ?? null,
    category: row[`${prefix}_category`] ?? null,
    url: row[`${prefix}_url`],
    price: row[`${prefix}_price`] == null ? null : asNumber(row[`${prefix}_price`]),
    inStock: row[`${prefix}_in_stock`] ?? null
  };
}

export async function GET(request: NextRequest) {
  if (!await adminActor(request)) {
    return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  }
  try {
    const sql = getSql();
    const requestedSource = request.nextUrl.searchParams.get("source")?.trim() ?? "damasco";
    const source = VALID_SOURCES.has(requestedSource) ? requestedSource : "damasco";
    const mode = request.nextUrl.searchParams.get("mode") === "candidates" ? "candidates" : "list";
    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const searchLike = `%${search}%`;
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit")) || 20, 1), 50);

    if (mode === "candidates") {
      const matchId = Number(request.nextUrl.searchParams.get("matchId"));
      if (!Number.isInteger(matchId) || matchId <= 0) {
        return NextResponse.json({ error: "Homologación inválida" }, { status: 400 });
      }
      const rows = await sql`
        WITH target AS (
          SELECT pm.competitor_product_id, c.source_id
          FROM product_matches pm
          JOIN products c ON c.id = pm.competitor_product_id
          WHERE pm.id = ${matchId} AND pm.status IN ('auto', 'confirmed')
        ), latest_job AS (
          SELECT j.id FROM scraping_jobs j
          JOIN sources s ON s.id = j.source_id
          WHERE s.slug = ${source} AND j.status = 'success'
          ORDER BY j.started_at DESC LIMIT 1
        )
        SELECT c.id AS competitor_id, c.external_id AS competitor_external_id,
          c.name AS competitor_name, c.brand AS competitor_brand, c.model AS competitor_model,
          c.category AS competitor_category, c.url AS competitor_url,
          cp.price_usd AS competitor_price, cp.in_stock AS competitor_in_stock
        FROM products c
        JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
        JOIN target ON target.source_id = c.source_id
        LEFT JOIN price_history cp ON cp.product_id = c.id AND cp.job_id = (SELECT id FROM latest_job)
        WHERE c.id <> target.competitor_product_id
          AND (${search} = '' OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike}
            OR COALESCE(c.brand, '') ILIKE ${searchLike} OR COALESCE(c.model, '') ILIKE ${searchLike})
          AND NOT EXISTS (
            SELECT 1 FROM product_matches occupied
            WHERE occupied.competitor_product_id = c.id AND occupied.status IN ('auto', 'confirmed')
          )
        ORDER BY CASE WHEN c.name ILIKE ${searchLike} THEN 0 ELSE 1 END, c.name
        LIMIT ${limit}
      `;
      return NextResponse.json({
        items: rows.map((row) => product(row, "competitor")),
        source
      });
    }

    const state = request.nextUrl.searchParams.get("state") === "inactive" ? "inactive" : "active";
    const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
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
      SELECT pm.id AS match_id, pm.status, pm.confidence, pm.match_method, pm.created_at, pm.updated_at,
        d.id AS daka_id, d.external_id AS daka_external_id, d.name AS daka_name,
        d.brand AS daka_brand, d.model AS daka_model, d.category AS daka_category, d.url AS daka_url,
        dp.price_usd AS daka_price, dp.in_stock AS daka_in_stock,
        c.id AS competitor_id, c.external_id AS competitor_external_id, c.name AS competitor_name,
        c.brand AS competitor_brand, c.model AS competitor_model, c.category AS competitor_category,
        c.url AS competitor_url, cp.price_usd AS competitor_price, cp.in_stock AS competitor_in_stock,
        audit.action AS last_action, audit.reason AS last_reason, audit.notes AS last_notes,
        audit.actor_email AS last_actor, audit.created_at AS last_action_at,
        COUNT(*) OVER() AS total_count
      FROM product_matches pm
      JOIN products d ON d.id = pm.daka_product_id
      JOIN products c ON c.id = pm.competitor_product_id
      JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
      LEFT JOIN price_history dp ON dp.product_id = d.id AND dp.job_id = (SELECT id FROM latest_daka_job)
      LEFT JOIN price_history cp ON cp.product_id = c.id AND cp.job_id = (SELECT id FROM latest_competitor_job)
      LEFT JOIN LATERAL (
        SELECT a.action, a.reason, a.notes, a.actor_email, a.created_at
        FROM product_match_audit a WHERE a.match_id = pm.id OR a.replacement_match_id = pm.id
        ORDER BY a.created_at DESC LIMIT 1
      ) audit ON TRUE
      WHERE (
          (${state} = 'active' AND pm.status IN ('auto', 'confirmed'))
          OR (${state} = 'inactive' AND pm.status = 'rejected' AND audit.action IS NOT NULL)
        )
        AND (${search} = '' OR d.name ILIKE ${searchLike} OR d.external_id ILIKE ${searchLike}
          OR c.name ILIKE ${searchLike} OR c.external_id ILIKE ${searchLike})
        AND (${brand} = '' OR LOWER(TRIM(COALESCE(d.brand, ''))) = LOWER(TRIM(${brand}))
          OR LOWER(TRIM(COALESCE(c.brand, ''))) = LOWER(TRIM(${brand})))
      ORDER BY pm.updated_at DESC, pm.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    const brandRows = await sql`
      SELECT MIN(brand) AS brand FROM (
        SELECT TRIM(d.brand) AS brand
        FROM product_matches pm JOIN products d ON d.id = pm.daka_product_id
        JOIN products c ON c.id = pm.competitor_product_id JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
        WHERE pm.status IN ('auto', 'confirmed') AND d.brand IS NOT NULL AND TRIM(d.brand) <> ''
        UNION ALL
        SELECT TRIM(c.brand) AS brand
        FROM product_matches pm JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources s ON s.id = c.source_id AND s.slug = ${source}
        WHERE pm.status IN ('auto', 'confirmed') AND c.brand IS NOT NULL AND TRIM(c.brand) <> ''
      ) brands GROUP BY LOWER(brand) ORDER BY brand
    `;
    const total = rows.length ? asNumber(rows[0].total_count) : 0;
    return NextResponse.json({
      source,
      state,
      items: rows.map((row) => ({
        matchId: asNumber(row.match_id), status: row.status,
        confidence: asNumber(row.confidence), matchMethod: row.match_method,
        createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
        daka: product(row, "daka"), competitor: product(row, "competitor"),
        audit: row.last_action ? {
          action: row.last_action, reason: row.last_reason, notes: row.last_notes,
          actor: row.last_actor, createdAt: new Date(row.last_action_at).toISOString()
        } : null
      })),
      total, offset, limit, hasMore: offset + rows.length < total,
      brands: brandRows.map((row) => row.brand)
    });
  } catch (error) {
    console.error("Match management query failed", error);
    return NextResponse.json({ error: "No fue posible cargar la gestión de homologaciones" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const actor = await adminActor(request);
  if (!actor) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  const command = parseMatchManagementCommand(await request.json().catch(() => null));
  if (!command) return NextResponse.json({ error: "Solicitud de corrección inválida" }, { status: 400 });
  try {
    const sql = getSql();
    const result = await sql.begin(async (tx) => {
      const [target] = await tx`
        SELECT pm.*, d.name AS daka_name, d.external_id AS daka_external_id,
          c.name AS competitor_name, c.external_id AS competitor_external_id, c.source_id,
          s.slug AS source
        FROM product_matches pm
        JOIN products d ON d.id = pm.daka_product_id
        JOIN products c ON c.id = pm.competitor_product_id
        JOIN sources s ON s.id = c.source_id
        WHERE pm.id = ${command.matchId}
        FOR UPDATE OF pm
      `;
      if (!target) return { error: "La homologación no existe", status: 404 };
      if (new Date(target.updated_at).getTime() !== new Date(command.expectedUpdatedAt).getTime()) {
        return { error: "La homologación fue modificada por otro usuario. Actualiza la lista antes de continuar.", status: 409 };
      }
      const snapshot = {
        daka: { id: asNumber(target.daka_product_id), externalId: target.daka_external_id, name: target.daka_name },
        competitor: { id: asNumber(target.competitor_product_id), externalId: target.competitor_external_id, name: target.competitor_name, source: target.source },
        status: target.status, confidence: asNumber(target.confidence), matchMethod: target.match_method
      };

      if (command.action === "deactivate") {
        if (!["auto", "confirmed"].includes(target.status)) return { error: "La homologación ya no está activa", status: 409 };
        const [updated] = await tx`UPDATE product_matches SET status = 'rejected', updated_at = NOW() WHERE id = ${command.matchId} RETURNING id, updated_at`;
        await tx`
          INSERT INTO product_match_audit (match_id, daka_product_id, competitor_product_id, action,
            previous_status, new_status, reason, notes, actor_user_id, actor_email, snapshot)
          VALUES (${command.matchId}, ${target.daka_product_id}, ${target.competitor_product_id}, 'deactivated',
            ${target.status}, 'rejected', ${command.reason}, ${command.notes}, ${actor.userId}::uuid,
            ${actor.email}, ${tx.json(snapshot)}::jsonb)
        `;
        return { ok: true, action: "deactivated", matchId: asNumber(updated.id), updatedAt: new Date(updated.updated_at).toISOString() };
      }

      if (command.action === "restore") {
        if (target.status !== "rejected") return { error: "Solo se pueden restaurar homologaciones desactivadas", status: 409 };
        const conflicts = await tx`
          SELECT other.id FROM product_matches other
          JOIN products other_competitor ON other_competitor.id = other.competitor_product_id
          WHERE other.id <> ${command.matchId} AND other.status IN ('auto', 'confirmed')
            AND (other.competitor_product_id = ${target.competitor_product_id}
              OR (other.daka_product_id = ${target.daka_product_id} AND other_competitor.source_id = ${target.source_id}))
          FOR UPDATE OF other
        `;
        if (conflicts.length) return { error: "No se puede restaurar porque actualmente existe otra homologación activa en conflicto", status: 409 };
        const [updated] = await tx`UPDATE product_matches SET status = 'confirmed', updated_at = NOW() WHERE id = ${command.matchId} RETURNING id, updated_at`;
        await tx`
          INSERT INTO product_match_audit (match_id, daka_product_id, competitor_product_id, action,
            previous_status, new_status, reason, notes, actor_user_id, actor_email, snapshot)
          VALUES (${command.matchId}, ${target.daka_product_id}, ${target.competitor_product_id}, 'restored',
            ${target.status}, 'confirmed', ${command.reason}, ${command.notes}, ${actor.userId}::uuid,
            ${actor.email}, ${tx.json(snapshot)}::jsonb)
        `;
        return { ok: true, action: "restored", matchId: asNumber(updated.id), updatedAt: new Date(updated.updated_at).toISOString() };
      }

      if (!["auto", "confirmed"].includes(target.status)) return { error: "La homologación actual ya no está activa", status: 409 };
      const replacementProductId = command.replacementProductId as number;
      if (replacementProductId === asNumber(target.competitor_product_id)) return { error: "Seleccionaste el mismo producto competidor", status: 400 };
      const [candidate] = await tx`
        SELECT p.id, p.external_id, p.name, p.source_id
        FROM products p WHERE p.id = ${replacementProductId} AND p.source_id = ${target.source_id}
        FOR UPDATE OF p
      `;
      if (!candidate) return { error: "El producto sustituto no pertenece al mismo competidor", status: 400 };
      const activeConflicts = await tx`
        SELECT other.id FROM product_matches other
        JOIN products other_competitor ON other_competitor.id = other.competitor_product_id
        WHERE other.id <> ${command.matchId} AND other.status IN ('auto', 'confirmed')
          AND (other.competitor_product_id = ${replacementProductId}
            OR (other.daka_product_id = ${target.daka_product_id} AND other_competitor.source_id = ${target.source_id}))
        FOR UPDATE OF other
      `;
      if (activeConflicts.length) return { error: "El producto sustituto ya participa en otra homologación activa", status: 409 };
      const [existing] = await tx`
        SELECT id FROM product_matches
        WHERE daka_product_id = ${target.daka_product_id} AND competitor_product_id = ${replacementProductId}
        FOR UPDATE
      `;
      await tx`UPDATE product_matches SET status = 'rejected', updated_at = NOW() WHERE id = ${command.matchId}`;
      const correctionEvidence = { manualCorrection: true, correctedFromMatchId: command.matchId, reason: command.reason };
      const [replacement] = existing
        ? await tx`
            UPDATE product_matches SET status = 'confirmed', match_method = 'manual_correction', confidence = 1,
              evidence = COALESCE(evidence, '{}'::jsonb) || ${tx.json(correctionEvidence)}::jsonb, updated_at = NOW()
            WHERE id = ${existing.id} RETURNING id, updated_at
          `
        : await tx`
            INSERT INTO product_matches (daka_product_id, competitor_product_id, status, match_method, confidence, evidence)
            VALUES (${target.daka_product_id}, ${replacementProductId}, 'confirmed', 'manual_correction', 1,
              ${tx.json(correctionEvidence)}::jsonb)
            RETURNING id, updated_at
          `;
      const replacementSnapshot = {
        ...snapshot,
        replacement: { id: asNumber(candidate.id), externalId: candidate.external_id, name: candidate.name }
      };
      await tx`
        INSERT INTO product_match_audit (match_id, daka_product_id, competitor_product_id, action,
          previous_status, new_status, replacement_match_id, reason, notes, actor_user_id, actor_email, snapshot)
        VALUES (${command.matchId}, ${target.daka_product_id}, ${target.competitor_product_id}, 'replaced',
          ${target.status}, 'rejected', ${replacement.id}, ${command.reason}, ${command.notes},
          ${actor.userId}::uuid, ${actor.email}, ${tx.json(replacementSnapshot)}::jsonb)
      `;
      return { ok: true, action: "replaced", matchId: command.matchId, replacementMatchId: asNumber(replacement.id), updatedAt: new Date(replacement.updated_at).toISOString() };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error("Match management mutation failed", error);
    return NextResponse.json({ error: "No fue posible guardar la corrección de homologación" }, { status: 500 });
  }
}
