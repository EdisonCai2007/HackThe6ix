import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";
import {
  findShowcaseBuild,
  generateShowcaseBuild,
  isShowcaseBuildRequest,
  listShowcaseBuildSuggestions,
  SHOWCASE_BUILDS,
} from "../../src/generation/showcaseBuilds.js";

describe("showcase build registry", () => {
  it("exports four immutable descriptors through stable ids", () => {
    assert.deepEqual(
      SHOWCASE_BUILDS.map(({ id }) => id),
      [
        "scarlet-steam-locomotive",
        "midnight-grand-piano",
        "coastal-beacon-lighthouse",
        "red-rescue-fire-engine",
      ],
    );
    assert.equal(Object.isFrozen(SHOWCASE_BUILDS), true);
    assert.equal(SHOWCASE_BUILDS.every(Object.isFrozen), true);
  });

  it("returns suggestion-compatible copies carrying stable showcase ids", () => {
    const suggestions = listShowcaseBuildSuggestions();

    assert.deepEqual(suggestions.map(({ showcase_id }) => showcase_id), [
      "scarlet-steam-locomotive",
      "midnight-grand-piano",
      "coastal-beacon-lighthouse",
      "red-rescue-fire-engine",
    ]);
    for (const suggestion of suggestions) {
      assert.equal(typeof suggestion.label, "string");
      assert.equal(typeof suggestion.prompt_metadata, "string");
      assert.deepEqual(Object.keys(suggestion).sort(), [
        "label",
        "prompt_metadata",
        "showcase_id",
      ]);
    }

    suggestions[0].label = "Changed locally";
    assert.equal(SHOWCASE_BUILDS[0].label, "Scarlet Steam Locomotive");
  });

  it("only suggests showcases that the requested inventory can build", () => {
    assert.deepEqual(
      listShowcaseBuildSuggestions(fixedDemoInventory).map(({ showcase_id }) => showcase_id),
      [
        "scarlet-steam-locomotive",
        "midnight-grand-piano",
        "coastal-beacon-lighthouse",
        "red-rescue-fire-engine",
      ],
    );
    assert.deepEqual(listShowcaseBuildSuggestions(randomBuildInventory), []);
  });

  it("resolves exact ids and normalized legacy suggestion prompts", () => {
    assert.equal(
      findShowcaseBuild({ showcaseId: "scarlet-steam-locomotive" })?.id,
      "scarlet-steam-locomotive",
    );
    assert.equal(
      findShowcaseBuild({ userPrompt: "Please BUILD the Midnight Grand-Piano showcase!" })?.id,
      "midnight-grand-piano",
    );
    assert.equal(
      findShowcaseBuild({ userPrompt: "Please build the Coastal Beacon Lighthouse showcase" })?.id,
      "coastal-beacon-lighthouse",
    );
    assert.equal(
      findShowcaseBuild({ userPrompt: "Build the Red Rescue Fire Engine showcase" })?.id,
      "red-rescue-fire-engine",
    );
    assert.equal(findShowcaseBuild({ userPrompt: "build a normal piano" }), undefined);
    assert.equal(
      findShowcaseBuild({
        showcaseId: "unknown-showcase",
        userPrompt: "scarlet steam locomotive",
      }),
      undefined,
    );
  });

  it("recognizes only resolvable showcase requests", () => {
    assert.equal(isShowcaseBuildRequest({ showcase_id: "midnight-grand-piano" }), true);
    assert.equal(isShowcaseBuildRequest({ userPrompt: "scarlet steam locomotive" }), true);
    assert.equal(isShowcaseBuildRequest({ userPrompt: "build a castle" }), false);
    assert.equal(isShowcaseBuildRequest({ showcase_id: "not-real" }), false);
  });

  it("builds, validates, and replays every brick in deterministic step order", async () => {
    const events = [];
    const result = await generateShowcaseBuild({
      showcaseId: "scarlet-steam-locomotive",
      userPrompt: "ignored after exact id",
      inventory: fixedDemoInventory,
      delayMs: 0,
      onProgress: async (event) => events.push(event),
    });

    assert.equal(result.ok, true);
    assert.equal(result.complete, true);
    assert.equal(result.requiresRefinement, false);
    assert.equal(result.validation.valid, true);

    const streamed = events
      .filter(({ type }) => type === "brick")
      .map(({ brick }) => brick);
    const expected = result.model.bricks
      .map((brick, index) => ({ brick, index }))
      .sort((left, right) => left.brick.step - right.brick.step || left.index - right.index)
      .map(({ brick }) => brick);

    assert.equal(streamed.length, result.model.piece_count);
    assert.deepEqual(streamed, expected);
    assert.equal(new Set(streamed.map(({ id }) => id)).size, streamed.length);
    assert.deepEqual(
      events.filter(({ type }) => type === "stage").map(({ stage, status }) => [stage, status]),
      [
        ["structure_generate", "running"],
        ["structure_generate", "complete"],
        ["placement_generate", "running"],
        ["placement_generate", "complete"],
        ["validation", "running"],
        ["validation", "complete"],
      ],
    );
  });
});
