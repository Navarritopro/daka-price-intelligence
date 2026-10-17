import assert from "node:assert/strict";
import test from "node:test";
import { allowedQueryValue, mergeQueryString, queryText } from "../lib/navigation-state.ts";

test("actualiza parámetros propios sin eliminar enlaces profundos existentes", () => {
  const result = mergeQueryString("?source=daka&currentJob=10", { view: "prices", priceTab: "changes", search: "tv" });
  const params = new URLSearchParams(result);
  assert.equal(params.get("source"), "daka");
  assert.equal(params.get("currentJob"), "10");
  assert.equal(params.get("priceTab"), "changes");
  assert.equal(params.get("search"), "tv");
});

test("elimina valores vacíos sin dejar un signo de interrogación huérfano", () => {
  assert.equal(mergeQueryString("?search=tv", { search: "" }), "");
});

test("solo restaura valores incluidos en la lista permitida", () => {
  const params = new URLSearchParams("view=invalid&priceTab=changes");
  assert.equal(allowedQueryValue(params, "view", ["prices", "universe", "operations"], "prices"), "prices");
  assert.equal(allowedQueryValue(params, "priceTab", ["explore", "changes"], "explore"), "changes");
});

test("normaliza y limita texto proveniente de la URL", () => {
  const params = new URLSearchParams(`search=${encodeURIComponent(`  ${"x".repeat(200)}  `)}`);
  assert.equal(queryText(params, "search", 20), "x".repeat(20));
});
