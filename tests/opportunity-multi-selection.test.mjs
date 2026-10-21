import assert from "node:assert/strict";
import test from "node:test";
import { distinctSelections, matchesOpportunitySelection, parseOpportunitySelections } from "../lib/opportunity-multi-selection.ts";

test("acepta varias opciones repetidas y mantiene enlaces previos de una sola opción", () => {
  const allowed = new Set(["damasco", "ivoo"]);
  assert.deepEqual(parseOpportunitySelections(new URLSearchParams("source=damasco&source=ivoo&source=damasco"), "source", allowed), ["damasco", "ivoo"]);
  assert.deepEqual(parseOpportunitySelections(new URLSearchParams("source=damasco"), "source", allowed), ["damasco"]);
  assert.deepEqual(parseOpportunitySelections(new URLSearchParams("source=all&source=otro"), "source", allowed), []);
  assert.deepEqual(parseOpportunitySelections(new URLSearchParams("category=Audio&category=Televisores"), "category"), ["Audio", "Televisores"]);
});

test("dentro del filtro coincide cualquiera; distintos filtros pueden combinarse", () => {
  assert.equal(matchesOpportunitySelection(["Audio", "Televisores"], ["  televisores ", "Línea blanca"]), true);
  assert.equal(matchesOpportunitySelection(["Audio", "Televisores"], ["Refrigeración"]), false);
  assert.equal(matchesOpportunitySelection([], [null]), true);
  assert.deepEqual(distinctSelections(["Televisores", "televisores", " Audio ", null]), ["televisores", "Audio"]);
});
