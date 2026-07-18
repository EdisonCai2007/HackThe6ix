import assert from "node:assert/strict";
import test from "node:test";

import { nextToolAfterSelectionChange } from "../../src/preview/editorToolState.js";

test("move tool remains active after selection is cleared", () => {
  assert.equal(nextToolAfterSelectionChange("axis", null), "axis");
});

test("unknown editor tool falls back to select after selection is cleared", () => {
  assert.equal(nextToolAfterSelectionChange("unknown", null), "hand");
});

