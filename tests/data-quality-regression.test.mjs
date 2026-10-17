import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/data-quality/route.ts", import.meta.url), "utf8");
const component = await readFile(new URL("../components/data-quality-center.tsx", import.meta.url), "utf8");
const monitoring = await readFile(new URL("../components/technical-monitoring.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const sources = ["daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno"];

test("el endpoint evalúa las seis fuentes aprobadas", () => {
  for (const source of sources) assert.ok(route.includes(source), `Falta la fuente ${source}`);
  for (const metric of ["products_without_sku", "missing_products", "new_products", "matched_products", "review_matches"]) {
    assert.ok(route.includes(metric), `Falta la métrica ${metric}`);
  }
  assert.match(route, /position <= 2/);
  assert.match(route, /idx|price_history/);
});

test("la nueva sección es aditiva y operación sigue siendo la vista inicial", () => {
  assert.match(monitoring, /useState<"operation" \| "quality">\("operation"\)/);
  assert.match(monitoring, />Operación</);
  assert.match(monitoring, />Calidad y cobertura</);
  assert.match(monitoring, /DataQualityCenter/);
});

test("el monitoreo operativo conserva acciones y contenido aprobado", () => {
  for (const fragment of [
    "Enviar resumen por Telegram",
    "Iniciar DAKA manualmente",
    "Abrir GitHub Actions",
    "Actividad reciente de todas las fuentes",
    "Estado de la última ejecución",
    "Registro de actividad",
    "Historial de"
  ]) assert.ok(monitoring.includes(fragment), `Se eliminó el contenido operativo: ${fragment}`);
});

test("la calidad es comprensible y no depende solo del color", () => {
  for (const fragment of ["Correctas", "Con advertencias", "Críticas", "Ver diagnóstico", "¿Cómo se determina el estado?"]) {
    assert.ok(component.includes(fragment), `Falta la explicación visible: ${fragment}`);
  }
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /role="alert"/);
  assert.match(component, /aria-label={`Ver diagnóstico/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("la interfaz expone recuperación, validación y detalle sin modificar datos", () => {
  assert.match(component, /Actualizar evaluación/);
  assert.match(component, /Reintentar/);
  assert.match(component, /Abrir operación de esta fuente/);
  assert.match(component, /Validar sitio de origen/);
  assert.doesNotMatch(route, /INSERT|UPDATE|DELETE/);
});
