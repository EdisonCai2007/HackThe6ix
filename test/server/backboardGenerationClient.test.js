import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createBackboardGenerationClient } from "../../server/backboardGenerationClient.js";

function backboardRequest() {
  return {
    model: "gemini-3.5-flash",
    systemInstruction: {
      parts: [{ text: "Return JSON only." }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify({
              user_prompt: "build a duck",
              inventory: {
                inventory_id: "duck-demo",
                items: [{ part_id: "3005", color_id: "14", count: 2 }],
              },
            }),
          },
        ],
      },
    ],
    generationConfig: {
      responseSchema: {
        type: "object",
        properties: {
          model_name: { type: "string" },
        },
        required: ["model_name"],
      },
    },
  };
}

describe("Backboard generation client", () => {
  it("sends the full inventory and returns the completed message content", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), headers: options.headers });

      if (url.endsWith("/threads/messages")) {
        assert.equal(options.headers["X-API-Key"], "test-key");
        return {
          ok: true,
          async json() {
            return {
              status: "COMPLETED",
              content: "{\"ok\":true}",
              thread_id: "thread-1",
              total_tokens: 123,
            };
          },
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl,
    });

    const result = await client.completeWithMetadata(backboardRequest());

    assert.equal(result.text, "{\"ok\":true}");
    assert.equal(result.metadata.finishReason, "COMPLETED");
    assert.equal(result.metadata.usageMetadata.totalTokenCount, 123);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.content.includes("duck-demo"), true);
    assert.equal(calls[0].body.content.includes("generationConfig.responseSchema"), true);
    assert.equal(calls[0].body.content.includes("model_name"), true);
    assert.equal(calls[0].body.content.includes("\"items\""), true);
    assert.equal(calls[0].body.content.includes("\"count\""), true);
    assert.equal(Object.hasOwn(calls[0].body, "tools"), false);
  });

  it("throws a clear error when Backboard requests tool action", async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          status: "REQUIRES_ACTION",
          thread_id: "thread-1",
          tool_calls: [],
        };
      },
    });
    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl,
    });

    await assert.rejects(
      () => client.completeWithMetadata(backboardRequest()),
      /Backboard generation ended with status REQUIRES_ACTION/,
    );
  });

  it("includes Backboard failure content when a run fails", async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          status: "FAILED",
          content: "You're out of credits. Please upgrade your plan to continue.",
        };
      },
    });
    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl,
    });

    await assert.rejects(
      () => client.completeWithMetadata(backboardRequest()),
      /Backboard generation ended with status FAILED: You're out of credits/,
    );
  });
});
