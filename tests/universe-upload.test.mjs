import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createHash, randomUUID } from "node:crypto";

function load(path, dependencies = {}, extra = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, require: name => {
    if (!(name in dependencies)) throw Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Buffer, Request, Response, Uint8Array, crypto: { randomUUID }, console: { error() {} }, ...extra });
  return exports;
}
const limits = load("../lib/universe-upload-limits.ts");
const api = { async readApiJson(response) { const p = await response.json(); if (!response.ok) throw Error(p.error); return p; } };
const digest = data => createHash("sha256").update(data).digest("hex");

test("acepta exactamente 5 MiB y rechaza vacío y un byte adicional", () => {
  for (const size of [1, 4_000_001, 5_000_000, 5_242_880]) limits.validateUniverseFileSize(size);
  for (const size of [0, -1, 5_242_881, NaN, 1.5]) assert.throws(() => limits.validateUniverseFileSize(size));
});
test("lectura acotada rechaza cuerpos demasiado grandes aun sin content-length", async () => {
  const request = new Request("http://local", { method: "POST", body: new Uint8Array(101) });
  await assert.rejects(limits.readBoundedBody(request, 100));
  assert.equal((await limits.readBoundedBody(new Request("http://local", { method: "POST", body: new Uint8Array(100) }), 100)).length, 100);
});
test("partes inválidas, incompletas o fuera de límites se rechazan", () => {
  limits.validateUploadPart(0, 5_242_880, 1_048_576);
  limits.validateUploadPart(4_194_304, 5_000_000, 805_696);
  for (const args of [[1, 5_000_000, 1_048_576], [0, 5_000_000, 1], [5_242_880, 5_242_880, 0], [0, 5_242_881, 1_048_576]]) assert.throws(() => limits.validateUploadPart(...args));
});

function stageEnvironment() {
  const rows = new Map();
  let user = { id: "admin-a", role: "admin" };
  const sql = async (strings, ...values) => {
    const q = strings.join("?");
    if (q.includes("CREATE TABLE") || q.includes("pg_advisory") || q.includes("expires_at < NOW")) return [];
    if (q.includes("COUNT(*)")) return [{ n: [...rows.values()].filter(r => r.owner === values[0]).length }];
    if (q.includes("INSERT INTO")) { const [id, owner, total, data] = values; rows.set(id, { owner, total, data: Buffer.from(data) }); return []; }
    if (q.includes("UPDATE")) {
      const [part, id, owner, total, offset] = values; const r = rows.get(id);
      if (!r || r.owner !== owner || r.total !== total || r.data.length !== offset) return [];
      r.data = Buffer.concat([r.data, part]); return [{ received: r.data.length }];
    }
    if (q.includes("DELETE")) {
      const [id, owner] = values; const row = rows.get(id);
      if (!row || row.owner !== owner || (q.includes("RETURNING data") && row.data.length !== row.total)) return [];
      rows.delete(id); return q.includes("RETURNING data") ? [{ data: row.data }] : [];
    }
    throw Error(q);
  };
  sql.begin = async fn => fn(sql);
  const route = load("../app/api/daka-universe/import/upload/route.ts", {
    "next/server": { NextResponse: Response }, "@/lib/auth": { getRequestUser: async () => user },
    "@/lib/db": { getSql: () => sql }, "@/lib/universe-upload-limits": limits
  });
  const fetch = async (_url, init) => route[init.method](new Request("http://local/upload", init));
  return { rows, fetch, sql, setUser: u => { user = u; } };
}

