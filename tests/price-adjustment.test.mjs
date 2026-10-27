import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { parsePriceAdjustment, priceAdjustmentNote } from "../lib/price-adjustment.ts";

const migration = readFileSync(new URL("../db/price_display_adjustments.sql", import.meta.url), "utf8");
async function database() {
  const db = await PGlite.create({ parsers: { 1700: Number } });
  await db.exec(`CREATE TABLE sources(id INTEGER PRIMARY KEY, slug TEXT UNIQUE);
    CREATE TABLE products(id INTEGER PRIMARY KEY, source_id INTEGER);
    CREATE TABLE price_history(id INTEGER PRIMARY KEY, product_id INTEGER, job_id TEXT,
      price_usd NUMERIC, list_price_usd NUMERIC, scraped_at TEXT, in_stock BOOLEAN, available_quantity INTEGER);
    INSERT INTO sources VALUES (1, 'venelectronics'), (2, 'daka'), (3, 'damasco'), (4, 'multimax'), (5, 'ivoo'), (6, 'soytechno');
    INSERT INTO products VALUES (1,1),(2,2),(3,3),(4,4),(5,5),(6,6),(7,1),(8,1);
    INSERT INTO price_history VALUES
      (1,1,'a',250,300,'2026-10-27',TRUE,5), (2,2,'a',260,300,'2026-10-27',TRUE,2),
      (3,3,'a',250,300,'2026-10-27',FALSE,0), (4,4,'a',250,300,'2026-10-27',TRUE,2),
      (5,5,'a',250,300,'2026-10-27',TRUE,2), (6,6,'a',250,300,'2026-10-27',TRUE,2),
      (7,7,'a',NULL,NULL,'2026-10-27',FALSE,0),(8,8,'a',2.50,3.50,'2026-10-27',TRUE,1);`);
  await db.exec(migration);
  return db;
}
const original = async db => JSON.stringify((await db.query("SELECT * FROM price_history ORDER BY id")).rows);
const config = (db, percentage, enabled = true) => db.query("UPDATE price_display_adjustments SET enabled=$1,percentage=$2 WHERE source_slug='venelectronics'", [enabled, percentage]);
const price = async (db, id = 1) => (await db.query("SELECT * FROM display_price_history WHERE product_id=$1 ORDER BY id DESC LIMIT 1", [id])).rows[0];

test("la vista aplica el ejemplo aprobado y recalcula desde el precio original sin acumular incrementos", async () => {
  const db = await database(), before = await original(db);
  await config(db, 10); assert.equal((await price(db)).price_usd, 275);
  assert.equal((await price(db)).captured_price_usd, 250);
  assert.equal((await price(db)).list_price_usd, 330);
  await config(db, 20); assert.equal((await price(db)).price_usd, 300);
  await config(db, 10, false); assert.equal((await price(db)).price_usd, 250);
  assert.equal(await original(db), before);
  await assert.rejects(db.query("UPDATE display_price_history SET price_usd=999 WHERE product_id=1"));
  assert.equal(await original(db), before);
  await db.close();
});

test("acepta 1–100%, redondea a centavos y conserva NULL, stock y demás competidores", async () => {
  const db = await database(), before = await original(db);
  for (let p = 1; p <= 100; p++) {
    await config(db, p);
    assert.equal((await price(db)).price_usd, 250 * (100 + p) / 100);
    const expectedCents = Math.floor((250 * (100 + p) + 50) / 100);
    assert.equal((await price(db, 8)).price_usd, expectedCents / 100);
    assert.equal((await price(db, 7)).price_usd, null);
    for (const id of [2,3,4,5,6]) {
      assert.equal((await price(db, id)).price_usd, id === 2 ? 260 : 250);
      assert.equal((await price(db, id)).adjustment_percentage, 0);
    }
    assert.equal((await price(db)).in_stock, true);
    assert.equal((await price(db)).available_quantity, 5);
  }
  assert.equal(await original(db), before);
  await db.close();
});

