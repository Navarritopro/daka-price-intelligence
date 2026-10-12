import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ sku: string }> }) {
  try {
    const { sku } = await context.params;
    const sql = getSql();
    const [product] = await sql`
      SELECT sku, line, family, subfamily,
        CASE WHEN brand = '- Ningun Fabricante -' THEN 'Sin marca definida' ELSE brand END AS brand,
        description, master_present, active
      FROM daka_sku_master WHERE sku = ${decodeURIComponent(sku)} LIMIT 1
    `;
    if (!product) return NextResponse.json({ error: "SKU no encontrado" }, { status: 404 });
    const cards = await sql`
      SELECT period_month, card_raw, company_abc, line_abc, family_abc, gmroi,
        xyz, rotation, coverage, affectation, gmroi_warning
      FROM daka_sku_card_history WHERE sku = ${product.sku} ORDER BY period_month DESC
    `;
    const [snapshot] = await sql`SELECT id, effective_date FROM daka_inventory_snapshots ORDER BY effective_date DESC, created_at DESC LIMIT 1`;
    const locations = snapshot ? await sql`
      SELECT l.name, l.location_type, i.quantity_raw, i.quantity_available
      FROM daka_inventory_by_location i JOIN daka_locations l ON l.id = i.location_id
      WHERE i.snapshot_id = ${snapshot.id}::uuid AND i.sku = ${product.sku}
      ORDER BY l.location_type, l.name
    ` : [];
    return NextResponse.json({
      product: {
        sku: product.sku, line: product.line, family: product.family, subfamily: product.subfamily,
        brand: product.brand, description: product.description, masterPresent: product.master_present, active: product.active
      },
      cards: cards.map((card) => ({
        periodMonth: card.period_month, raw: card.card_raw, companyAbc: card.company_abc,
        lineAbc: card.line_abc, familyAbc: card.family_abc, gmroi: asNumber(card.gmroi), xyz: card.xyz,
        rotation: card.rotation, coverage: card.coverage, affectation: card.affectation, warning: card.gmroi_warning
      })),
      inventory: {
        effectiveDate: snapshot?.effective_date ?? null,
        locations: locations.map((location) => ({
          name: location.name, type: location.location_type,
          quantityRaw: asNumber(location.quantity_raw), quantityAvailable: asNumber(location.quantity_available)
        }))
      }
    });
  } catch (error) {
    console.error("Daka universe detail failed", error);
    return NextResponse.json({ error: "No fue posible consultar el detalle del SKU" }, { status: 500 });
  }
}
