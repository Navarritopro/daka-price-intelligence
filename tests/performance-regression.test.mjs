import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../db/performance_indexes.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/optimize-database.yml", import.meta.url), "utf8");
const productsRoute = await readFile(new URL("../app/api/products/route.ts", import.meta.url), "utf8");
const changesRoute = await readFile(new URL("../app/api/price-changes/route.ts", import.meta.url), "utf8");
const comparisonRoute = await readFile(new URL("../app/api/comparison/route.ts", import.meta.url), "utf8");
const catalogSummary = await readFile(new URL("../app/api/catalog-summary/route.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/dashboard.tsx", import.meta.url), "utf8");
const competitors = await readFile(new URL("../components/damasco-catalog.tsx", import.meta.url), "utf8");
const comparison = await readFile(new URL("../components/competitor-comparison.tsx", import.meta.url), "utf8");
const catalogChangesRoute = await readFile(new URL("../app/api/catalog-changes/route.ts", import.meta.url), "utf8");
const catalogChanges = await readFile(new URL("../components/catalog-changes.tsx", import.meta.url), "utf8");

const expectedIndexes = [
  "idx_jobs_source_status_started_cover",
  "idx_price_history_job_product_cover",
  "idx_price_history_product_scraped_cover",
  "idx_products_source_brand_normalized",
  "idx_products_source_category_present",
  "idx_matches_status_daka_competitor",
  "idx_matches_status_competitor_daka",
  "idx_alerts_source_created_product",
  "idx_daka_card_sku_period",
  "idx_daka_inventory_snapshot_date",
  "idx_daka_price_active_date",
  "idx_daka_universe_source_status_sku"
];

test("la migración crea los índices de lectura sin bloquear el scraping", () => {
  for (const index of expectedIndexes) {
    assert.ok(migration.includes(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index}`), `Falta ${index}`);
    assert.ok(schema.includes(`CREATE INDEX IF NOT EXISTS ${index}`), `El esquema base debe incluir ${index}`);
  }
  assert.doesNotMatch(migration, /BEGIN;|COMMIT;/);
  assert.match(migration, /ANALYZE price_history;/);
  assert.match(migration, /ANALYZE product_matches;/);
});

test("el workflow exige confirmación y verifica todos los índices", () => {
  assert.match(workflow, /inputs\.confirm == 'OPTIMIZAR'/);
  assert.match(workflow, /db\/performance_indexes\.sql/);
  assert.match(workflow, /expected=12/);
  assert.match(workflow, /TEMP_DATABASE_URL \|\| secrets\.DATABASE_URL/);
});

test("los endpoints permiten omitir metadatos repetidos en páginas siguientes", () => {
  for (const route of [productsRoute, changesRoute, comparisonRoute]) {
    assert.match(route, /searchParams\.get\("includeMetadata"\) !== "0"/);
    assert.match(route, /includeMetadata \? await sql/);
  }
});

test("la interfaz omite consultas repetidas solo en paginación o cuando ya posee metadatos", () => {
  assert.ok((dashboard.match(/params\.set\("includeMetadata", "0"\)/g) ?? []).length === 2);
  assert.match(competitors, /includeMetadata: "0"/);
  assert.match(competitors, /params\.set\("includeMetadata", "0"\)/);
  assert.match(comparison, /nextParameters\.set\("includeMetadata", "0"\)/);
  assert.doesNotMatch(comparison.slice(comparison.indexOf("const loadMore"), comparison.indexOf("if (mode === \"review\")")), /setStats\(page\.stats\)/);
});

test("el resumen competidor obtiene métricas y filtros en una sola consulta", () => {
  assert.match(catalogSummary, /AS categories/);
  assert.match(catalogSummary, /AS brands/);
  assert.doesNotMatch(catalogSummary, /const categoryRows/);
  assert.doesNotMatch(catalogSummary, /const brandRows/);
});

test("la exportación y paginación de cambios de catálogo no recalculan metadatos", () => {
  assert.match(catalogChangesRoute, /searchParams\.get\("includeMetadata"\) !== "0"/);
  assert.match(catalogChangesRoute, /comparisonRows = includeMetadata \? await sql/);
  assert.match(catalogChanges, /nextParameters\.set\("includeMetadata", "0"\)/);
  assert.match(catalogChanges, /exportParameters\.set\("includeMetadata", "0"\)/);
  assert.match(catalogChanges, /comparisons: current\.comparisons/);
});

test("la optimización conserva fuentes, estados y columnas aprobadas", () => {
  for (const fragment of ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"]) {
    assert.ok(productsRoute.includes(fragment), `Debe conservar la fuente ${fragment}`);
  }
  for (const fragment of ["current", "missing", "all", "price_usd", "available_quantity", "seen_in_latest"]) {
    assert.ok(productsRoute.includes(fragment), `Debe conservar ${fragment}`);
  }
  for (const fragment of ["productsMonitored", "priceDropsToday", "lastScrapeAt"]) {
    assert.ok(dashboard.includes(fragment), `El dashboard debe conservar ${fragment}`);
  }
});
