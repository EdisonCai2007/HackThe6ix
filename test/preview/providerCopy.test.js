import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("generation status names Backboard instead of Gemini", async () => {
  const previewSource = await readFile(
    new URL("../../src/preview/main.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(previewSource, /Calling Gemini/);
  assert.match(previewSource, /Calling Backboard/);
});
