import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import ExcelJS from "exceljs";
import { priceFixture } from "./helpers/price-adjustment-fixture.mjs";
import { parsePriceAdjustment, priceAdjustmentNote } from "../lib/price-adjustment.ts";
import { buildOpportunityExcel, buildOpportunityPdf, buildOpportunityTelegramCaption } from "../lib/opportunity-reports.ts";

async function set(fixture, source, enabled, percentage, role = "admin") {
  return fixture.load("app/api/price-adjustment/route.ts").PUT(fixture.request(`/api/price-adjustment?source=${source}`, {
    method: "PUT", headers: { "x-test-role": role }, body: JSON.stringify({ enabled, percentage })
  }));
}

test("actualizar desde Venelectronics preserva su configuración y agrega DAKA desactivado con máximo 99", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("./fixtures/venelectronics-price-adjustments-v1.sql", import.meta.url), "utf8"));
    await db.exec("UPDATE price_display_adjustments SET enabled=TRUE,percentage=37 WHERE source_slug='venelectronics'");
    const migration = readFileSync(new URL("../db/price_display_adjustments.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    const { rows } = await db.query("SELECT * FROM price_display_adjustments ORDER BY source_slug");
    assert.deepEqual(rows, [{ source_slug: "daka", enabled: false, percentage: 1 }, { source_slug: "venelectronics", enabled: true, percentage: 37 }]);
    await assert.rejects(db.exec("UPDATE price_display_adjustments SET percentage=100 WHERE source_slug='daka'"));
    await db.exec("UPDATE price_display_adjustments SET percentage=100 WHERE source_slug='venelectronics'");
  } finally { await db.close(); }
});

