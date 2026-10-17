import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nextTabIndex } from "../lib/accessible-tabs.ts";

const dashboard = await readFile(new URL("../components/dashboard.tsx", import.meta.url), "utf8");
const competitors = await readFile(new URL("../components/damasco-catalog.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("la navegación de pestañas recorre, envuelve y salta a los extremos", () => {
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("Home", 2, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 0, 3), null);
});

test("Daka y competidores exponen pestañas navegables y estado seleccionado", () => {
  for (const component of [dashboard, competitors]) {
    assert.match(component, /role="tablist"/);
    assert.match(component, /role="tab"/);
    assert.match(component, /aria-selected=/);
    assert.match(component, /onKeyDown=\{\(event\) => moveTabFocus/);
  }
});

test("los filtros principales tienen etiquetas visibles", () => {
  for (const label of ["Buscar producto", "Marca", "Estado del producto", "Variación", "Período", "Tipo de movimiento", "Magnitud mínima"]) {
    assert.ok(dashboard.includes(`<span>${label}</span>`), `DAKA debe identificar ${label}`);
    assert.ok(competitors.includes(`<span>${label}</span>`), `Competidores deben identificar ${label}`);
  }
  assert.ok(competitors.includes("<span>Categoría</span>"));
  assert.ok(competitors.includes("<span>Disponibilidad</span>"));
});

test("las listas y filas seleccionables pueden operarse sin ratón", () => {
  assert.match(dashboard, /aria-pressed=\{selected\?\.id === product\.id\}/);
  assert.match(competitors, /aria-pressed=\{selected\?\.id === product\.id\}/);
  for (const component of [dashboard, competitors]) {
    assert.match(component, /tabIndex=\{0\} aria-current=/);
    assert.match(component, /event\.key === "Enter" \|\| event\.key === " "/);
  }
});

test("las tablas principales conservan contexto semántico y aviso de desplazamiento", () => {
  for (const component of [dashboard, competitors]) {
    assert.match(component, /<caption className="sr-only">/);
    assert.ok((component.match(/scope="col"/g) ?? []).length >= 5);
    assert.match(component, /desplázate horizontalmente si es necesario/);
    assert.match(component, /movement-indicator/);
  }
});

test("el estilo contempla foco, tacto, móviles y preferencias del usuario", () => {
  assert.match(styles, /Bloque 4B: accesibilidad de catálogos e históricos/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /@media\(forced-colors:active\)/);
});

test("las funciones y columnas aprobadas permanecen presentes", () => {
  for (const fragment of ["/api/products?", "/api/price-changes?", "Unidades reportadas", "Disponibilidad", "Precio anterior", "Precio actual"]) {
    assert.ok(dashboard.includes(fragment), `DAKA debe conservar ${fragment}`);
  }
  for (const fragment of ["damasco", "multimax", "ivoo", "venelectronics", "soytechno", "/api/products?", "/api/price-changes?", "Precio lista", "Unidades reportadas"]) {
    assert.ok(competitors.includes(fragment), `Competidores deben conservar ${fragment}`);
  }
});