test("carga real de bytes 5 MiB atravesando cliente y handler conserva SHA-256 y peticiones de 1 MiB", async () => {
  const env = stageEnvironment(); const sizes = [];
  const client = load("../lib/universe-upload-client.ts", { "./api-client": api, "./universe-upload-limits": limits }, {
    fetch: async (url, init) => { sizes.push(init.body.size); return env.fetch(url, init); }
  });
  const bytes = Buffer.alloc(5_242_880); for (let n = 0; n < bytes.length; n++) bytes[n] = n % 251;
  const file = new File([bytes], "inventario.xlsx");
  const result = await client.prepareUniverseUpload(file, { "x-import-kind": "inventory" });
  assert.equal(result.body, null);
  assert.equal(sizes.length, 5); assert.ok(sizes.every(n => n <= 1_048_576));
  assert.equal(digest(env.rows.get(result.headers["x-upload-id"]).data), digest(bytes));
  assert.equal(result.headers["x-import-kind"], "inventory");
});
test("archivo pequeño conserva envío directo; archivo excedido no genera peticiones", async () => {
  const client = load("../lib/universe-upload-client.ts", { "./api-client": api, "./universe-upload-limits": limits }, { fetch() { throw Error("No debe consultar"); } });
  const file = new File([new Uint8Array(4_000_000)], "test.xlsx");
  assert.equal((await client.prepareUniverseUpload(file, {})).body, file);
  await assert.rejects(client.prepareUniverseUpload(new File([new Uint8Array(5_242_881)], "test.xlsx"), {}));
});
test("servidor impide duplicar partes, cambiar propietario y cargar con rol consulta", async () => {
  const env = stageEnvironment(); const id = randomUUID();
  const send = (offset) => env.fetch("", { method: "POST", body: new Uint8Array(1_048_576), headers: { "x-upload-id": id, "x-upload-offset": String(offset), "x-upload-total": "5242880" } });
  assert.equal((await send(0)).status, 200);
  assert.equal((await send(2_097_152)).status, 400);
  env.setUser({ id: "admin-b", role: "admin" }); assert.equal((await send(1_048_576)).status, 400);
  env.setUser({ id: "admin-a", role: "viewer" }); assert.equal((await send(1_048_576)).status, 403);
  env.setUser({ id: "admin-a", role: "admin" }); assert.equal((await send(1_048_576)).status, 200);
  assert.equal((await send(1_048_576)).status, 400);
});
test("fallo de red cancela carga y pide limpiar partes temporales", async () => {
  const calls = [];
  const client = load("../lib/universe-upload-client.ts", { "./api-client": api, "./universe-upload-limits": limits }, { fetch: async (_, init) => {
    calls.push(init.method); if (init.method === "POST") throw Error("Sin conexión"); return Response.json({ deleted: true });
  } });
  await assert.rejects(client.prepareUniverseUpload(new File([new Uint8Array(5_000_000)], "test.xlsx"), {}), /Sin conexión/);
  assert.deepEqual(calls, ["POST", "DELETE"]);
});


test("importación consume solo una carga completa del propietario y entrega los bytes intactos al parser", async () => {
  const env = stageEnvironment(); const id = randomUUID(); const data = Buffer.alloc(5_242_880, 7);
  env.rows.set(id, { owner: "admin-a", total: data.length, data });
  const route = load("../app/api/daka-universe/import/route.ts", {
    crypto: { createHash, randomUUID }, "next/server": { NextResponse: Response },
    "@/lib/auth": { getRequestUser: async () => ({ id: "admin-a", role: "admin" }) },
    "@/lib/db": { getSql: () => env.sql }, "@/lib/universe-upload-limits": limits,
    "@/lib/daka-universe": { parseInventoryWorkbook: async buffer => {
      assert.equal(digest(buffer), digest(data)); return [{ sku: "123" }];
    }, previewInventory: rows => ({ uniqueSkus: rows.length }) }
  });
  const request = () => new Request("http://local/import", { method: "POST", headers: {
    "x-upload-id": id, "x-file-name": "inventario.xlsx", "x-import-kind": "inventory", "x-import-mode": "preview"
  } });
  env.rows.get(id).owner = "other"; assert.equal((await route.POST(request())).status, 400);
  env.rows.get(id).owner = "admin-a"; env.rows.get(id).total++; assert.equal((await route.POST(request())).status, 400);
  env.rows.get(id).total--; const response = await route.POST(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).preview.uniqueSkus, 1);
  assert.equal(env.rows.size, 0); assert.equal((await route.POST(request())).status, 400);
});
