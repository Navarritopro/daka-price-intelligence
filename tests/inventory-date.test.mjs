import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID, createHash } from "node:crypto";
import { inventoryPublicationDate } from "../lib/daka-universe.ts";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, { exports, require: name => {
    assert.ok(name in dependencies, `Dependencia inesperada: ${name}`);
    return dependencies[name];
  }, Buffer, console: { error() {} } });
  return exports;
}

test("la fecha de publicación respeta Caracas al cruzar medianoche UTC y cambiar de año", () => {
  for (const [instant, expected] of [
    ["2026-10-27T14:30:00Z", "2026-10-27"],
    ["2026-10-28T03:59:59Z", "2026-10-27"],
    ["2026-10-28T04:00:00Z", "2026-10-28"],
    ["2027-01-01T03:59:59Z", "2026-12-31"],
    ["2027-01-01T04:00:00Z", "2027-01-01"]
  ]) assert.equal(inventoryPublicationDate(new Date(instant)), expected);
});

test("el encabezado renderiza la fecha recibida del servidor sin desplazar el día", () => {
  for (const date of ["2026-10-27", "2026-10-28", null]) {
    let stateIndex = 0;
    const component = load("../components/daka-product-universe.tsx", {
      react: { ...React, useState: initial => {
        const index = stateIndex++;
        return React.useState(index === 0 ? "quality" : index === 2 ? { inventoryEffectiveDate: date } : index === 12 ? false : initial);
      } },
      "react/jsx-runtime": jsxRuntime,
      "@/components/daka-universe-homologations": { default: () => null },
      "@/components/product-360-view": { default: () => null },
      "@/lib/universe-upload-client": {}, "@/lib/api-client": {},
      "@/hooks/use-accessible-dialog": { useAccessibleDialog() {} },
      "@/lib/accessible-tabs": {}
    });
    const html = renderToStaticMarkup(React.createElement(component.default, { canAdmin: true }));
    if (date) assert.match(html, new RegExp(`${date.endsWith("27") ? "27" : "28"} de octubre de 2026`));
    else assert.ok(html.includes("Sin inventario publicado"));
    assert.ok(!html.includes("12 de octubre de 2026"));
    assert.ok(html.includes("Inventario · fecha de publicación"));
  }
});

test("publicar inventario guarda la misma fecha de Caracas en lote e instantánea", async () => {
  const writes = [];
  let dateCalls = 0;
  const sql = async (strings, ...values) => { writes.push({ query: strings.join("?"), values }); return []; };
  sql.begin = async fn => fn(sql);
  sql.json = value => value;
  const route = load("../app/api/daka-universe/import/route.ts", {
    crypto: { randomUUID, createHash },
    "next/server": { NextResponse: Response },
    "@/lib/auth": { getRequestUser: async () => ({ id: randomUUID(), email: "test@example.com", role: "admin" }) },
    "@/lib/db": { getSql: () => sql },
    "@/lib/universe-upload-limits": { MAX_UNIVERSE_FILE_BYTES: 5242880, readBoundedBody: async request => request.arrayBuffer(), validateUniverseFileSize() {} },
    "@/lib/daka-universe": {
      inventoryPublicationDate: () => { dateCalls++; return "2026-10-27"; },
      parseInventoryWorkbook: async () => [{ sku: "LB-1", quantity: 10, location: "CDD" }],
      previewInventory: () => ({ rowCount: 1, uniqueSkus: 1 })
    }
  });
  const response = await route.POST(new Request("https://local/import", { method: "POST", body: "fixture", headers: {
    "x-import-kind": "inventory", "x-import-mode": "publish", "x-file-name": "inventario.xlsx",
    "x-effective-date": "1999-01-01"
  } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).published, true);
  assert.equal(dateCalls, 1);
  const batch = writes.find(w => w.query.includes("INSERT INTO daka_import_batches"));
  const snapshot = writes.find(w => w.query.includes("INSERT INTO daka_inventory_snapshots"));
  assert.equal(batch.values[3], "2026-10-27");
  assert.equal(snapshot.values[1], "2026-10-27");
});

test("la fecha vigente se devuelve aunque los filtros no encuentren productos", async () => {
  for (const date of ["2026-10-27", null]) {
    const route = load("../app/api/daka-universe/route.ts", {
      "next/server": { NextResponse: Response },
      "@/lib/db": { asNumber: v => Number(v ?? 0), getSql: () => async strings => {
        const query = strings.join("?");
        if (query.includes("inventory_effective_date")) return [{ inventory_effective_date: date }];
        if (query.includes("ARRAY(")) return [{}];
        return [];
      } }
    });
    const response = await route.GET({ nextUrl: new URL("https://local/api/daka-universe?search=inexistente") });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.inventoryEffectiveDate, date);
    assert.deepEqual(payload.items, []);
  }
});
