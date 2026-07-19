import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createGenerationServer } from "../../server/generationServer.js";
import { fixedDemoInventory } from "../../src/generation/fixtures/fixedDemoInventory.js";
import { randomBuildInventory } from "../../src/generation/fixtures/randomBuildInventory.js";

describe("generation server showcase suggestion route", () => {
  let server;
  let endpoint;
  let originalGeminiApiKey;
  let originalGenerationProvider;

  before(async () => {
    originalGeminiApiKey = process.env.GEMINI_API_KEY;
    originalGenerationProvider = process.env.GENERATION_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GENERATION_PROVIDER;

    server = createGenerationServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const { port } = server.address();
    endpoint = `http://127.0.0.1:${port}/api/suggest-builds`;
  });

  after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });

    if (originalGeminiApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGeminiApiKey;

    if (originalGenerationProvider === undefined) delete process.env.GENERATION_PROVIDER;
    else process.env.GENERATION_PROVIDER = originalGenerationProvider;
  });

  async function requestSuggestions(inventory) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventory }),
    });

    assert.equal(response.status, 200);
    return response.json();
  }

  it("returns all credential-free showcases for the compatible fixed inventory", async () => {
    const result = await requestSuggestions(fixedDemoInventory);

    assert.deepEqual(
      result.suggestions.map(({ showcase_id }) => showcase_id),
      [
        "scarlet-steam-locomotive",
        "midnight-grand-piano",
        "coastal-beacon-lighthouse",
        "red-rescue-fire-engine",
      ],
    );
  });

  it("does not advertise fixed-inventory showcases for the random inventory", async () => {
    const result = await requestSuggestions(randomBuildInventory);

    assert.deepEqual(result, { ok: true, suggestions: [] });
  });
});
