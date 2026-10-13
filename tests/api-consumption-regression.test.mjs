import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("los componentes no consumen JSON directamente sin la capa segura", async () => {
  const componentNames = (await readdir(new URL("../components/", import.meta.url)))
    .filter((name) => name.endsWith(".tsx"));
  const violations = [];

  for (const name of componentNames) {
    const source = await readFile(new URL(`../components/${name}`, import.meta.url), "utf8");
    if (/response\.json\s*\(/.test(source)) violations.push(name);
  }

  assert.deepEqual(
    violations,
    [],
    `Estos componentes volvieron a usar response.json() directamente: ${violations.join(", ")}`
  );
});
