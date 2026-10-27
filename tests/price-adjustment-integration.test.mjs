import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { priceFixture } from "./helpers/price-adjustment-fixture.mjs";
import { buildOpportunityExcel, buildOpportunityPdf, buildOpportunityTelegramCaption } from "../lib/opportunity-reports.ts";

test("el ajuste coincide entre catálogo, comparador, oportunidades, Ficha 360°, resumen y reportes con PostgreSQL", async () => {
  const { db, load, request } = await priceFixture();
  try {
    const captured = (await db.query("SELECT * FROM price_history ORDER BY id")).rows;
    const settings = load("app/api/price-adjustment/route.ts");
    const response = await settings.PUT(request("/api/price-adjustment", { method: "PUT", body: JSON.stringify({ enabled: true, percentage: 10 }) }));
    assert.equal(response.status, 200);

    const products = await load("app/api/products/route.ts").GET(request("/api/products?source=venelectronics"));
    const catalog = await products.json();
    assert.equal(products.status, 200);
    assert.equal(catalog.items[0].currentPrice, 275);
    assert.equal(catalog.items[0].capturedPrice, 250);
    const comparison = await load("app/api/comparison/route.ts").GET(request("/api/comparison?source=venelectronics&position=daka_lower"));
    const pairs = await comparison.json();
    assert.equal(comparison.status, 200);
    assert.equal(pairs.items[0].competitor.price, 275);
    assert.equal(pairs.items[0].differenceUsd, -15);
    assert.equal(pairs.stats.dakaLower, 1);

    const opportunities = load("lib/opportunities-service.ts");
    const query = opportunities.parseOpportunityQuery(new URLSearchParams("source=venelectronics&minimumGap=1"));
    const page = await opportunities.getOpportunityPage(query, true);
    assert.equal(page.items[0].comparisons[0].competitor.price, 275);
    assert.equal(page.priceAdjustmentPercentage, 10);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildOpportunityExcel(page, query));
    assert.ok(JSON.stringify(book.getWorksheet("Resumen").getSheetValues()).includes("+10%"));
    assert.ok(JSON.stringify(book.getWorksheet("Oportunidades").getSheetValues()).includes("275"));
    assert.ok(buildOpportunityTelegramCaption(page, query).includes("+10%"));
    assert.equal((await buildOpportunityPdf(page, query)).subarray(0,4).toString(), "%PDF");

    const product360 = await load("app/api/product-360/[sku]/route.ts").GET(request("/api/product-360/DAKA-1"), { params: Promise.resolve({ sku: "DAKA-1" }) });
    assert.equal(product360.status, 200);
    const fullProduct = await product360.json();
    assert.ok(JSON.stringify(fullProduct).includes('"price":275'));
    const executive = await load("app/api/executive-summary/route.ts").GET(request("/api/executive-summary?section=position"));
    assert.equal(executive.status, 200);
    const summary = await executive.json();
    assert.ok(JSON.stringify(summary).includes("275"));
    assert.deepEqual((await db.query("SELECT * FROM price_history ORDER BY id")).rows, captured);
  } finally { await db.close(); }
});

test("exporta 1.970 oportunidades con precios ajustados y conserva paginación y cantidades originales", async () => {
  const { db, load, request } = await priceFixture();
  try {
    await db.exec(`
      INSERT INTO products(source_id,external_id,name,brand,category,url)
        SELECT s.id,s.slug||'-volume-'||g,'Producto '||g,'Marca','TV','https://example.com/'||s.slug||'/'||g
        FROM sources s CROSS JOIN generate_series(1,1969) g WHERE s.slug IN ('daka','venelectronics');
      INSERT INTO price_history(product_id,job_id,price_usd,list_price_usd,scraped_at,in_stock,available_quantity)
        SELECT p.id,j.id,CASE WHEN s.slug='daka' THEN 300 ELSE 250 END,350,j.started_at,TRUE,5
        FROM products p JOIN sources s ON s.id=p.source_id JOIN scraping_jobs j ON j.source_id=p.source_id
        WHERE p.external_id LIKE '%-volume-%';
      INSERT INTO product_matches(daka_product_id,competitor_product_id,status,match_method,confidence)
        SELECT d.id,c.id,'confirmed','manual',1 FROM products d JOIN products c
          ON c.external_id=REPLACE(d.external_id,'daka-volume-','venelectronics-volume-')
        WHERE d.external_id LIKE 'daka-volume-%';
      UPDATE price_display_adjustments SET enabled=TRUE, percentage=10 WHERE source_slug='venelectronics';
    `);
    const service = load("lib/opportunities-service.ts");
    const query = service.parseOpportunityQuery(new URLSearchParams("source=venelectronics&minimumGap=1"));
    const all = await service.getOpportunityPage(query, true);
    assert.equal(all.total, 1970);
    assert.equal(all.items.length, 1970);
    assert.equal(all.priceAdjustmentPercentage, 10);
    assert.ok(all.items.every(item => item.comparisons[0].competitor.price === 275));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildOpportunityExcel(all, query));
    const sheet = book.getWorksheet("Oportunidades");
    assert.equal(sheet.rowCount, 1972);
    const comparisonRoute = load("app/api/comparison/route.ts");
    const seen = new Set();
    for (const offset of [0,50]) {
      const response = await comparisonRoute.GET(request(`/api/comparison?source=venelectronics&offset=${offset}&includeMetadata=0`));
      const page = await response.json();
      assert.equal(response.status, 200);
      assert.equal(page.total, 1970);
      assert.equal(page.items.length, 50);
      for (const item of page.items) { assert.equal(item.competitor.price, 275); assert.ok(!seen.has(item.matchId)); seen.add(item.matchId); }
    }
    assert.equal((await db.query("SELECT COUNT(*) n FROM price_history ph JOIN products p ON p.id=ph.product_id JOIN sources s ON s.id=p.source_id WHERE s.slug='venelectronics' AND ph.price_usd<>250")).rows[0].n, 0);
    await db.exec("UPDATE price_display_adjustments SET enabled=TRUE, percentage=10 WHERE source_slug='daka'");
    const both = await service.getOpportunityPage(query, true);
    assert.equal(both.total,1970);
    assert.equal(both.dakaDiscountPercentage,10);
    assert.ok(both.items.every(item => item.daka.price === (item.daka.externalId === "DAKA-1" ? 234 : 270)));
    const combinedBook = new ExcelJS.Workbook();
    await combinedBook.xlsx.load(await buildOpportunityExcel(both,query));
    assert.equal(combinedBook.getWorksheet("Oportunidades").rowCount,1972);
  } finally { await db.close(); }
});
