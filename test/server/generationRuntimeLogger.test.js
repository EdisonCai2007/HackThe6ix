import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

import {
  createGenerationRuntimeLogger,
  createLoggedGenerationClient,
} from "../../server/generationRuntimeLogger.js";

async function readJsonLines(filePath) {
  const text = await readFile(filePath, "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("generation runtime logger", () => {
  it("creates a new jsonl file for a runtime and logs metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-runtime-logger-"));

    try {
      const logger = createGenerationRuntimeLogger({
        rootDir,
        now: () => new Date("2026-07-17T18:01:02.003Z"),
        pid: 1234,
      });

      assert.match(logger.filePath, /generation-2026-07-17T18-01-02-003Z-1234\.jsonl$/);

      const events = await readJsonLines(logger.filePath);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "runtime_start");
      assert.equal(events[0].runId, "2026-07-17T18-01-02-003Z-1234");
      assert.equal(events[0].sequence, 1);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("logs exact AI model inputs and outputs with stage metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-runtime-logger-"));

    try {
      const logger = createGenerationRuntimeLogger({
        rootDir,
        now: () => new Date("2026-07-17T18:01:02.003Z"),
        pid: 1234,
      });
      const rawClient = {
        async complete(request) {
          assert.equal(request.model, "gemini-test-model");
          return '{"model_name":"Tiny Duck"}';
        },
      };
      const client = createLoggedGenerationClient({ client: rawClient, logger });
      const request = {
        model: "gemini-test-model",
        systemInstruction: { parts: [{ text: "Output JSON only." }] },
        contents: [{ role: "user", parts: [{ text: '{"prompt":"build a duck"}' }] }],
        generationConfig: { responseMimeType: "application/json" },
      };

      const output = await client.complete(request, {
        phase: "planning",
        stage: "structure_generate",
        label: "Structure planning",
      });

      assert.equal(output, '{"model_name":"Tiny Duck"}');
      const events = await readJsonLines(logger.filePath);
      assert.equal(events.map((event) => event.type).join(","), "runtime_start,ai_request,ai_response");
      assert.equal(events[1].callId, events[2].callId);
      assert.equal(events[1].phase, "planning");
      assert.equal(events[1].stage, "structure_generate");
      assert.deepEqual(events[1].request, request);
      assert.equal(events[2].responseText, '{"model_name":"Tiny Duck"}');
      assert.equal(typeof events[2].durationMs, "number");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("logs AI response metadata when the client provides it", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-runtime-logger-"));

    try {
      const logger = createGenerationRuntimeLogger({
        rootDir,
        now: () => new Date("2026-07-17T18:01:02.003Z"),
        pid: 1234,
      });
      const rawClient = {
        async completeWithMetadata(request) {
          assert.equal(request.model, "gemini-test-model");
          return {
            text: '{"partial":true',
            metadata: {
              finishReason: "MAX_TOKENS",
              usageMetadata: {
                promptTokenCount: 12,
                candidatesTokenCount: 34,
                totalTokenCount: 46,
              },
            },
          };
        },
      };
      const client = createLoggedGenerationClient({ client: rawClient, logger });
      const request = {
        model: "gemini-test-model",
        contents: [{ role: "user", parts: [{ text: "Output JSON only." }] }],
      };

      const output = await client.complete(request, {
        phase: "placing",
        stage: "placement_generate",
      });

      assert.equal(output, '{"partial":true');
      const events = await readJsonLines(logger.filePath);
      assert.equal(events[2].responseText, '{"partial":true');
      assert.deepEqual(events[2].responseMetadata, {
        finishReason: "MAX_TOKENS",
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 34,
          totalTokenCount: 46,
        },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("logs AI model errors with the original input", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-runtime-logger-"));

    try {
      const logger = createGenerationRuntimeLogger({
        rootDir,
        now: () => new Date("2026-07-17T18:01:02.003Z"),
        pid: 1234,
      });
      const rawClient = {
        async complete() {
          throw new Error("Rate limit exceeded.");
        },
      };
      const client = createLoggedGenerationClient({ client: rawClient, logger });
      const request = {
        model: "gemini-test-model",
        contents: [{ role: "user", parts: [{ text: "bad request" }] }],
      };

      await assert.rejects(
        () => client.complete(request, { phase: "placing", stage: "placement_generate" }),
        /Rate limit exceeded/,
      );

      const events = await readJsonLines(logger.filePath);
      assert.equal(events.map((event) => event.type).join(","), "runtime_start,ai_request,ai_error");
      assert.deepEqual(events[1].request, request);
      assert.equal(events[2].error.message, "Rate limit exceeded.");
      assert.equal(events[2].phase, "placing");
      assert.equal(events[2].stage, "placement_generate");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("logs streaming chunks and a terminal completion event", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "generation-runtime-logger-"));
    try {
      const logger = createGenerationRuntimeLogger({ rootDir, pid: 1234 });
      const rawClient = {
        async *streamWithMetadata() {
          yield { text: "{\"bricks\":[", metadata: {} };
          yield { text: "]}", metadata: { finishReason: "STOP" } };
        },
      };
      const client = createLoggedGenerationClient({ client: rawClient, logger });
      const output = [];
      for await (const item of client.streamWithMetadata({ model: "gemini-test-model" }, { phase: "placing", stage: "placement_generate" })) {
        output.push(item.text);
      }
      assert.deepEqual(output, ['{"bricks":[', "]}"]);
      const events = await readJsonLines(logger.filePath);
      assert.deepEqual(events.map((event) => event.type), ["runtime_start", "ai_request", "ai_stream_chunk", "ai_stream_chunk", "ai_response"]);
      assert.equal(events.at(-1).responseText, '{"bricks":[]}');
      assert.equal(events.at(-1).responseMetadata.finishReason, "STOP");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
