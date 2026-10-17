import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutivePosition } from "../lib/executive-summary.ts";

const now = Date.parse("2026-10-17T15:00:00Z");
const recent = "2026-10-17T09:00:00Z";
const old = "2026-10-14T09:00:00Z";

function pair(overrides = {}) {
  return {
    dakaId: 1, dakaSku: "LB-1", dakaName: "Producto DAKA", dakaUrl: "https://tiendasdaka.com/p",
    source: "damasco", sourceName: "Damasco", competitorName: "Producto competidor",
    competitorUrl: "https://example.com/p", dakaPrice: 100, competitorPrice: 80,
    dakaAvailable: true, competitorAvailable: true, dakaAt: recent, competitorAt: recent,
    ...overrides
  };
}

test("sin comparables no fabrica una posición de DAKA", () => {
  const result = buildExecutivePosition([], now);
  assert.equal(result.comparedProducts, 0);
  assert.equal(result.dakaBest, 0);
  assert.equal(result.dakaWorst, 0);
  assert.deepEqual(result.topRisks, []);
});

test("clasifica precio estrictamente mejor, peor y empate por SKU", () => {
  const result = buildExecutivePosition([
    pair({ dakaId: 1, dakaPrice: 100, competitorPrice: 80 }),
    pair({ dakaId: 1, source: "ivoo", sourceName: "IVOO", competitorPrice: 90 }),
    pair({ dakaId: 2, dakaSku: "LB-2", dakaPrice: 50, competitorPrice: 100 }),
    pair({ dakaId: 3, dakaSku: "LB-3", dakaPrice: 80, competitorPrice: 80 })
  ], now);
  assert.equal(result.comparedProducts, 3);
  assert.equal(result.dakaBest, 1);
  assert.equal(result.dakaWorst, 1);
  assert.equal(result.tiedBest, 1);
  assert.equal(result.competitorCheaperPairs, 2);
  assert.equal(result.competitorMoreExpensivePairs, 1);
  assert.equal(result.riskProducts, 1);
  assert.equal(result.advantageProducts, 1);
});

test("la misma referencia no se duplica por varios competidores", () => {
  const result = buildExecutivePosition([
    pair({ competitorPrice: 85 }),
    pair({ source: "ivoo", sourceName: "IVOO", competitorPrice: 60 })
  ], now);
  assert.equal(result.riskProducts, 1);
  assert.equal(result.topRisks.length, 1);
  assert.equal(result.topRisks[0].source, "ivoo");
});

test("no considera precio sin stock, desconocido, nulo ni captura desactualizada", () => {
  const result = buildExecutivePosition([
    pair({ dakaId: 1, competitorAvailable: false }),
    pair({ dakaId: 2, competitorAvailable: null }),
    pair({ dakaId: 3, competitorPrice: null }),
    pair({ dakaId: 4, competitorPrice: 0 }),
    pair({ dakaId: 5, competitorAt: old }),
    pair({ dakaId: 6, dakaAt: "2026-10-18T09:00:00Z" })
  ], now);
  assert.equal(result.comparedProducts, 0);
  assert.equal(result.riskProducts, 0);
});

test("la brecha del 5% es inclusiva y la ventaja se ordena por magnitud", () => {
  const result = buildExecutivePosition([
    pair({ dakaId: 1, dakaPrice: 105, competitorPrice: 100 }),
    pair({ dakaId: 2, dakaSku: "LB-2", dakaPrice: 95, competitorPrice: 100 }),
    pair({ dakaId: 3, dakaSku: "LB-3", dakaPrice: 60, competitorPrice: 100 }),
    pair({ dakaId: 4, dakaSku: "LB-4", dakaPrice: 99, competitorPrice: 100 })
  ], now);
  assert.equal(result.riskProducts, 1);
  assert.equal(result.advantageProducts, 2);
  assert.equal(result.topAdvantages[0].sku, "LB-3");
  assert.equal(result.topRisks[0].gapUsd, 5);
});

test("el top no excede cinco SKU aun con más referencias con brecha", () => {
  const rows = Array.from({ length: 9 }, (_, index) => pair({ dakaId: index + 1, dakaSku: `LB-${index + 1}`, dakaPrice: 110 + index }));
  const result = buildExecutivePosition(rows, now);
  assert.equal(result.riskProducts, 9);
  assert.equal(result.topRisks.length, 5);
  assert.equal(result.topRisks[0].sku, "LB-9");
});
