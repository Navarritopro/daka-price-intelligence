import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/executive-summary/route.ts", import.meta.url), "utf8");
const view = await readFile(new URL("../components/executive-summary.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/dashboard.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("la portada es aditiva, conserva la vista inicial y la navegación aprobada", () => {
  assert.match(dashboard, /useState<View>\("prices"\)/);
  assert.match(dashboard, /view === "executive" \|\| executiveVisited/);
  assert.match(dashboard, /hidden=\{view !== "executive"\}/);
  assert.match(dashboard, /if \(restoredView === "executive"\) setExecutiveVisited\(true\)/);
  for (const name of ["Inteligencia de precios", "Universo de Productos Daka", "Monitoreo técnico", "Oportunidades comerciales"]) {
    assert.ok(dashboard.includes(name));
  }
  assert.match(dashboard, /"view", \["prices", "universe", "operations", "executive"\]/);
});

test("el endpoint no escribe datos y utiliza dos capturas exitosas por fuente", () => {
  assert.doesNotMatch(route, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
  assert.match(route, /j\.status = 'success'/);
  assert.match(route, /ORDER BY j\.started_at DESC LIMIT 1/);
  assert.match(route, /ORDER BY j\.started_at DESC LIMIT 1 OFFSET 1/);
  assert.match(route, /old\.product_id = ph\.product_id/);
  assert.match(route, /old\.price_usd > 0/);
  assert.match(route, /selected_matches/);
  assert.match(route, /pm\.status = 'confirmed'/);
  assert.match(route, /INTERVAL '48 hours'/);
});

test("los seis orígenes y la calidad existente están presentes", () => {
  for (const slug of ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"]) {
    assert.ok(route.includes(`'${slug}'`));
  }
  assert.match(view, /apiRequest<DataQualityResponse>\("\/api\/data-quality"/);
  assert.match(view, /section=activity/);
  assert.match(view, /section=position/);
  assert.match(route, /section === "position"/);
  assert.match(route, /section === "activity"/);
  assert.doesNotMatch(view, /Promise\.allSettled/);
  assert.match(view, /No se pudo actualizar la calidad/);
});

test("los rótulos evitan presentar capturas como variaciones de hoy", () => {
  assert.match(view, /no necesariamente corresponde al día de hoy/);
  assert.match(view, /Actual: \{date\(source\.currentAt\)\}/);
  assert.match(view, /Anterior: \{date\(source\.previousAt\)\}/);
  assert.match(view, /no representa todo el maestro corporativo/);
  assert.match(view, /no ventas ni rentabilidad/);
  assert.match(view, /no tareas de seguimiento/);
});

test("la portada maneja carga, error parcial y recuperación sin alterar otros módulos", () => {
  assert.match(view, /role="status"/);
  assert.match(view, /role="alert"/);
  assert.match(view, /Reintentar/);
  assert.match(view, /Actualizar resumen/);
  assert.match(view, /onOpenMonitoring/);
  assert.match(view, /onOpenComparison/);
  assert.match(view, /onOpenCatalog/);
});

test("estilos aislados, enfoque visible y contraste AA para texto", () => {
  assert.match(css, /\.executive-summary\{[^}]*color:#0a2143/);
  assert.match(css, /\.executive-summary :is\(p,small,th\)\{color:#52677f/);
  assert.match(css, /\.executive-summary button:focus-visible/);
  assert.match(css, /@media\(max-width:520px\)\{\.exec-kpis/);
  const luminance = (hex) => {
    const values = hex.match(/../g).map((pair) => Number.parseInt(pair, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  for (const foreground of ["0a2143", "52677f", "003288"]) assert.ok(contrast(foreground, "ffffff") >= 4.5);
});
