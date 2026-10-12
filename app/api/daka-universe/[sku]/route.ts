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
    const priceHistory = await sql`
      SELECT ps.effective_date, ps.version, ps.is_active, pi.price_usd, pi.review_warning,
        b.filename, b.imported_by_email, b.created_at
      FROM daka_price_items pi
      JOIN daka_price_snapshots ps ON ps.id = pi.snapshot_id
      JOIN daka_import_batches b ON b.id = ps.source_batch_id
      WHERE pi.sku = ${product.sku}
      ORDER BY ps.effective_date DESC, ps.version DESC
      LIMIT 60
    `;
    const [web] = await sql`
      WITH latest_job AS (
        SELECT j.id FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
        WHERE s.slug = 'daka' AND j.status = 'success' ORDER BY j.started_at DESC LIMIT 1
      )
      SELECT p.id, p.url, p.active, ph.price_usd, ph.in_stock, ph.scraped_at
      FROM products p JOIN sources s ON s.id = p.source_id AND s.slug = 'daka'
      LEFT JOIN price_history ph ON ph.product_id = p.id AND ph.job_id = (SELECT id FROM latest_job)
      WHERE p.external_id = ${product.sku} LIMIT 1
    `;
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
      },
      web: web ? {
        productId: asNumber(web.id), url: web.url, available: web.active !== false,
        price: web.price_usd == null ? null : asNumber(web.price_usd), inStock: web.in_stock ?? null,
        scrapedAt: web.scraped_at ?? null
      } : null,
      prices: priceHistory.map((price) => ({
        effectiveDate: price.effective_date, version: asNumber(price.version), active: price.is_active,
        amount: asNumber(price.price_usd), warning: price.review_warning,
        filename: price.filename, importedBy: price.imported_by_email, importedAt: price.created_at
      }))
    });
  } catch (error) {
    console.error("Daka universe detail failed", error);
    return NextResponse.json({ error: "No fue posible consultar el detalle del SKU" }, { status: 500 });
  }
}
