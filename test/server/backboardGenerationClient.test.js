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
  it("handles Backboard tool calls and returns the completed message content", async () => {
    const calls = [];
    const inventory = {
      inventory_id: "inv_duck",
      source: "manual_test_fixture",
      items: [
        {
          part_id: "3005",
          ldraw_id: "3005.dat",
          color_name: "yellow",
          color_id: "14",
          count: 2,
          supported: true,
        },
      ],
    };
    const inventoryStore = {
      async load(inventoryId) {
        assert.equal(inventoryId, "inv_duck");
        return inventory;
      },
    };
    const fetchImpl = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), headers: options.headers });

      if (url.endsWith("/threads/messages")) {
        assert.equal(options.headers["X-API-Key"], "test-key");
        return {
          ok: true,
          async json() {
            return {
              status: "REQUIRES_ACTION",
              thread_id: "thread-1",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "get_inventory_summary",
                    arguments: JSON.stringify({ inventory_id: "inv_duck" }),
                  },
                },
              ],
            };
          },
        };
      }

      if (url.endsWith("/threads/tool-outputs")) {
        assert.equal(calls[1].body.thread_id, "thread-1");
        assert.equal(calls[1].body.tool_outputs[0].tool_call_id, "call-1");
        assert.match(calls[1].body.tool_outputs[0].output, /3005/);
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
      inventorySessionId: "inv_duck",
      inventoryStore,
      fetchImpl,
    });

    const result = await client.completeWithMetadata(backboardRequest());

    assert.equal(result.text, "{\"ok\":true}");
    assert.equal(result.metadata.finishReason, "COMPLETED");
    assert.equal(result.metadata.usageMetadata.totalTokenCount, 123);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.content.includes("inv_duck"), true);
    assert.equal(calls[0].body.content.includes("generationConfig.responseSchema"), true);
    assert.equal(calls[0].body.content.includes("model_name"), true);
    assert.equal(calls[0].body.content.includes("\"items\""), false);
    assert.equal(calls[0].body.content.includes("\"count\""), false);
    assert.equal(calls[0].body.tools.some((tool) => tool.function.name === "get_inventory_summary"), true);
  });

  it("throws a clear error when Backboard never completes after tool calls", async () => {
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
      inventorySessionId: "inv_duck",
      inventoryStore: { async load() { return { inventory_id: "inv_duck", items: [] }; } },
      fetchImpl,
      maxToolRounds: 1,
    });

    await assert.rejects(
      () => client.completeWithMetadata(backboardRequest()),
      /Backboard requested tool action without tool calls/,
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
      inventorySessionId: "inv_duck",
      inventoryStore: { async load() { return { inventory_id: "inv_duck", items: [] }; } },
      fetchImpl,
    });

    await assert.rejects(
      () => client.completeWithMetadata(backboardRequest()),
      /Backboard generation ended with status FAILED: You're out of credits/,
    );
  });
});
