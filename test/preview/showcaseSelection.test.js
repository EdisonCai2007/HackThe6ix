import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createShowcaseSelection } from "../../src/preview/showcaseSelection.js";

describe("showcase suggestion selection", () => {
  it("adds a selected showcase id to the next generation payload", () => {
    const selection = createShowcaseSelection();
    selection.selectSuggestion({ showcase_id: "scarlet-steam-locomotive" });

    assert.deepEqual(
      selection.extendGenerationPayload({ userPrompt: "build it" }),
      {
        userPrompt: "build it",
        showcase_id: "scarlet-steam-locomotive",
      },
    );
  });

  it("clears the selected id after manual prompt editing", () => {
    const selection = createShowcaseSelection();
    selection.selectSuggestion({ showcase_id: "midnight-grand-piano" });
    selection.clear();

    assert.deepEqual(
      selection.extendGenerationPayload({ userPrompt: "something else" }),
      { userPrompt: "something else" },
    );
  });

  it("preserves old suggestion behavior when no valid id is present", () => {
    const selection = createShowcaseSelection();
    selection.selectSuggestion({ label: "Ordinary provider suggestion" });

    assert.deepEqual(
      selection.extendGenerationPayload({ userPrompt: "ordinary prompt" }),
      { userPrompt: "ordinary prompt" },
    );

    selection.selectSuggestion({ showcase_id: "   " });
    assert.deepEqual(
      selection.extendGenerationPayload({ userPrompt: "still ordinary" }),
      { userPrompt: "still ordinary" },
    );
  });
});
