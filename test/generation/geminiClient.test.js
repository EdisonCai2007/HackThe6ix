import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGeminiClient } from "../../src/generation/geminiClient.js";

const TEST_MODEL = "test-gemini-model";

describe("Gemini client", () => {
  it("streams text chunks from Gemini SSE responses with final metadata", async () => {
    const calls = [];
    const encoder = new TextEncoder();
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const chunks = [
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"bricks":[' }] } }] })}\n\n`,
          `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"id":"a"}' }] } }] })}\n\n`,
          `data: ${JSON.stringify({
            candidates: [{
              finishReason: "STOP",
              content: { parts: [{ text: "]}" }] },
            }],
            usageMetadata: { totalTokenCount: 7 },
          })}\n\n`,
        ];
        return {
          ok: true,
          body: {
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield encoder.encode(chunk);
            },
          },
        };
      },
    });

    const output = [];
    for await (const item of client.streamWithMetadata({ model: TEST_MODEL, contents: [] })) {
      output.push(item);
    }

    assert.deepEqual(output.map((item) => item.text), ['{"bricks":[', '{"id":"a"}', "]}"]);
    assert.equal(output.at(-1).metadata.finishReason, "STOP");
    assert.equal(calls[0].url, `https://gemini.test/v1beta/models/${TEST_MODEL}:streamGenerateContent?alt=sse`);
  });
  it("requires direct requests to include an explicit model", async () => {
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      fetchImpl: async () => {
        throw new Error("fetch should not run without a model");
      },
    });

    await assert.rejects(
      () =>
        client.complete({
          messages: [{ role: "user", content: '{"prompt":"build me a duck"}' }],
        }),
      /Gemini request model is required/,
    );
  });

  it("converts chat-style prompt requests into Gemini generateContent requests", async () => {
    const calls = [];
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          async json() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: '{"ok":true}' }],
                  },
                },
              ],
            };
          },
        };
      },
    });

    const result = await client.complete({
      model: TEST_MODEL,
      max_tokens: 10000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Output JSON only." },
        { role: "user", content: '{"prompt":"build me a duck"}' },
      ],
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(
      calls[0].url,
      `https://gemini.test/v1beta/models/${TEST_MODEL}:generateContent`,
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.systemInstruction, {
      parts: [{ text: "Output JSON only." }],
    });
    assert.deepEqual(body.contents, [
      {
        role: "user",
        parts: [{ text: '{"prompt":"build me a duck"}' }],
      },
    ]);
    assert.deepEqual(body.generationConfig, {
      maxOutputTokens: 10000,
      responseMimeType: "application/json",
    });
  });

  it("can return Gemini finish and usage metadata with generated text", async () => {
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: {
                  parts: [{ text: '{"partial":true' }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 123,
              candidatesTokenCount: 456,
              totalTokenCount: 579,
            },
          };
        },
      }),
    });

    const result = await client.completeWithMetadata({
      model: TEST_MODEL,
      contents: [{ role: "user", parts: [{ text: "Output JSON only." }] }],
    });

    assert.equal(result.text, '{"partial":true');
    assert.deepEqual(result.metadata, {
      finishReason: "MAX_TOKENS",
      usageMetadata: {
        promptTokenCount: 123,
        candidatesTokenCount: 456,
        totalTokenCount: 579,
      },
    });
  });

  it("adds top-level request storage when Gemini logging is enabled", async () => {
    const calls = [];
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      storeRequests: true,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          async json() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: '{"ok":true}' }],
                  },
                },
              ],
            };
          },
        };
      },
    });

    await client.complete({
      model: TEST_MODEL,
      contents: [{ role: "user", parts: [{ text: "Output JSON only." }] }],
    });

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.store, true);
  });

  it("lets a request override client-level Gemini logging", async () => {
    const calls = [];
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      storeRequests: true,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          async json() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: '{"ok":true}' }],
                  },
                },
              ],
            };
          },
        };
      },
    });

    await client.complete({
      model: TEST_MODEL,
      store: false,
      contents: [{ role: "user", parts: [{ text: "Output JSON only." }] }],
    });

    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.store, false);
  });

  it("passes native Gemini prompt requests through without chat conversion", async () => {
    const calls = [];
    const client = createGeminiClient({
      apiKey: "test-key",
      baseUrl: "https://gemini.test/v1beta",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          async json() {
            return {
              candidates: [
                {
                  content: {
                    parts: [{ text: '{"ok":true}' }],
                  },
                },
              ],
            };
          },
        };
      },
    });

    await client.complete({
      model: TEST_MODEL,
      systemInstruction: {
        parts: [{ text: "Output JSON only." }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: '{"prompt":"build me a duck"}' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 10000,
        responseMimeType: "application/json",
      },
    });

    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body, {
      systemInstruction: {
        parts: [{ text: "Output JSON only." }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: '{"prompt":"build me a duck"}' }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 10000,
        responseMimeType: "application/json",
      },
    });
  });

  it("requires GEMINI_API_KEY", () => {
    assert.throws(
      () => createGeminiClient({ apiKey: "" }),
      /GEMINI_API_KEY is required/,
    );
  });

  it("reports Gemini API errors", async () => {
    const client = createGeminiClient({
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        async json() {
          return { error: { message: "Rate limit exceeded." } };
        },
      }),
    });

    await assert.rejects(
      () => client.complete({ model: TEST_MODEL, messages: [] }),
      /Rate limit exceeded/,
    );
  });
});
