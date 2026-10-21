import assert from "node:assert/strict";
import test from "node:test";
import { distinctBrands, matchesSelectedBrands, parseSelectedBrands } from "../lib/opportunity-brand-selection.ts";

test("acepta múltiples marcas repetidas en la URL y conserva compatibilidad con una sola", () => {
  assert.deepEqual(parseSelectedBrands(new URLSearchParams("brand=Samsung&brand=LG&brand=samsung")), ["samsung", "LG"]);
  assert.deepEqual(parseSelectedBrands(new URLSearchParams("brand=Whirlpool")), ["Whirlpool"]);
  assert.deepEqual(parseSelectedBrands(new URLSearchParams()), []);
});

test("cualquiera de las marcas seleccionadas puede coincidir con DAKA o una competencia", () => {
  assert.equal(matchesSelectedBrands(["LG", "Samsung"], ["LG", "Sony"]), true);
  assert.equal(matchesSelectedBrands(["LG", "Samsung"], ["Sony", " samsung "]), true);
  assert.equal(matchesSelectedBrands(["LG", "Samsung"], ["Sony", "Apple"]), false);
  assert.equal(matchesSelectedBrands([], [null, "Apple"]), true);
});

test("presenta una sola opción por marca ignorando diferencias de mayúsculas", () => {
  assert.deepEqual(distinctBrands(["apple", "Apple", " LG ", "lg", null]), ["Apple", "lg"]);
});