test("las nuevas capturas conservan su precio y heredan el ajuste solo al leer", async () => {
  const db = await database();
  await config(db, 10);
  await db.exec("INSERT INTO price_history VALUES(9,1,'b',260,300,'2026-10-28',TRUE,3)");
  assert.equal((await price(db)).price_usd, 286);
  await config(db, 20); assert.equal((await price(db)).price_usd, 312);
  assert.equal((await db.query("SELECT price_usd FROM price_history WHERE id=9")).rows[0].price_usd, 260);
  await db.exec(migration);
  assert.equal((await price(db)).price_usd, 312); // Preparar de nuevo no borra la configuración.
  await db.close();
});

test("las posiciones y los filtros SQL usan el ajuste antes de paginar", async () => {
  const db = await database();
  const compare = async () => (await db.query(`SELECT v.price_usd, CASE WHEN d.price_usd < v.price_usd THEN 'daka_lower' ELSE 'competitor_lower' END position
    FROM display_price_history v JOIN display_price_history d ON d.product_id=2 WHERE v.product_id=1 LIMIT 1`)).rows[0];
  assert.equal((await compare()).position, "competitor_lower");
  await config(db, 10); assert.equal((await compare()).position, "daka_lower");
  assert.equal(Number((await db.query("SELECT COUNT(*) n FROM display_price_history WHERE product_id=1 AND price_usd>260")).rows[0].n), 1);
  await config(db, 10, false); assert.equal((await compare()).position, "competitor_lower");
  await db.close();
});

test("permisos, validación y persistencia de la configuración vigente en el endpoint", async () => {
  const db = await database(); let user = null;
  const sql = async (strings, ...values) => {
    const query = strings.reduce((q, part, index) => q + part + (index < values.length ? `$${index + 1}` : ""), "");
    return (await db.query(query, values)).rows;
  };
  const exports = {};
  const dependencies = {
    "next/server": { NextResponse: Response }, "@/lib/auth": { getRequestUser: async () => user },
    "@/lib/db": { getSql: () => sql }, "@/lib/price-adjustment": { parsePriceAdjustment }
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/price-adjustment/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: name => dependencies[name] });
  const request = (body, origin = "https://local") => {
    const req = new Request("https://local/api/price-adjustment", { method: "PUT", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
    req.nextUrl = new URL(req.url); return req;
  };
  assert.equal((await exports.GET(request({}))).status, 401);
  user = { role: "viewer" };
  assert.equal((await exports.PUT(request({ enabled: true, percentage: 10 }))).status, 403);
  user = { role: "admin" };
  assert.equal((await exports.PUT(request({ enabled: true, percentage: 10 }, "https://other"))).status, 403);
  for (const p of [0, 101, 1.5, "10", null]) assert.equal((await exports.PUT(request({ enabled: true, percentage: p }))).status, 400);
  for (const p of [1, 10, 100]) {
    assert.equal((await exports.PUT(request({ enabled: true, percentage: p }))).status, 200);
    const result = await exports.GET(request({}));
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await result.json(), { enabled: true, percentage: p });
  }
  assert.equal((await exports.PUT(request({ enabled: false, percentage: 100 }))).status, 200);
  assert.equal((await price(db)).price_usd, 250);
  await db.close();
});

test("todos los consumidores comerciales usan la vista; el scraping sigue escribiendo los originales", () => {
  function walk(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(new URL(`${e.name}/`, directory)) : [new URL(e.name, directory)]); }
  for (const path of [...walk(new URL("../app/api/", import.meta.url)), new URL("../lib/opportunities-service.ts", import.meta.url)]) {
    const source = readFileSync(path, "utf8");
    if (path.pathname.includes("/data-quality/") || path.pathname.includes("/jobs/")
      || path.pathname.endsWith("/daka-universe/route.ts") || path.pathname.endsWith("/daka-universe/[sku]/route.ts")) continue;
    assert.doesNotMatch(source, /\b(?:FROM|JOIN) price_history\b/, path.pathname);
    assert.doesNotMatch(source, /(?:UPDATE|INSERT INTO) (?:display_)?price_history\b/, path.pathname);
  }
  assert.match(priceAdjustmentNote(10), /\+10%/);
  assert.match(priceAdjustmentNote(0), /desactivado/);
});
