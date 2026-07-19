import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { usableBuildSuggestions } from "../../src/preview/buildSuggestions.js";

describe("build suggestions", () => {
  it("keeps every valid inventory-safe showcase suggestion", () => {
    const suggestions = Array.from({ length: 7 }, (_, index) => ({
      label: `Showcase ${index + 1}`,
      prompt_metadata: `Build showcase ${index + 1}.`,
    }));

    assert.deepEqual(usableBuildSuggestions(suggestions), suggestions);
  });
});
