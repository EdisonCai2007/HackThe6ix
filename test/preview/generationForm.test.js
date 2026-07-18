import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generation form does not expose a target pieces input", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");

  assert.doesNotMatch(html, /Target pieces/);
  assert.doesNotMatch(html, /target-pieces/);
});
