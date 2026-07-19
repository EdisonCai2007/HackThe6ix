import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { promptTextForBuildSuggestion } from "../../src/preview/buildSuggestionPrompt.js";

describe("build suggestion prompt text", () => {
  it("appends inventory reasoning to selected suggestion prompts", () => {
    const promptText = promptTextForBuildSuggestion({
      label: "Mailbox",
      prompt_metadata: "Build a bulky mailbox with a raised flag.",
      inventory_reasoning: "Tall bricks support the post and plates can form the box.",
    });

    assert.equal(
      promptText,
      "Mailbox. Build a bulky mailbox with a raised flag. Inventory fit: Tall bricks support the post and plates can form the box.",
    );
  });

  it("preserves the suggestion label when metadata uses a generic description", () => {
    const promptText = promptTextForBuildSuggestion({
      label: "Piano",
      prompt_metadata: "Compact musical instrument with a rectangular main body and a flat keyboard section.",
      inventory_reasoning: "The mix of bricks supports a dense housing and plates support the key-bed.",
    });

    assert.equal(
      promptText,
      "Piano. Compact musical instrument with a rectangular main body and a flat keyboard section. Inventory fit: The mix of bricks supports a dense housing and plates support the key-bed.",
    );
  });

  it("keeps suggestion prompts usable when reasoning is absent", () => {
    assert.equal(
      promptTextForBuildSuggestion({
        label: "Bench",
        prompt_metadata: "Build a flat bench with legs and a backrest.",
      }),
      "Bench. Build a flat bench with legs and a backrest.",
    );
  });
});
