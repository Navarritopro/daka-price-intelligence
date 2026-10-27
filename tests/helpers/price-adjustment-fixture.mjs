import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

export async function priceFixture() {
  const db = await PGlite.create({ parsers: { 1700: Number, 20: Number } });
  await db.exec(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../../db/price_display_adjustments.sql", import.meta.url), "utf8"));
  await db.exec(`
    INSERT INTO products(source_id,external_id,name,brand,category,url)
      SELECT id, CASE WHEN slug='daka' THEN 'DAKA-1' ELSE 'VE-1' END, 'Televisor de prueba', 'Marca', 'TV', 'https://example.com/'||slug
      FROM sources WHERE slug IN ('daka','venelectronics');
    INSERT INTO scraping_jobs(id,source_id,trigger_type,status,started_at,finished_at,products_found,products_saved)
      SELECT gen_random_uuid(),id,'manual','success',NOW()- INTERVAL '1 hour',NOW()- INTERVAL '59 minutes',1,1 FROM sources;
    INSERT INTO scraping_jobs(id,source_id,trigger_type,status,started_at,finished_at,products_found,products_saved)
      SELECT gen_random_uuid(),id,'manual','success',NOW()- INTERVAL '25 hours',NOW()- INTERVAL '24 hours',1,1 FROM sources;
    INSERT INTO price_history(product_id,job_id,price_usd,list_price_usd,scraped_at,in_stock,available_quantity)
      SELECT p.id,j.id,CASE WHEN s.slug='daka' THEN 260 ELSE 250 END,300,j.started_at,TRUE,5
      FROM products p JOIN sources s ON s.id=p.source_id JOIN scraping_jobs j ON j.source_id=p.source_id;
    INSERT INTO product_matches(daka_product_id,competitor_product_id,status,match_method,confidence)
      SELECT d.id,c.id,'confirmed','manual',1 FROM products d,products c WHERE d.external_id='DAKA-1' AND c.external_id='VE-1';
    INSERT INTO daka_sku_master(sku,line,family,brand,description,master_present,active)
      VALUES('DAKA-1','Digital','TV','Marca','Televisor de prueba',TRUE,TRUE);
    INSERT INTO daka_universe_matches(sku,source_id,competitor_product_id,status,actor_email)
      SELECT 'DAKA-1',p.source_id,p.id,'confirmed','test@example.com' FROM products p WHERE external_id='VE-1';
  `);
  const sql = async (strings, ...values) => {
    const query = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ""), "");
    return (await db.query(query, values)).rows;
  };
  const cache = new Map();
  function load(relative, overrides = {}) {
    if (cache.has(relative) && !Object.keys(overrides).length) return cache.get(relative);
    const exports = {};
    const dependencies = {
      "next/server": { NextResponse: Response },
      "@/lib/db": { getSql: () => sql, asNumber: value => Number(value ?? 0) },
      "@/lib/auth": { getRequestUser: async request => ({ role: request?.headers?.get("x-test-role") ?? "admin" }) },
      ...overrides
    };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, { exports, URLSearchParams, URL, console, process, require: name => {
      if (name in dependencies) return dependencies[name];
      if (name.startsWith("@/lib/")) return load(name.replace("@/", "") + ".ts");
      throw Error(`Dependencia inesperada ${name}`);
    } });
    cache.set(relative, exports);
    return exports;
  }
  function request(path, init) {
    const req = new Request(`http://127.0.0.1:4173${path}`, init);
    req.nextUrl = new URL(req.url);
    return req;
  }
  return { db, load, sql, request };
}