test("DAKA calcula 250 menos 10% como 225, admite 1–99 y no acumula descuentos ni modifica el scraping", async () => {
  const fixture = await priceFixture(); const { db, load, request } = fixture;
  try {
    await db.exec("UPDATE price_history SET price_usd=250 WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1')");
    const captured = (await db.query("SELECT * FROM price_history ORDER BY id")).rows;
    const displayed = async () => (await db.query("SELECT * FROM display_price_history WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1') ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal((await set(fixture,"daka",true,10)).status, 200);
    assert.equal((await displayed()).price_usd, 225);
    assert.equal((await displayed()).captured_price_usd, 250);
    assert.equal((await displayed()).adjustment_percentage, -10);
    assert.equal((await set(fixture,"daka",true,20)).status, 200);
    assert.equal((await displayed()).price_usd, 200);
    for (let percentage = 1; percentage <= 99; percentage++) {
      assert.equal((await set(fixture,"daka",true,percentage)).status, 200);
      assert.equal((await displayed()).price_usd, Math.floor((25000 * (100 - percentage) + 50) / 100) / 100);
    }
    for (const percentage of [0,100,101,1.5,"10",null]) {
      assert.equal((await set(fixture,"daka",true,percentage)).status, 400);
      assert.throws(() => parsePriceAdjustment({ enabled: true, percentage }, "daka"));
    }
    assert.equal((await set(fixture,"daka",true,10,"viewer")).status, 403);
    assert.equal((await set(fixture,"other",true,10)).status, 400);
    assert.equal((await set(fixture,"daka",false,10)).status, 200);
    assert.equal((await displayed()).price_usd, 250);
    assert.deepEqual((await db.query("SELECT * FROM price_history ORDER BY id")).rows, captured);
    const oldEndpoint = await load("app/api/price-adjustment/route.ts").GET(request("/api/price-adjustment"));
    assert.equal((await oldEndpoint.json()).enabled, false);
    assert.match(priceAdjustmentNote(10,"daka"), /Base Otras/);
  } finally { await db.close(); }
});

test("ambos ajustes coinciden en comparador, oportunidades, resumen, fichas y reportes; Base Otras queda intacta", async () => {
  const fixture = await priceFixture(); const { db, load, request } = fixture;
  try {
    await db.exec(`
      UPDATE price_history SET price_usd=250 WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1');
      INSERT INTO daka_sku_master(sku,line,family,brand,description,master_present,active)
        VALUES ('LIST-ONLY','Digital','TV','Marca','Solo lista',TRUE,TRUE);
      WITH batch AS (
        INSERT INTO daka_import_batches(id,file_type,filename,checksum_sha256,effective_date,row_count,unique_skus,imported_by_email)
        VALUES(gen_random_uuid(),'price_list','lista.xlsx','fixture',CURRENT_DATE,2,2,'test@example.com') RETURNING id
      ), snapshot AS (
        INSERT INTO daka_price_snapshots(id,effective_date,list_name,version,is_active,source_batch_id)
        SELECT gen_random_uuid(),CURRENT_DATE,'base otras',1,TRUE,id FROM batch RETURNING id
      ) INSERT INTO daka_price_items(snapshot_id,sku,source_description,price_usd)
        SELECT id,sku,'Producto lista',500 FROM snapshot CROSS JOIN (VALUES('DAKA-1'),('LIST-ONLY')) t(sku);
    `);
    const captured = (await db.query("SELECT * FROM price_history ORDER BY id")).rows;
    const list = (await db.query("SELECT * FROM daka_price_items ORDER BY sku")).rows;
    await set(fixture,"daka",true,10); await set(fixture,"venelectronics",true,10);
    const catalog = await (await load("app/api/products/route.ts").GET(request("/api/products?source=daka"))).json();
    assert.equal(catalog.items[0].currentPrice,225);
    assert.equal(catalog.items[0].capturedPrice,250);
    const pair = await (await load("app/api/comparison/route.ts").GET(request("/api/comparison?source=venelectronics"))).json();
    assert.equal(pair.items[0].daka.price,225); assert.equal(pair.items[0].competitor.price,275);
    assert.equal(pair.items[0].differenceUsd,-50);
    const universe = await (await load("app/api/daka-universe/route.ts").GET(request("/api/daka-universe"))).json();
    assert.equal(universe.items.find(row => row.sku === "DAKA-1").price.webPrice,225);
    assert.equal(universe.items.find(row => row.sku === "DAKA-1").price.listPrice,500);
    assert.equal(universe.items.find(row => row.sku === "LIST-ONLY").price.amount,500);
    const detail = await (await load("app/api/daka-universe/[sku]/route.ts").GET(request("/api/daka-universe/DAKA-1"), { params: Promise.resolve({ sku:"DAKA-1" }) })).json();
    assert.equal(detail.web.price,225); assert.equal(detail.prices[0].amount,500);
    const full = await (await load("app/api/product-360/[sku]/route.ts").GET(request("/api/product-360/DAKA-1"), { params: Promise.resolve({ sku:"DAKA-1" }) })).json();
    assert.ok(JSON.stringify(full).includes("225")); assert.ok(JSON.stringify(full).includes("275"));
    const summary = await load("app/api/executive-summary/route.ts").GET(request("/api/executive-summary?section=position"));
    assert.equal(summary.status,200); assert.ok(JSON.stringify(await summary.json()).includes("225"));
    const history = await load("app/api/comparison-history/route.ts").GET(request("/api/comparison-history?source=venelectronics"));
    assert.equal(history.status,200);
    assert.equal((await history.json()).items[0].dakaAdjustmentPercentage,-10);
    const service = load("lib/opportunities-service.ts");
    const query = service.parseOpportunityQuery(new URLSearchParams("source=venelectronics&minimumGap=1"));
    const page = await service.getOpportunityPage(query,true);
    assert.equal(page.items[0].daka.price,225); assert.equal(page.items[0].comparisons[0].competitor.price,275);
    assert.equal(page.dakaDiscountPercentage,10); assert.equal(page.priceAdjustmentPercentage,10);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildOpportunityExcel(page,query));
    const exported = JSON.stringify(book.getWorksheet("Oportunidades").getSheetValues());
    assert.ok(exported.includes("225")); assert.ok(exported.includes("275"));
    const caption = buildOpportunityTelegramCaption(page,query);
    assert.match(caption, /DAKA web -10%/); assert.match(caption,/\+10%/);
    assert.equal((await buildOpportunityPdf(page,query)).subarray(0,4).toString(),"%PDF");
    assert.deepEqual((await db.query("SELECT * FROM price_history ORDER BY id")).rows,captured);
    assert.deepEqual((await db.query("SELECT * FROM daka_price_items ORDER BY sku")).rows,list);
    await set(fixture,"daka",false,10);
    const afterDisable = await (await load("app/api/comparison/route.ts").GET(request("/api/comparison?source=venelectronics"))).json();
    assert.equal(afterDisable.items[0].daka.price,250);
    assert.equal(afterDisable.items[0].competitor.price,275);
  } finally { await db.close(); }
});

test("nuevas capturas heredan el descuento al leer; el redondeo conserva centavos y nulos sin reescribirlos", async () => {
  const fixture = await priceFixture(); const { db } = fixture;
  try {
    await db.exec("UPDATE price_history SET price_usd=250 WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1')");
    await set(fixture,"daka",true,10);
    await db.exec(`WITH job AS (
      INSERT INTO scraping_jobs(id,source_id,trigger_type,status,started_at,finished_at,products_found,products_saved)
        SELECT gen_random_uuid(),id,'manual','success',NOW(),NOW(),1,1 FROM sources WHERE slug='daka' RETURNING id
      ) INSERT INTO price_history(product_id,job_id,price_usd,scraped_at,in_stock)
        SELECT p.id,j.id,260,NOW(),TRUE FROM products p CROSS JOIN job j WHERE p.external_id='DAKA-1'`);
    const newCapture = (await db.query("SELECT price_usd,captured_price_usd FROM display_price_history WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1') ORDER BY id DESC LIMIT 1")).rows[0];
    assert.equal(newCapture.price_usd,234); assert.equal(newCapture.captured_price_usd,260);
    await db.exec("UPDATE price_history SET price_usd=2.50 WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1')");
    await set(fixture,"daka",true,1);
    assert.equal((await db.query("SELECT price_usd FROM display_price_history WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1') LIMIT 1")).rows[0].price_usd,2.48);
    await db.exec("UPDATE price_history SET price_usd=NULL WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1')");
    assert.equal((await db.query("SELECT price_usd FROM display_price_history WHERE product_id=(SELECT id FROM products WHERE external_id='DAKA-1') LIMIT 1")).rows[0].price_usd,null);
  } finally { await db.close(); }
});
