import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COMPARISON_FILTERS, describeComparisonFilters } from "../lib/comparison-filter-state.ts";

test("no marca los valores predeterminados como filtros activos", () => {
  assert.deepEqual(describeComparisonFilters(DEFAULT_COMPARISON_FILTERS, "Damasco"), []);
});

test("describe todos los criterios activos con lenguaje comprensible", () => {
  const result = describeComparisonFilters({
    search: "  televisor  ",
    brand: "Samsung",
    category: "Televisores",
    position: "competitor_lower",
    sort: "recent"
  }, "Multimax");
  assert.deepEqual(result.map((filter) => filter.label), [
    "Búsqueda: televisor",
    "Marca: Samsung",
    "Categoría: Televisores",
    "Posición: Multimax más económico",
    "Orden: Captura más reciente"
  ]);
});

test("identifica una posición de empate", () => {
  const result = describeComparisonFilters({ ...DEFAULT_COMPARISON_FILTERS, position: "equal" }, "IVOO");
  assert.equal(result[0].label, "Posición: Mismo precio");
});
