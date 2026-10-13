import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, apiRequest, isAbortError, readApiJson } from "../lib/api-client.ts";

test("lee una respuesta JSON válida", async () => {
  const payload = await readApiJson(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
  assert.deepEqual(payload, { status: "ok" });
});

test("convierte una respuesta vacía en un error comprensible", async () => {
  await assert.rejects(
    () => readApiJson(new Response("", { status: 200 })),
    (error) => error instanceof ApiRequestError && /respuesta vacía/.test(error.message)
  );
});

test("no expone el error nativo de JSON cuando el cuerpo es inválido", async () => {
  await assert.rejects(
    () => readApiJson(new Response("<html>Error</html>", { status: 502 })),
    (error) => error instanceof ApiRequestError && !/Unexpected end|JSON/.test(error.message) && error.retryable
  );
});

test("conserva el mensaje funcional enviado por la API", async () => {
  await assert.rejects(
    () => readApiJson(new Response(JSON.stringify({ error: "El archivo contiene SKU duplicados", code: "duplicate_sku" }), { status: 400 })),
    (error) => error instanceof ApiRequestError
      && error.message === "El archivo contiene SKU duplicados"
      && error.code === "duplicate_sku"
  );
});

test("traduce estados de autenticación sin cuerpo", async () => {
  await assert.rejects(
    () => readApiJson(new Response("", { status: 401 })),
    (error) => error instanceof ApiRequestError && /sesión venció/.test(error.message)
  );
});

test("reintenta GET ante fallos transitorios", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: "Temporal" }), { status: 503 });
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  };
  const payload = await apiRequest("https://example.test/api", {}, { retries: 1, retryDelayMs: 0, fetcher });
  assert.deepEqual(payload, { status: "ok" });
  assert.equal(calls, 2);
});

test("nunca reintenta solicitudes POST", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: "Temporal" }), { status: 503 });
  };
  await assert.rejects(() => apiRequest("https://example.test/api", { method: "POST" }, { retries: 2, retryDelayMs: 0, fetcher }));
  assert.equal(calls, 1);
});

test("reconoce cancelaciones", () => {
  assert.equal(isAbortError(new DOMException("Cancelado", "AbortError")), true);
  assert.equal(isAbortError(new Error("Otro error")), false);
});
