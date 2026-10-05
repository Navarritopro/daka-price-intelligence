import assert from "node:assert/strict";
import { classifyOpportunity, isFreshCapture, priorityForScore } from "../lib/opportunity-rules.ts";

const base = {
  dakaPrice: 105,
  competitorPrice: 100,
  competitorPreviousPrice: 100,
  dakaInStock: true,
  competitorInStock: true,
  fresh: true,
  sourceName: "Competidor",
  minimumGap: 5
};

assert.equal(classifyOpportunity(base)?.type, "price_risk", "5% superior debe ser riesgo de precio");
assert.equal(classifyOpportunity({ ...base, dakaPrice: 94 })?.type, "price_advantage", "DAKA 6% inferior debe ser ventaja");
assert.equal(classifyOpportunity({ ...base, dakaPrice: 104.99 }), null, "Una brecha menor al umbral no debe crear señal");
assert.equal(classifyOpportunity({ ...base, dakaInStock: false })?.type, "availability_risk", "DAKA sin stock debe ser riesgo");
assert.equal(classifyOpportunity({ ...base, competitorInStock: false })?.type, "availability_advantage", "Competidor sin stock debe ser ventaja");
assert.equal(classifyOpportunity({ ...base, dakaInStock: null }), null, "Disponibilidad desconocida no debe asumirse disponible");
assert.equal(classifyOpportunity({ ...base, fresh: false })?.type, "stale_data", "Captura vencida debe ser informativa");
assert.equal(classifyOpportunity({ ...base, competitorPreviousPrice: 110 })?.recentCompetitorDrop, true, "Debe reconocer la rebaja reciente");
assert.equal(priorityForScore(90), "critical");
assert.equal(priorityForScore(70), "high");
assert.equal(priorityForScore(50), "medium");
assert.equal(priorityForScore(20), "informative");

const now = Date.parse("2026-10-05T02:00:00Z");
assert.equal(isFreshCapture("2026-10-03T02:00:00Z", now), true, "48 horas exactas siguen vigentes");
assert.equal(isFreshCapture("2026-10-03T01:59:59Z", now), false, "Más de 48 horas debe marcarse vencido");

console.log("PASS  Reglas del Centro de Oportunidades (14 verificaciones)");
