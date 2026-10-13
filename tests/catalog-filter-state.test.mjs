import assert from "node:assert/strict";
import test from "node:test";
import { describeCatalogFilters, describePriceChangeFilters } from "../lib/catalog-filter-state.ts";

test("el catálogo no marca sus valores predeterminados como filtros activos", () => {
  assert.deepEqual(describeCatalogFilters({ search: "", brand: "", category: "", status: "current", stock: "all", change: "all" }), []);
});

test("describe los filtros activos del catálogo con lenguaje claro", () => {
  const result = describeCatalogFilters({
    search: "  televisor  ", brand: "Samsung", category: "Televisores",
    status: "missing", stock: "out", change: "down"
  });
  assert.deepEqual(result.map((filter) => filter.label), [
    "Búsqueda: televisor", "Marca: Samsung", "Categoría: Televisores",
    "Estado: No vistos actualmente", "Disponibilidad: Sin stock", "Variación: Rebajas"
  ]);
});

test("el modo histórico omite los controles deshabilitados", () => {
  const result = describeCatalogFilters({
    search: "nevera", brand: "", category: "Línea blanca", status: "all", stock: "out", change: "same"
  }, { historyMode: true });
  assert.deepEqual(result.map((filter) => filter.label), ["Búsqueda: nevera", "Variación: Sin cambios"]);
});

test("los cambios de precio reconocen período, movimiento, magnitud y estado", () => {
  const result = describePriceChangeFilters({
    search: "aire", brand: "LG", days: "7", movement: "up", threshold: "10", status: "all"
  });
  assert.deepEqual(result.map((filter) => filter.label), [
    "Búsqueda: aire", "Marca: LG", "Período: Últimos 7 días",
    "Movimiento: Solo aumentos", "Magnitud: ≥ 10%", "Estado: Todos los históricos"
  ]);
});

test("el modo reporte no presenta período ni estado como filtros removibles", () => {
  const result = describePriceChangeFilters({
    search: "", brand: "", days: "1", movement: "down", threshold: "5", status: "all"
  }, { reportMode: true });
  assert.deepEqual(result.map((filter) => filter.label), ["Movimiento: Solo rebajas", "Magnitud: ≥ 5%"]);
});
