import assert from "node:assert/strict";
import test from "node:test";
import { compareOpportunities } from "../lib/opportunity-sort.ts";

function opportunity(name, sourceName, score, differenceUsd, differencePct) {
  return { daka: { name }, primary: { sourceName, score, differenceUsd, differencePct } };
}

const data = [
  opportunity("Producto C", "Multimax", 80, -20, -5),
  opportunity("Producto A", "Damasco", 90, 100, 25),
  opportunity("Producto B", "IVOO", 70, null, null)
];

test("ordena el universo por nombre de competencia", () => {
  assert.deepEqual([...data].sort((a, b) => compareOpportunities(a, b, "competitor_asc")).map((item) => item.primary.sourceName), ["Damasco", "IVOO", "Multimax"]);
  assert.deepEqual([...data].sort((a, b) => compareOpportunities(a, b, "competitor_desc")).map((item) => item.primary.sourceName), ["Multimax", "IVOO", "Damasco"]);
});

test("ordena brechas por magnitud y deja valores no comparables al final", () => {
  assert.deepEqual([...data].sort((a, b) => compareOpportunities(a, b, "gap_usd_desc")).map((item) => item.daka.name), ["Producto A", "Producto C", "Producto B"]);
  assert.deepEqual([...data].sort((a, b) => compareOpportunities(a, b, "gap_pct_asc")).map((item) => item.daka.name), ["Producto C", "Producto A", "Producto B"]);
});

test("prioridad conserva el orden comercial existente", () => {
  assert.deepEqual([...data].sort((a, b) => compareOpportunities(a, b, "priority")).map((item) => item.primary.score), [90, 80, 70]);
});
