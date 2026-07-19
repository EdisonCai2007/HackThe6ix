import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generation status remains provider-neutral and includes hybrid stages", async () => {
  const previewSource = await readFile(
    new URL("../../src/preview/main.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(previewSource, /Calling Gemini/);
  assert.doesNotMatch(previewSource, /Calling Backboard/);
  assert.match(previewSource, /Generating model/);
  assert.match(previewSource, /geometry_generate/);
  assert.match(previewSource, /inventory_compile/);
  assert.match(previewSource, /candidate_select/);
  assert.match(previewSource, /fixedDemoInventory/);
  assert.match(previewSource, /inventorySelect\.value = "fixed-demo"/);
});
