import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/dashboard.tsx", import.meta.url), "utf8");
const competitors = await readFile(new URL("../components/damasco-catalog.tsx", import.meta.url), "utf8");

test("DAKA conserva filtros recuperables en catálogo y cambios de precios", () => {
  assert.match(dashboard, /filters=\{catalogActiveFilters\}/);
  assert.match(dashboard, /filters=\{priceChangeActiveFilters\}/);
  assert.match(dashboard, /setProductRefreshToken/);
  assert.match(dashboard, /setChangeRefreshToken/);
});

test("los cinco competidores comparten el mismo patrón de filtros y recuperación", () => {
  assert.match(competitors, /damasco.*multimax.*ivoo.*venelectronics.*soytechno/s);
  assert.match(competitors, /filters=\{catalogActiveFilters\}/);
  assert.match(competitors, /filters=\{priceChangeActiveFilters\}/);
  assert.match(competitors, /setProductRefreshToken/);
  assert.match(competitors, /setChangeRefreshToken/);
});

test("las columnas aprobadas del histórico de DAKA permanecen intactas", () => {
  assert.match(dashboard, /Precio anterior/);
  assert.match(dashboard, /Precio actual/);
  assert.match(dashboard, /Disponibilidad/);
  assert.match(dashboard, /Unidades reportadas/);
});

test("las columnas aprobadas del histórico competidor permanecen intactas", () => {
  for (const heading of ["Precio anterior", "Precio actual", "Precio lista", "Disponibilidad", "Unidades reportadas"]) {
    assert.ok(competitors.includes(heading), `Falta la columna protegida: ${heading}`);
  }
});
