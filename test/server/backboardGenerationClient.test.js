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
  it("forwards Backboard streaming responses through the shared async contract", async () => {
    const encoder = new TextEncoder();
    let requestBody;
    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl: async (url, options) => {
        requestBody = JSON.parse(options.body);
        return {
          ok: true,
          body: {
            async *[Symbol.asyncIterator]() {
              yield encoder.encode(`data: ${JSON.stringify({ content: '{"bricks":[' })}\n\n`);
              yield encoder.encode(`data: ${JSON.stringify({ content: '{"id":"a"}' })}\n\n`);
              yield encoder.encode(`data: ${JSON.stringify({ content: "]}", status: "COMPLETED", total_tokens: 9 })}\n\n`);
            },
          },
        };
      },
    });

    const output = [];
    for await (const item of client.streamWithMetadata(backboardRequest())) output.push(item);
    assert.equal(requestBody.stream, true);
    assert.deepEqual(output.map((item) => item.text), ['{"bricks":[', '{"id":"a"}', "]}"]);
    assert.equal(output.at(-1).metadata.providerStatus, "COMPLETED");
    assert.equal(output.at(-1).metadata.jsonValidation, "not_validated_by_backboard");
    assert.equal(output.at(-1).metadata.finishReason, undefined);
  });

  it("keeps reasoning out of JSON, treats run_ended as terminal metadata, and rejects tools", async () => {
    const encoder = new TextEncoder();
    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode(`data: ${JSON.stringify({ type: "reasoning_streaming", content: "ignore me" })}\n\n`);
            yield encoder.encode(`data: ${JSON.stringify({ type: "content_streaming", content: '{"bricks":[' })}\n\n`);
            yield encoder.encode(`data: ${JSON.stringify({ type: "run_ended", status: "COMPLETED" })}\n\n`);
          },
        },
      }),
    });

    const output = [];
    for await (const item of client.streamWithMetadata(backboardRequest())) output.push(item);
    assert.deepEqual(output.map((item) => item.text), ['{"bricks":[', ""]);
    assert.equal(output.at(-1).metadata.providerStatus, "COMPLETED");
    assert.equal(output.at(-1).metadata.backboard.status, "COMPLETED");
    assert.equal(output.at(-1).metadata.finishReason, undefined);

    const toolClient = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        body: {
          async *[Symbol.asyncIterator]() {
            yield encoder.encode(`data: ${JSON.stringify({ type: "tool_submit_required" })}\n\n`);
          },
        },
      }),
    });
    await assert.rejects(
      async () => {
        for await (const item of toolClient.streamWithMetadata(backboardRequest())) void item;
      },
      /requires a tool action/,
    );
  });

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
    assert.equal(result.metadata.providerStatus, "COMPLETED");
    assert.equal(result.metadata.jsonValidation, "not_validated_by_backboard");
    assert.equal(result.metadata.backboard.status, "COMPLETED");
    assert.equal(result.metadata.finishReason, undefined);
    assert.equal(result.metadata.usageMetadata.totalTokenCount, 123);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.content.includes("duck-demo"), true);
    assert.equal(calls[0].body.content.includes("generationConfig.responseSchema"), true);
    assert.equal(calls[0].body.content.includes("model_name"), true);
    assert.equal(calls[0].body.content.includes("\"items\""), true);
    assert.equal(calls[0].body.content.includes("\"count\""), true);
    assert.equal(Object.hasOwn(calls[0].body, "tools"), false);
  });

  it("treats Backboard COMPLETED as provider status, not JSON validity", async () => {
    const client = createBackboardGenerationClient({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            status: "COMPLETED",
            content: "not json",
          };
        },
      }),
    });

    const result = await client.completeWithMetadata(backboardRequest());

    assert.equal(result.text, "not json");
    assert.equal(result.metadata.providerStatus, "COMPLETED");
    assert.equal(result.metadata.jsonValidation, "not_validated_by_backboard");
    assert.equal(result.metadata.finishReason, undefined);
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
