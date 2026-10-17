import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../components/product-360-view.tsx", import.meta.url), "utf8");
const universe = await readFile(new URL("../components/daka-product-universe.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/product-360/[sku]/route.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function luminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("la Ficha 360 consulta las cinco competencias aprobadas", () => {
  for (const source of ["damasco", "multimax", "ivoo", "venelectronics", "soytechno"]) {
    assert.match(route, new RegExp(`source: "${source}"`));
    assert.match(styles, new RegExp(`source-${source}`));
  }
  assert.match(component, /source-\$\{comparison\.source\}/);
  assert.match(route, /product_matches/);
  assert.match(route, /daka_universe_matches/);
});

test("el endpoint 360 es de solo lectura y conserva homologaciones manuales", () => {
  assert.doesNotMatch(route, /sql`[\s\S]*?\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  assert.match(route, /'universe'::text AS origin/);
  assert.match(route, /priority, confidence DESC/);
});

test("la ficha aprobada sigue siendo la vista inicial", () => {
  assert.match(universe, /useState<"current" \| "360">\("current"\)/);
  assert.match(universe, />Ficha actual</);
  assert.match(universe, />Visión 360°</);
  for (const approvedContent of ["Precios Daka", "Cédula de octubre 2026", "Inventario por ubicación", "Ver historial de precios cargados"]) {
    assert.match(universe, new RegExp(approvedContent));
  }
});

test("la nueva vista carga bajo demanda mediante la capa API segura", () => {
  assert.match(component, /apiRequest<Product360>/);
  assert.match(component, /encodeURIComponent\(sku\)/);
  assert.match(component, /retries: 1/);
  assert.doesNotMatch(component, /response\.json\s*\(/);
  assert.match(component, /No se pudo cargar la Visión 360°/);
  assert.match(component, />Reintentar</);
});

test("la lectura comercial incluye precio anterior, posición, homologación e histórico", () => {
  for (const content of ["Precio DAKA de referencia", "Homologación competitiva", "Posición de DAKA", "Mejor precio disponible", "Sin precio anterior comparable", "Histórico web DAKA", "Señales activas"]) {
    assert.match(component, new RegExp(content));
  }
  assert.match(component, /matchedCompetitors/);
  assert.match(component, /previousPrice/);
  assert.match(component, /differencePct/);
});

test("la comparación no depende únicamente del color", () => {
  assert.match(component, /Mejor precio disponible/);
  assert.match(component, /Mayor precio disponible/);
  assert.match(component, /Homologación manual confirmada/);
  assert.match(component, /Producto no homologado/);
  assert.match(component, /Riesgo|signal\.label/);
});

test("las pestañas y estados exponen semántica accesible", () => {
  assert.match(universe, /role="tablist" aria-label="Vistas de la ficha del producto"/);
  assert.match(universe, /role="tab" tabIndex=/);
  assert.match(universe, /nextTabIndex\(event\.key, currentIndex, 2\)/);
  assert.match(universe, /role="tabpanel"/);
  assert.match(universe, /aria-controls="product-detail-panel"/);
  assert.match(component, /role="status"/);
  assert.match(component, /role="alert"/);
  assert.match(component, /aria-label="Posición competitiva por precio disponible"/);
  assert.match(styles, /\.universe-drawer-tabs button:focus-visible/);
});

test("la Ficha 360 aísla texto y fondos con contraste AA", () => {
  assert.match(styles, /\.product-360\{[^}]*color:#0a2143/);
  assert.match(styles, /\.product-360 :is\(p,small,dt\)\{color:#52677f/);
  assert.ok(contrast("0a2143", "ffffff") >= 4.5);
  assert.ok(contrast("52677f", "ffffff") >= 4.5);
  assert.ok(contrast("003288", "ffffff") >= 4.5);
});
