import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentFiles = [
  "availability-history.tsx",
  "catalog-changes.tsx",
  "commercial-opportunities.tsx",
  "daka-product-universe.tsx",
  "daka-universe-homologations.tsx",
  "match-management.tsx"
];

test("todos los paneles críticos usan el mismo control accesible", async () => {
  for (const filename of componentFiles) {
    const source = await readFile(new URL(`../components/${filename}`, import.meta.url), "utf8");
    assert.match(source, /useAccessibleDialog\(/, `${filename} no usa el control compartido`);
    assert.match(source, /role="dialog"/, `${filename} perdió el rol de diálogo`);
    assert.match(source, /aria-modal="true"/, `${filename} perdió aria-modal`);
  }
});

test("la navegación principal conserva estado en URL y responde a Atrás", async () => {
  const source = await readFile(new URL("../components/dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /window\.history\.pushState/);
  assert.match(source, /window\.history\.replaceState/);
  assert.match(source, /addEventListener\("popstate"/);
  assert.match(source, /productStatus/);
  assert.match(source, /changeStatus/);
});

test("el catálogo competidor conserva fuente, vista, filtros y producto", async () => {
  const source = await readFile(new URL("../components/damasco-catalog.tsx", import.meta.url), "utf8");
  for (const parameter of ["competitor", "competitorTab", "competitorHistory", "competitorSearch", "competitorDays", "competitorProduct"]) {
    assert.ok(source.includes(parameter), `Falta persistir ${parameter}`);
  }
  assert.match(source, /addEventListener\("popstate"/);
});

test("el control accesible gestiona Escape, foco atrapado y restauración", async () => {
  const source = await readFile(new URL("../hooks/use-accessible-dialog.ts", import.meta.url), "utf8");
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /returnTarget.*focus/);
});
