import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = params.get("search")?.trim() ?? "";
    const line = params.get("line")?.trim() ?? "";
    const family = params.get("family")?.trim() ?? "";
    const subfamily = params.get("subfamily")?.trim() ?? "";
    const brand = params.get("brand")?.trim() ?? "";
    const status = ["all", "active", "inactive", "pending_card"].includes(params.get("status") ?? "") ? params.get("status")! : "all";
    const inventory = ["all", "available", "zero", "negative", "absent"].includes(params.get("inventory") ?? "") ? params.get("inventory")! : "all";
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(params.get("offset")) || 0, 0);
    const searchLike = `%${search}%`;
    const lineLike = `%${line}%`;
    const familyLike = `%${family}%`;
    const subfamilyLike = `%${subfamily}%`;
    const brandLike = `%${brand}%`;
    const sql = getSql();
    const rows = await sql`
      WITH latest_snapshot AS (
        SELECT id, effective_date FROM daka_inventory_snapshots ORDER BY effective_date DESC, created_at DESC LIMIT 1
      ), inventory_totals AS (
        SELECT i.sku, SUM(i.quantity_raw)::numeric AS total_raw,
          SUM(i.quantity_raw) FILTER (WHERE l.location_type = 'cdd')::numeric AS cdd_raw,
          SUM(i.quantity_raw) FILTER (WHERE l.location_type = 'store')::numeric AS stores_raw
        FROM daka_inventory_by_location i
        JOIN latest_snapshot s ON s.id = i.snapshot_id
        JOIN daka_locations l ON l.id = i.location_id
        GROUP BY i.sku
      ), universe AS (
        SELECT m.sku, m.line, m.family, m.subfamily,
          CASE WHEN m.brand = '- Ningun Fabricante -' THEN 'Sin marca definida' ELSE m.brand END AS brand,
          m.description, m.master_present, m.active,
          c.period_month, c.card_raw, c.company_abc, c.line_abc, c.family_abc, c.gmroi,
          c.xyz, c.rotation, c.coverage, c.affectation, c.gmroi_warning,
          it.total_raw, it.cdd_raw, it.stores_raw, (it.sku IS NOT NULL) AS has_inventory,
          ls.effective_date,
          p.id AS web_product_id, p.url AS web_url
        FROM daka_sku_master m
        LEFT JOIN LATERAL (
          SELECT * FROM daka_sku_card_history c0 WHERE c0.sku = m.sku ORDER BY c0.period_month DESC LIMIT 1
        ) c ON TRUE
        LEFT JOIN inventory_totals it ON it.sku = m.sku
        LEFT JOIN latest_snapshot ls ON TRUE
        LEFT JOIN sources src ON src.slug = 'daka'
        LEFT JOIN products p ON p.source_id = src.id AND p.external_id = m.sku
      ), filtered AS (
        SELECT * FROM universe
        WHERE (${search} = '' OR sku ILIKE ${searchLike} OR description ILIKE ${searchLike})
          AND (${line} = '' OR line ILIKE ${lineLike})
          AND (${family} = '' OR family ILIKE ${familyLike})
          AND (${subfamily} = '' OR subfamily ILIKE ${subfamilyLike})
          AND (${brand} = '' OR brand ILIKE ${brandLike})
          AND (${status} = 'all'
            OR (${status} = 'active' AND active = TRUE AND master_present = TRUE)
            OR (${status} = 'inactive' AND active = FALSE)
            OR (${status} = 'pending_card' AND master_present = FALSE))
          AND (${inventory} = 'all'
            OR (${inventory} = 'absent' AND has_inventory = FALSE)
            OR (${inventory} = 'negative' AND has_inventory = TRUE AND total_raw < 0)
            OR (${inventory} = 'zero' AND has_inventory = TRUE AND total_raw = 0)
            OR (${inventory} = 'available' AND has_inventory = TRUE AND total_raw > 0))
      )
      SELECT *, COUNT(*) OVER()::int AS total
      FROM filtered
      ORDER BY description, sku
      LIMIT ${limit} OFFSET ${offset}
    `;
    const [stats] = await sql`
      WITH latest AS (SELECT id FROM daka_inventory_snapshots ORDER BY effective_date DESC, created_at DESC LIMIT 1),
      totals AS (SELECT sku, SUM(quantity_raw)::numeric total FROM daka_inventory_by_location WHERE snapshot_id = (SELECT id FROM latest) GROUP BY sku)
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE m.master_present)::int AS master_count,
        COUNT(*) FILTER (WHERE NOT m.master_present)::int AS pending_card,
        COUNT(*) FILTER (WHERE NOT m.active)::int AS inactive,
        COUNT(*) FILTER (WHERE t.total > 0)::int AS available,
        COUNT(*) FILTER (WHERE t.sku IS NULL)::int AS absent_inventory,
        COALESCE(SUM(GREATEST(t.total, 0)), 0)::numeric AS available_units
      FROM daka_sku_master m LEFT JOIN totals t ON t.sku = m.sku
    `;
    const filters = await sql`
      SELECT
        ARRAY(SELECT DISTINCT line FROM daka_sku_master ORDER BY line) AS lines,
        ARRAY(SELECT DISTINCT family FROM daka_sku_master ORDER BY family) AS families,
        ARRAY(SELECT DISTINCT subfamily FROM daka_sku_master WHERE subfamily IS NOT NULL ORDER BY subfamily) AS subfamilies,
        ARRAY(SELECT DISTINCT CASE WHEN brand = '- Ningun Fabricante -' THEN 'Sin marca definida' ELSE brand END FROM daka_sku_master ORDER BY 1) AS brands
    `;
    return NextResponse.json({
      items: rows.map((row) => ({
        sku: row.sku, line: row.line, family: row.family, subfamily: row.subfamily, brand: row.brand,
        description: row.description, masterPresent: row.master_present, active: row.active,
        card: row.card_raw ? {
          periodMonth: row.period_month, raw: row.card_raw, companyAbc: row.company_abc,
          lineAbc: row.line_abc, familyAbc: row.family_abc, gmroi: asNumber(row.gmroi), xyz: row.xyz,
          rotation: row.rotation, coverage: row.coverage, affectation: row.affectation, warning: row.gmroi_warning
        } : null,
        inventory: {
          effectiveDate: row.effective_date, hasRecord: row.has_inventory,
          totalRaw: row.total_raw == null ? null : asNumber(row.total_raw),
          totalAvailable: row.total_raw == null ? null : Math.max(asNumber(row.total_raw), 0),
          cddRaw: row.cdd_raw == null ? null : asNumber(row.cdd_raw), storesRaw: row.stores_raw == null ? null : asNumber(row.stores_raw)
        },
        webProductId: row.web_product_id == null ? null : Number(row.web_product_id), webUrl: row.web_url
      })),
      total: rows.length ? Number(rows[0].total) : 0, offset, limit,
      hasMore: offset + rows.length < (rows.length ? Number(rows[0].total) : 0),
      stats: {
        total: Number(stats?.total ?? 0), masterCount: Number(stats?.master_count ?? 0), pendingCard: Number(stats?.pending_card ?? 0),
        inactive: Number(stats?.inactive ?? 0), available: Number(stats?.available ?? 0), absentInventory: Number(stats?.absent_inventory ?? 0),
        availableUnits: asNumber(stats?.available_units)
      },
      filters: filters[0] ?? { lines: [], families: [], subfamilies: [], brands: [] }
    });
  } catch (error) {
    console.error("Daka universe query failed", error);
    return NextResponse.json({ error: "El módulo aún no está preparado. Ejecuta primero el workflow Preparar Universo de Productos Daka." }, { status: 500 });
  }
}
