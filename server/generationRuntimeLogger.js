import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function safeTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    ...(error?.stack ? { stack: error.stack } : {}),
  };
}

export function redactInlineImagesForLogging(value) {
  if (Array.isArray(value)) {
    return value.map(redactInlineImagesForLogging);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted = {};

  for (const [key, child] of Object.entries(value)) {
    if (
      key === "inlineData" &&
      child &&
      typeof child === "object" &&
      typeof child.data === "string"
    ) {
      redacted[key] = {
        ...child,
        data: "[base64 image omitted from JSONL]",
        encodedBytes: Buffer.byteLength(child.data, "utf8"),
        decodedBytes: Buffer.from(child.data, "base64").length,
      };
      continue;
    }

    redacted[key] = redactInlineImagesForLogging(child);
  }

  return redacted;
}

export function createGenerationRuntimeLogger({
  rootDir = process.env.GENERATION_LOG_DIR ?? "logs/generation",
  now = () => new Date(),
  pid = process.pid,
} = {}) {
  const startTime = now();
  const runId = `${safeTimestamp(startTime)}-${pid}`;
  const filePath = join(rootDir, `generation-${runId}.jsonl`);
  let sequence = 0;

  mkdirSync(rootDir, { recursive: true });

  function write(event) {
    sequence += 1;
    appendFileSync(
      filePath,
      `${JSON.stringify({
        timestamp: now().toISOString(),
        runId,
        sequence,
        ...event,
      })}\n`,
      "utf8",
    );
  }

  write({
    type: "runtime_start",
    pid,
    filePath,
  });

  return {
    runId,
    filePath,
    write,
  };
}

export function createLoggedGenerationClient({ client, logger, now = () => new Date() }) {
  let callSequence = 0;

  async function* loggedStream(request, metadata = {}) {
    callSequence += 1;
    const callId = `${logger.runId}-call-${callSequence}`;
    const startedAt = now();
    const common = {
      callId,
      phase: metadata.phase ?? "unknown",
      stage: metadata.stage ?? "unknown",
      label: metadata.label ?? metadata.stage ?? "AI call",
      model: request?.model,
    };
    logger.write({
      type: "ai_request",
      ...common,
      request: redactInlineImagesForLogging(request),
      streaming: true,
    });
    let responseText = "";
    let responseMetadata;
    try {
      const source = typeof client.streamWithMetadata === "function"
        ? client.streamWithMetadata(request, metadata)
        : client.stream(request, metadata);
      for await (const item of source) {
        const normalized = typeof item === "string" ? { text: item } : item;
        const text = normalized?.text ?? "";
        responseText += text;
        responseMetadata = normalized?.metadata ?? responseMetadata;
        logger.write({ type: "ai_stream_chunk", ...common, text, ...(normalized?.metadata ? { metadata: normalized.metadata } : {}) });
        yield normalized;
      }
      logger.write({
        type: "ai_response",
        ...common,
        durationMs: now().getTime() - startedAt.getTime(),
        responseText,
        ...(responseMetadata ? { responseMetadata } : {}),
        streaming: true,
      });
    } catch (error) {
      logger.write({
        type: "ai_error",
        ...common,
        durationMs: now().getTime() - startedAt.getTime(),
        error: serializeError(error),
        responseText,
        streaming: true,
      });
      throw error;
    }
  }

  return {
    streamWithMetadata: loggedStream,
    async *stream(request, metadata = {}) {
      for await (const item of loggedStream(request, metadata)) yield item.text ?? item;
    },
    async complete(request, metadata = {}) {
      callSequence += 1;
      const callId = `${logger.runId}-call-${callSequence}`;
      const startedAt = now();
      const common = {
        callId,
        phase: metadata.phase ?? "unknown",
        stage: metadata.stage ?? "unknown",
        label: metadata.label ?? metadata.stage ?? "AI call",
        model: request?.model,
      };

      logger.write({
        type: "ai_request",
        ...common,
        request: redactInlineImagesForLogging(request),
      });

      try {
        const response = typeof client.completeWithMetadata === "function"
          ? await client.completeWithMetadata(request, metadata)
          : { text: await client.complete(request, metadata) };
        logger.write({
          type: "ai_response",
          ...common,
          durationMs: now().getTime() - startedAt.getTime(),
          responseText: response.text,
          ...(response.metadata ? { responseMetadata: response.metadata } : {}),
        });
        return response.text;
      } catch (error) {
        logger.write({
          type: "ai_error",
          ...common,
          durationMs: now().getTime() - startedAt.getTime(),
          error: serializeError(error),
        });
        throw error;
      }
    },
  };
}
