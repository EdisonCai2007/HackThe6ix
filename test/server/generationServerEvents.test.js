import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createGenerationClientForBody,
  formatSseEvent,
  generationCredentialError,
  resolveInventoryFromBody,
  shouldStoreGeminiLogs,
  validateRequestBody,
  validateSuggestionRequestBody,
} from "../../server/generationServer.js";

describe("generation server SSE events", () => {
  it("does not require Gemini or Backboard credentials in hybrid mode", () => {
    assert.equal(
      generationCredentialError({ GENERATION_MODE: "brickgpt_inventory" }),
      null,
    );
    assert.equal(
      generationCredentialError({}),
      "GEMINI_API_KEY is required.",
    );
  });

  it("does not require provider credentials for recognized showcase builds", () => {
    assert.equal(
      generationCredentialError({}, {
        showcase_id: "scarlet-steam-locomotive",
        userPrompt: "build it",
      }),
      null,
    );
    assert.equal(
      generationCredentialError({}, {
        userPrompt: "Please build the Midnight Grand Piano showcase",
      }),
      null,
    );
    assert.equal(
      generationCredentialError({}, {
        showcase_id: "not-a-showcase",
        userPrompt: "build it",
      }),
      "GEMINI_API_KEY is required.",
    );
  });

  it("formats named SSE events with a JSON payload", () => {
    const event = formatSseEvent("progress", {
      stage: "validation",
      status: "running",
    });

    assert.equal(
      event,
      'event: progress\ndata: {"stage":"validation","status":"running"}\n\n',
    );
  });

  it("formats draft SSE events with model payloads", () => {
    const event = formatSseEvent("draft", {
      type: "draft",
      stage: "placement_draft",
      model: { model_name: "Draft Duck" },
    });

    assert.equal(
      event,
      'event: draft\ndata: {"type":"draft","stage":"placement_draft","model":{"model_name":"Draft Duck"}}\n\n',
    );
  });

  it("enables Gemini API logging only with GEMINI_STORE_LOGS=true", () => {
    assert.equal(shouldStoreGeminiLogs({ GEMINI_STORE_LOGS: "true" }), true);
    assert.equal(shouldStoreGeminiLogs({ GEMINI_STORE_LOGS: "false" }), false);
    assert.equal(shouldStoreGeminiLogs({ GEMINI_STORE_LOGS: "1" }), false);
    assert.equal(shouldStoreGeminiLogs({}), false);
  });

  it("accepts generation requests with an inventory session id", () => {
    assert.deepEqual(
      validateRequestBody({
        userPrompt: "build a tank",
        inventory_id: "inv_test_123",
      }),
      [],
    );
  });

  it("accepts only nonempty string showcase ids", () => {
    assert.deepEqual(
      validateRequestBody({
        userPrompt: "build it",
        inventory_id: "inv_test_123",
        showcase_id: "midnight-grand-piano",
      }),
      [],
    );
    assert.deepEqual(
      validateRequestBody({
        userPrompt: "build it",
        inventory_id: "inv_test_123",
        showcase_id: "",
      }),
      ["showcase_id must be a non-empty string."],
    );
    assert.deepEqual(
      validateRequestBody({
        userPrompt: "build it",
        inventory_id: "inv_test_123",
        showcase_id: 42,
      }),
      ["showcase_id must be a non-empty string."],
    );
  });

  it("requires either inventory or inventory_id for generation requests", () => {
    assert.deepEqual(
      validateRequestBody({ userPrompt: "build a tank" }),
      ["inventory or inventory_id is required."],
    );
  });

  it("accepts suggestion requests with an inventory session id", () => {
    assert.deepEqual(
      validateSuggestionRequestBody({ inventory_id: "inv_test_123" }),
      [],
    );
  });

  it("loads inventory by id before generation", async () => {
    const inventory = {
      inventory_id: "loaded",
      source: "manual_test_fixture",
      items: [],
    };
    const store = {
      async load(inventoryId) {
        assert.equal(inventoryId, "inv_test_123");
        return inventory;
      },
    };

    assert.equal(
      await resolveInventoryFromBody({ inventory_id: "inv_test_123" }, store),
      inventory,
    );
  });

  it("creates a Backboard generation client when GENERATION_PROVIDER=backboard", () => {
    const client = createGenerationClientForBody({
      body: { inventory_id: "inv_test_123" },
      env: {
        GENERATION_PROVIDER: "backboard",
        BACKBOARD_API_KEY: "test-key",
        BACKBOARD_LLM_PROVIDER: "google",
        BACKBOARD_MODEL: "gemini-3.5-flash",
      },
      logger: { logAiRequest() {}, logAiResponse() {}, logAiError() {} },
    });

    assert.equal(typeof client.complete, "function");
  });
});
