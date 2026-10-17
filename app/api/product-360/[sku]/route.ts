import { NextRequest, NextResponse } from "next/server";
import { asNumber, getSql } from "@/lib/db";
import { classifyOpportunity, isFreshCapture } from "@/lib/opportunity-rules";

export const dynamic = "force-dynamic";

const competitors = [
  { source: "damasco", name: "Damasco" },
  { source: "multimax", name: "Multimax" },
  { source: "ivoo", name: "IVOO" },
  { source: "venelectronics", name: "Venelectronics" },
  { source: "soytechno", name: "SoyTechno" }
] as const;

function nullableNumber(value: unknown) {
  return value == null ? null : asNumber(value);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ sku: string }> }) {
  try {
    const { sku: rawSku } = await context.params;
    const sku = decodeURIComponent(rawSku).trim();
    if (!sku || sku.length > 120) return NextResponse.json({ error: "SKU inválido" }, { status: 400 });
    const sql = getSql();

    const [productRows, historyRows, comparisonRows] = await Promise.all([
      sql`
        WITH latest_inventory AS (
          SELECT id, effective_date FROM daka_inventory_snapshots
          ORDER BY effective_date DESC, created_at DESC LIMIT 1
        ), inventory AS (
          SELECT i.sku, SUM(i.quantity_raw)::numeric AS total_raw,
            SUM(i.quantity_available)::numeric AS total_available,
            SUM(i.quantity_available) FILTER (WHERE l.location_type = 'cdd')::numeric AS cdd_available,
            SUM(i.quantity_available) FILTER (WHERE l.location_type = 'store')::numeric AS stores_available
          FROM daka_inventory_by_location i
          JOIN daka_locations l ON l.id = i.location_id
          WHERE i.snapshot_id = (SELECT id FROM latest_inventory) AND i.sku = ${sku}
          GROUP BY i.sku
        ), latest_list AS (
          SELECT pi.price_usd, pi.review_warning, ps.effective_date
          FROM daka_price_items pi JOIN daka_price_snapshots ps ON ps.id = pi.snapshot_id
          WHERE pi.sku = ${sku} AND ps.is_active = TRUE
          ORDER BY ps.effective_date DESC, ps.created_at DESC LIMIT 1
        ), daka_jobs AS (
          SELECT j.id, COALESCE(j.finished_at, j.started_at) AS captured_at,
            ROW_NUMBER() OVER (ORDER BY j.started_at DESC) AS position
          FROM scraping_jobs j JOIN sources s ON s.id = j.source_id
          WHERE s.slug = 'daka' AND j.status = 'success'
        ), web_product AS (
          SELECT p.id, p.url, p.active FROM products p JOIN sources s ON s.id = p.source_id
          WHERE s.slug = 'daka' AND p.external_id = ${sku} LIMIT 1
        )
        SELECT m.sku, m.description, m.line, m.family, m.subfamily,
          CASE WHEN m.brand = '- Ningun Fabricante -' THEN 'Sin marca definida' ELSE m.brand END AS brand,
          m.active, m.master_present,
          card.card_raw, card.period_month, card.gmroi, card.gmroi_warning,
          inv.total_raw, inv.total_available, inv.cdd_available, inv.stores_available,
          (inv.sku IS NOT NULL) AS has_inventory, li.effective_date AS inventory_effective_date,
          list.price_usd AS list_price, list.review_warning AS list_price_warning,
          list.effective_date AS list_effective_date,
          wp.id AS web_product_id, wp.url AS web_url, wp.active AS web_active,
          current_price.price_usd AS web_price, current_price.in_stock AS web_in_stock,
          current_price.available_quantity AS web_quantity, current_price.scraped_at AS web_scraped_at,
          previous_price.price_usd AS previous_web_price
        FROM daka_sku_master m
        LEFT JOIN LATERAL (
          SELECT card_raw, period_month, gmroi, gmroi_warning FROM daka_sku_card_history
          WHERE sku = m.sku ORDER BY period_month DESC LIMIT 1
        ) card ON TRUE
        LEFT JOIN inventory inv ON inv.sku = m.sku
        LEFT JOIN latest_inventory li ON TRUE
        LEFT JOIN latest_list list ON TRUE
        LEFT JOIN web_product wp ON TRUE
        LEFT JOIN price_history current_price ON current_price.product_id = wp.id
          AND current_price.job_id = (SELECT id FROM daka_jobs WHERE position = 1)
        LEFT JOIN price_history previous_price ON previous_price.product_id = wp.id
          AND previous_price.job_id = (SELECT id FROM daka_jobs WHERE position = 2)
        WHERE m.sku = ${sku}
        LIMIT 1
      `,
      sql`
        WITH web_product AS (
          SELECT p.id FROM products p JOIN sources s ON s.id = p.source_id
          WHERE s.slug = 'daka' AND p.external_id = ${sku} LIMIT 1
        ), ordered AS (
          SELECT ph.price_usd, ph.in_stock, ph.available_quantity, ph.scraped_at,
            LAG(ph.price_usd) OVER (ORDER BY ph.scraped_at) AS previous_price
          FROM price_history ph WHERE ph.product_id = (SELECT id FROM web_product)
        )
        SELECT *, MIN(price_usd) OVER() AS min_price, MAX(price_usd) OVER() AS max_price,
          COUNT(*) OVER()::int AS capture_count,
          COUNT(*) FILTER (WHERE previous_price IS DISTINCT FROM price_usd AND previous_price IS NOT NULL) OVER()::int AS change_count
        FROM ordered ORDER BY scraped_at DESC LIMIT 30
      `,
      sql`
        WITH daka_product AS (
          SELECT p.id FROM products p JOIN sources s ON s.id = p.source_id
          WHERE s.slug = 'daka' AND p.external_id = ${sku} LIMIT 1
        ), candidate_matches AS (
          SELECT cs.id AS source_id, pm.competitor_product_id, pm.status,
            pm.confidence, 'web'::text AS origin,
            CASE WHEN pm.status = 'confirmed' THEN 2 ELSE 3 END AS priority
          FROM product_matches pm
          JOIN products cp ON cp.id = pm.competitor_product_id
          JOIN sources cs ON cs.id = cp.source_id
          WHERE pm.daka_product_id = (SELECT id FROM daka_product)
            AND pm.status IN ('auto', 'confirmed')
          UNION ALL
          SELECT um.source_id, um.competitor_product_id, um.status,
            1::numeric AS confidence, 'universe'::text AS origin, 1 AS priority
          FROM daka_universe_matches um
          WHERE um.sku = ${sku} AND um.status = 'confirmed'
        ), selected_matches AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY priority, confidence DESC) AS position
          FROM candidate_matches
        ), ranked_jobs AS (
          SELECT j.id, j.source_id, COALESCE(j.finished_at, j.started_at) AS captured_at,
            ROW_NUMBER() OVER (PARTITION BY j.source_id ORDER BY j.started_at DESC) AS position
          FROM scraping_jobs j WHERE j.status = 'success'
        )
        SELECT cs.slug AS source, cs.name AS source_name, sm.status AS match_status,
          sm.confidence, sm.origin, cp.id AS product_id, cp.external_id, cp.name,
          cp.brand, cp.url, current_price.price_usd, current_price.list_price_usd,
          current_price.in_stock, current_price.available_quantity, current_price.scraped_at,
          previous_price.price_usd AS previous_price, latest_job.captured_at AS job_captured_at
        FROM sources cs
        LEFT JOIN selected_matches sm ON sm.source_id = cs.id AND sm.position = 1
        LEFT JOIN products cp ON cp.id = sm.competitor_product_id
        LEFT JOIN ranked_jobs latest_job ON latest_job.source_id = cs.id AND latest_job.position = 1
        LEFT JOIN ranked_jobs previous_job ON previous_job.source_id = cs.id AND previous_job.position = 2
        LEFT JOIN price_history current_price ON current_price.product_id = cp.id AND current_price.job_id = latest_job.id
        LEFT JOIN price_history previous_price ON previous_price.product_id = cp.id AND previous_price.job_id = previous_job.id
        WHERE cs.active = TRUE AND cs.slug IN ('damasco', 'multimax', 'ivoo', 'venelectronics', 'soytechno')
      `
    ]);

    const product = productRows[0];
    if (!product) return NextResponse.json({ error: "SKU no encontrado en el maestro DAKA" }, { status: 404 });
    const dakaPrice = nullableNumber(product.web_price) ?? nullableNumber(product.list_price);
    const dakaAvailability = product.web_product_id != null
      ? product.web_in_stock ?? null
      : product.has_inventory ? asNumber(product.total_available) > 0 : null;
    const dakaReferenceAt = product.web_scraped_at ?? product.list_effective_date ?? null;
    const rowsBySource = new Map(comparisonRows.map((row) => [String(row.source), row]));
    const comparisons = competitors.map(({ source, name }) => {
      const row = rowsBySource.get(source);
      if (!row?.product_id) return { source, sourceName: name, matched: false, match: null, product: null, differenceUsd: null, differencePct: null, signal: null };
      const competitorPrice = nullableNumber(row.price_usd);
      const differenceUsd = dakaPrice == null || competitorPrice == null ? null : dakaPrice - competitorPrice;
      const differencePct = differenceUsd == null || !competitorPrice ? null : (differenceUsd / competitorPrice) * 100;
      const fresh = Boolean(dakaReferenceAt) && isFreshCapture(String(dakaReferenceAt))
        && Boolean(row.job_captured_at) && isFreshCapture(String(row.job_captured_at));
      const signal = classifyOpportunity({
        dakaPrice,
        competitorPrice,
        competitorPreviousPrice: nullableNumber(row.previous_price),
        dakaInStock: dakaAvailability,
        competitorInStock: row.in_stock ?? null,
        fresh,
        sourceName: String(row.source_name ?? name),
        minimumGap: 5
      });
      return {
        source, sourceName: String(row.source_name ?? name), matched: true,
        match: { status: row.match_status, confidence: asNumber(row.confidence), origin: row.origin },
        product: {
          id: asNumber(row.product_id), externalId: row.external_id, name: row.name,
          brand: row.brand, url: row.url, price: competitorPrice,
          previousPrice: nullableNumber(row.previous_price), listPrice: nullableNumber(row.list_price_usd),
          inStock: row.in_stock ?? null, availableQuantity: nullableNumber(row.available_quantity),
          scrapedAt: row.scraped_at ?? null
        },
        differenceUsd, differencePct, signal
      };
    });
    const history = historyRows.map((row) => ({
      price: nullableNumber(row.price_usd), previousPrice: nullableNumber(row.previous_price),
      inStock: row.in_stock ?? null, availableQuantity: nullableNumber(row.available_quantity), scrapedAt: row.scraped_at
    }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      product: {
        sku: product.sku, description: product.description, brand: product.brand,
        line: product.line, family: product.family, subfamily: product.subfamily,
        active: product.active, masterPresent: product.master_present,
        card: product.card_raw ? { raw: product.card_raw, periodMonth: product.period_month, gmroi: asNumber(product.gmroi), warning: product.gmroi_warning } : null
      },
      daka: {
        price: dakaPrice, priceSource: product.web_price != null ? "web" : product.list_price != null ? "list" : null,
        previousWebPrice: nullableNumber(product.previous_web_price),
        listPrice: nullableNumber(product.list_price), listEffectiveDate: product.list_effective_date ?? null,
        listPriceWarning: Boolean(product.list_price_warning), webProductId: nullableNumber(product.web_product_id),
        webUrl: product.web_url ?? null, webActive: product.web_active ?? null,
        webInStock: product.web_in_stock ?? null, webQuantity: nullableNumber(product.web_quantity),
        webScrapedAt: product.web_scraped_at ?? null,
        inventory: {
          hasRecord: Boolean(product.has_inventory), effectiveDate: product.inventory_effective_date ?? null,
          totalRaw: nullableNumber(product.total_raw), totalAvailable: nullableNumber(product.total_available),
          cddAvailable: nullableNumber(product.cdd_available), storesAvailable: nullableNumber(product.stores_available)
        }
      },
      history: {
        items: history,
        captureCount: historyRows.length ? asNumber(historyRows[0].capture_count) : 0,
        changeCount: historyRows.length ? asNumber(historyRows[0].change_count) : 0,
        minPrice: historyRows.length ? nullableNumber(historyRows[0].min_price) : null,
        maxPrice: historyRows.length ? nullableNumber(historyRows[0].max_price) : null
      },
      comparisons,
      summary: {
        matchedCompetitors: comparisons.filter((item) => item.matched).length,
        activeSignals: comparisons.filter((item) => item.signal != null).length,
        priceRisks: comparisons.filter((item) => item.signal?.type === "price_risk").length,
        priceAdvantages: comparisons.filter((item) => item.signal?.type === "price_advantage").length
      }
    });
  } catch (error) {
    console.error("product-360", error);
    return NextResponse.json({ error: "No fue posible construir la Ficha 360°" }, { status: 500 });
  }
}
