import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveGenerationModels,
  resolveSuggestionModel,
} from "../../src/generation/modelConfig.js";

describe("generation model config", () => {
  it("resolves structure and placement models from stage-specific env vars", () => {
    assert.deepEqual(
      resolveGenerationModels({
        GEMINI_STRUCTURE_MODEL: "env-structure-model",
        GEMINI_PLACEMENT_MODEL: "env-placement-model",
      }),
      {
        structureModel: "env-structure-model",
        placementModel: "env-placement-model",
        repairModel: "env-placement-model",
      },
    );
  });

  it("uses GEMINI_MODEL as a shared env override for generation stages", () => {
    assert.deepEqual(
      resolveGenerationModels({
        GEMINI_MODEL: "env-shared-model",
        GEMINI_STRUCTURE_MODEL: "env-structure-model",
        GEMINI_PLACEMENT_MODEL: "env-placement-model",
      }),
      {
        structureModel: "env-shared-model",
        placementModel: "env-shared-model",
        repairModel: "env-shared-model",
      },
    );
  });

  it("uses GEMINI_REPAIR_MODEL for repair stages when configured", () => {
    assert.deepEqual(
      resolveGenerationModels({
        GEMINI_STRUCTURE_MODEL: "env-structure-model",
        GEMINI_PLACEMENT_MODEL: "env-placement-model",
        GEMINI_REPAIR_MODEL: "env-repair-model",
      }),
      {
        structureModel: "env-structure-model",
        placementModel: "env-placement-model",
        repairModel: "env-repair-model",
      },
    );
  });

  it("rejects missing model env configuration", () => {
    assert.throws(
      () => resolveGenerationModels({ GEMINI_API_KEY: "test-key" }),
      /GEMINI_MODEL or both GEMINI_STRUCTURE_MODEL and GEMINI_PLACEMENT_MODEL/,
    );
  });

  it("uses GEMINI stage models for generation stages in Backboard provider mode", () => {
    assert.deepEqual(
      resolveGenerationModels({
        GENERATION_PROVIDER: "backboard",
        GEMINI_STRUCTURE_MODEL: "gemini-3.1-flash-lite",
        GEMINI_PLACEMENT_MODEL: "gemini-3.5-flash",
        GEMINI_REPAIR_MODEL: "gemini-3.5-flash",
      }),
      {
        structureModel: "gemini-3.1-flash-lite",
        placementModel: "gemini-3.5-flash",
        repairModel: "gemini-3.5-flash",
      },
    );
  });

  it("ignores stale Backboard model variables in Backboard provider mode", () => {
    assert.deepEqual(
      resolveGenerationModels({
        GENERATION_PROVIDER: "backboard",
        GEMINI_STRUCTURE_MODEL: "gemini-3.1-flash-lite",
        GEMINI_PLACEMENT_MODEL: "gemini-3.5-flash",
        GEMINI_REPAIR_MODEL: "gemini-3.5-flash",
        BACKBOARD_MODEL: "claude-haiku-4-5-20251001",
        BACKBOARD_STRUCTURE_MODEL: "claude-haiku-4-5-20251001",
        BACKBOARD_PLACEMENT_MODEL: "claude-haiku-4-5-20251001",
        BACKBOARD_REPAIR_MODEL: "claude-haiku-4-5-20251001",
      }),
      {
        structureModel: "gemini-3.1-flash-lite",
        placementModel: "gemini-3.5-flash",
        repairModel: "gemini-3.5-flash",
      },
    );
  });

  it("uses GEMINI suggestion model in Backboard provider mode", () => {
    assert.equal(
      resolveSuggestionModel({
        GENERATION_PROVIDER: "backboard",
        GEMINI_SUGGESTION_MODEL: "gemini-3.1-flash-lite",
        BACKBOARD_MODEL: "claude-haiku-4-5-20251001",
        BACKBOARD_SUGGESTION_MODEL: "claude-haiku-4-5-20251001",
      }),
      "gemini-3.1-flash-lite",
    );
  });
});
