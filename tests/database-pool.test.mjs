import assert from "node:assert/strict";
import test from "node:test";
import { databasePoolSize } from "../lib/db.ts";

test("Vercel usa una sola conexión por instancia", () => {
  assert.equal(databasePoolSize({ VERCEL: "1", DATABASE_POOL_SIZE: "5" }), 1);
});

test("entornos locales respetan un pool acotado", () => {
  assert.equal(databasePoolSize({ DATABASE_POOL_SIZE: "3" }), 3);
  assert.equal(databasePoolSize({ DATABASE_POOL_SIZE: "100" }), 10);
  assert.equal(databasePoolSize({ DATABASE_POOL_SIZE: "0" }), 1);
  assert.equal(databasePoolSize({ DATABASE_POOL_SIZE: "inválido" }), 2);
});
