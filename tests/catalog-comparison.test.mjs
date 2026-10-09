import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCatalogChangeState,
  normalizeCatalogSource,
  resolveCatalogComparisonPeriod
} from "../lib/catalog-comparison.ts";

const now = new Date("2026-10-09T16:00:00Z");

test("resuelve las últimas dos capturas como periodo predeterminado", () => {
  assert.deepEqual(resolveCatalogComparisonPeriod(new URLSearchParams(), now), {
    mode: "latest", startDate: null, endDate: null, label: "Últimas dos capturas completas"
  });
});

test("resuelve ayer contra hoy usando la fecha de Venezuela", () => {
  const period = resolveCatalogComparisonPeriod(new URLSearchParams({ period: "today" }), now);
  assert.equal(period.startDate, "2026-10-08");
  assert.equal(period.endDate, "2026-10-09");
});

test("valida las fechas personalizadas", () => {
  const valid = resolveCatalogComparisonPeriod(new URLSearchParams({
    period: "custom", startDate: "2026-09-01", endDate: "2026-10-09"
  }), now);
  assert.equal(valid.mode, "custom");
  assert.throws(() => resolveCatalogComparisonPeriod(new URLSearchParams({
    period: "custom", startDate: "2026-10-09", endDate: "2026-10-09"
  }), now), /anterior/);
});

test("rechaza filtros no reconocidos sin ampliar el alcance", () => {
  assert.equal(normalizeCatalogSource("desconocido"), "all");
  assert.equal(normalizeCatalogSource("damasco"), "damasco");
  assert.equal(normalizeCatalogChangeState("confirmed"), "confirmed");
  assert.equal(normalizeCatalogChangeState("otro"), "all");
});
