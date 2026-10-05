import assert from "node:assert/strict";
import test from "node:test";
import { parseMatchManagementCommand } from "../lib/match-management.ts";

const base = {
  action: "deactivate",
  matchId: 10,
  reason: "wrong_model",
  expectedUpdatedAt: "2026-10-05T16:00:00.000Z"
};

test("acepta una desactivación válida", () => {
  assert.deepEqual(parseMatchManagementCommand(base), { ...base, replacementProductId: null, notes: null });
});

test("acepta una sustitución con producto competidor", () => {
  const result = parseMatchManagementCommand({ ...base, action: "replace", replacementProductId: 33, notes: "  Revisión comercial  " });
  assert.equal(result?.replacementProductId, 33);
  assert.equal(result?.notes, "Revisión comercial");
});

test("rechaza sustitución sin producto nuevo", () => {
  assert.equal(parseMatchManagementCommand({ ...base, action: "replace" }), null);
});

test("rechaza motivos no aprobados", () => {
  assert.equal(parseMatchManagementCommand({ ...base, reason: "inventado" }), null);
});

test("rechaza fechas de concurrencia inválidas", () => {
  assert.equal(parseMatchManagementCommand({ ...base, expectedUpdatedAt: "ayer" }), null);
});

test("rechaza producto sustituto en una desactivación", () => {
  assert.equal(parseMatchManagementCommand({ ...base, replacementProductId: 44 }), null);
});

test("acepta una restauración con motivo de auditoría", () => {
  const result = parseMatchManagementCommand({ ...base, action: "restore", reason: "restore_previous" });
  assert.equal(result?.action, "restore");
  assert.equal(result?.reason, "restore_previous");
});
