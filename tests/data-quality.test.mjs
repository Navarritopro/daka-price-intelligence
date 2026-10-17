import assert from "node:assert/strict";
import test from "node:test";
import { assessSourceQuality } from "../lib/data-quality.ts";

const now = Date.parse("2026-10-17T16:00:00Z");
const healthy = {
  latestSuccessAt: "2026-10-17T14:00:00Z",
  latestAttemptStatus: "success",
  latestAttemptAt: "2026-10-17T13:50:00Z",
  productsFound: 2500,
  productsSaved: 2495,
  productsWithoutSku: 5,
  currentProducts: 2495,
  previousProducts: 2450,
  productsWithPrice: 2400
};

test("una captura completa y reciente se clasifica como correcta", () => {
  const result = assessSourceQuality(healthy, now);
  assert.equal(result.level, "healthy");
  assert.equal(result.persistenceRate, 100);
  assert.equal(result.catalogChangePercent, 1.8);
  assert.equal(result.issues.length, 0);
});

test("la primera captura funciona como línea base sin falsa anomalía", () => {
  const result = assessSourceQuality({ ...healthy, previousProducts: null }, now);
  assert.equal(result.level, "healthy");
  assert.equal(result.catalogChangePercent, null);
});

test("una ejecución fallida posterior al último éxito es crítica", () => {
  const result = assessSourceQuality({
    ...healthy,
    latestAttemptStatus: "failed",
    latestAttemptAt: "2026-10-17T15:00:00Z"
  }, now);
  assert.equal(result.level, "critical");
  assert.ok(result.issues.some((issue) => issue.code === "LATEST_FAILED"));
});

test("los umbrales de antigüedad diferencian advertencia y estado crítico", () => {
  assert.equal(assessSourceQuality({ ...healthy, latestSuccessAt: "2026-10-16T08:00:00Z" }, now).level, "warning");
  assert.equal(assessSourceQuality({ ...healthy, latestSuccessAt: "2026-10-15T15:00:00Z" }, now).level, "critical");
});

test("una caída de catálogo del 15% advierte y del 30% bloquea", () => {
  const warning = assessSourceQuality({ ...healthy, currentProducts: 850, previousProducts: 1000, productsWithPrice: 850 }, now);
  const critical = assessSourceQuality({ ...healthy, currentProducts: 700, previousProducts: 1000, productsWithPrice: 700 }, now);
  assert.equal(warning.level, "warning");
  assert.ok(warning.issues.some((issue) => issue.code === "CATALOG_DROP"));
  assert.equal(critical.level, "critical");
});

test("la persistencia usa encontrados menos productos sin SKU", () => {
  const result = assessSourceQuality({ ...healthy, productsFound: 1000, productsWithoutSku: 100, productsSaved: 900 }, now);
  assert.equal(result.persistenceRate, 100);
  assert.equal(result.level, "healthy");
});

test("la clasificación funciona con un catálogo de alto volumen", () => {
  const result = assessSourceQuality({
    ...healthy,
    productsFound: 125000,
    productsWithoutSku: 50,
    productsSaved: 123000,
    currentProducts: 123000,
    previousProducts: 124000,
    productsWithPrice: 122500
  }, now);
  assert.equal(result.persistenceRate, 98.4);
  assert.equal(result.level, "warning");
  assert.ok(result.issues.some((issue) => issue.code === "PERSISTENCE"));
});

test("sin capturas exitosas el estado es pendiente o crítico según el último intento", () => {
  assert.equal(assessSourceQuality({ ...healthy, latestSuccessAt: null, latestAttemptStatus: null }, now).level, "pending");
  assert.equal(assessSourceQuality({ ...healthy, latestSuccessAt: null, latestAttemptStatus: "failed" }, now).level, "critical");
});

test("una captura exitosa vacía se considera crítica", () => {
  const result = assessSourceQuality({ ...healthy, productsFound: 0, productsSaved: 0, currentProducts: 0, productsWithPrice: 0 }, now);
  assert.equal(result.level, "critical");
  assert.ok(result.issues.some((issue) => issue.code === "EMPTY_CAPTURE"));
});
