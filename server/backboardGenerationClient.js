const DEFAULT_BACKBOARD_BASE_URL = "https://app.backboard.io/api";

function inlineImageFromRequest(request) {
  for (const content of request.contents ?? []) {
    for (const part of content.parts ?? []) {
      if (part?.inlineData?.mimeType && part.inlineData.data) {
        return part.inlineData;
      }
    }
  }

  return null;
}

function imageFilename(mimeType) {
  return mimeType === "image/jpeg" ? "isometric-refinement.jpg" : "isometric-refinement.png";
}

function textFromParts(parts = []) {
  return parts
    .map((part) => part?.text)
    .filter((text) => typeof text === "string")
    .join("\n");
}

function responseSchemaText(request) {
  const responseSchema = request.generationConfig?.responseSchema;

  if (!responseSchema || typeof responseSchema !== "object") {
    return "";
  }

  return [
    "The original Gemini request included generationConfig.responseSchema.",
    "Your final answer must be exactly one JSON object conforming to this schema:",
    JSON.stringify(responseSchema, null, 2),
  ].join("\n");
}

function requestContent(request) {
  const userText = textFromParts(request.contents?.[0]?.parts);
  const schemaText = responseSchemaText(request);

  return [
    "Execute this LEGO generation stage.",
    "Return exactly the JSON object requested by the stage instructions.",
    schemaText,
    "",
    userText,
  ].filter((text) => text !== "").join("\n");
}

function usageMetadataFromBackboard(response) {
  return {
    promptTokenCount: response.input_tokens ?? undefined,
    candidatesTokenCount: response.output_tokens ?? undefined,
    totalTokenCount: response.total_tokens ?? undefined,
  };
}

function backboardStatusMetadata(status) {
  return status
    ? {
        providerStatus: status,
        jsonValidation: "not_validated_by_backboard",
      }
    : {};
}

function assertBackboardResponse(response, url) {
  if (!response.ok) {
    throw new Error(`Backboard request failed for ${url}: HTTP ${response.status}`);
  }
}

function failureDetailFromBackboard(response) {
  const detail = response.content ?? response.message;

  return typeof detail === "string" && detail.trim() !== "" ? `: ${detail.trim()}` : "";
}

function streamItemFromPayload(payload) {
  const eventType = payload?.type;

  if (eventType === "reasoning_streaming") {
    return null;
  }

  if (eventType === "tool_submit_required") {
    throw new Error(
      `Backboard generation requires a tool action${failureDetailFromBackboard(payload)}.`,
    );
  }

  const status = payload.status ?? payload.run_status ?? payload.run?.status;
  if (["FAILED", "REQUIRES_ACTION", "CANCELLED"].includes(status)) {
    throw new Error(
      `Backboard generation ended with status ${status}${failureDetailFromBackboard(payload)}.`,
    );
  }

  // Backboard emits run lifecycle events alongside content. Only content
  // events may contribute text to the generated JSON; run_ended contributes
  // terminal metadata but no content. Untyped events remain supported for
  // older Backboard responses.
  if (eventType && eventType !== "content_streaming" && eventType !== "run_ended") {
    return null;
  }

  const text = eventType === "run_ended"
    ? ""
    : payload.content ?? payload.text ?? payload.delta?.content ?? payload.delta?.text ?? "";
  const metadata = {
    ...backboardStatusMetadata(status),
    usageMetadata: usageMetadataFromBackboard(payload),
    backboard: {
      threadId: payload.thread_id,
      messageId: payload.message_id,
      modelProvider: payload.model_provider,
      modelName: payload.model_name,
      contextUsage: payload.context_usage,
      ...(status ? { status } : {}),
      ...(eventType ? { eventType } : {}),
    },
  };

  if (!text && !status) return null;
  return { text, metadata };
}

async function* responseChunks(body) {
  if (body?.[Symbol.asyncIterator]) {
    yield* body;
    return;
  }
  if (typeof body?.getReader === "function") {
    const reader = body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        yield next.value;
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }
  throw new Error("Backboard streaming response body is missing or unreadable.");
}

export function createBackboardGenerationClient({
  apiKey,
  baseUrl = DEFAULT_BACKBOARD_BASE_URL,
  fetchImpl = fetch,
  llmProvider = "google",
  modelName = null,
  assistantId = null,
  memory = "off",
} = {}) {
  if (!apiKey) {
    throw new Error("BACKBOARD_API_KEY is required when GENERATION_PROVIDER=backboard.");
  }

  async function postJson(path, body) {
    const url = `${baseUrl}${path}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    assertBackboardResponse(response, url);
    return response.json();
  }

  async function postMessage(body, inlineImage, { stream = false } = {}) {
    if (!inlineImage) {
      const url = `${baseUrl}/threads/messages`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      assertBackboardResponse(response, url);
      return stream ? response : response.json();
    }

    const url = `${baseUrl}/threads/messages`;
    const form = new FormData();

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        form.append(key, typeof value === "string" ? value : String(value));
      }
    }

    form.append(
      "files",
      new Blob([Buffer.from(inlineImage.data, "base64")], {
        type: inlineImage.mimeType,
      }),
      imageFilename(inlineImage.mimeType),
    );

    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
    });

    assertBackboardResponse(response, url);
    return stream ? response : response.json();
  }

  async function completeWithMetadata(request) {
    const initialBody = {
      content: requestContent(request),
      system_prompt: textFromParts(request.systemInstruction?.parts),
      llm_provider: llmProvider,
      model_name: modelName ?? request.model,
      memory,
      stream: false,
      ...(assistantId ? { assistant_id: assistantId } : {}),
    };

    const response = await postMessage(initialBody, inlineImageFromRequest(request));

    if (response.status !== "COMPLETED") {
      throw new Error(
        `Backboard generation ended with status ${response.status ?? "UNKNOWN"}${failureDetailFromBackboard(response)}.`,
      );
    }

    return {
      text: response.content ?? "",
      metadata: {
        ...backboardStatusMetadata(response.status),
        usageMetadata: usageMetadataFromBackboard(response),
        backboard: {
          threadId: response.thread_id,
          messageId: response.message_id,
          modelProvider: response.model_provider,
          modelName: response.model_name,
          contextUsage: response.context_usage,
          status: response.status,
        },
      },
    };
  }

  async function* streamWithMetadata(request) {
    const initialBody = {
      content: requestContent(request),
      system_prompt: textFromParts(request.systemInstruction?.parts),
      llm_provider: llmProvider,
      model_name: modelName ?? request.model,
      memory,
      stream: true,
      ...(assistantId ? { assistant_id: assistantId } : {}),
    };
    const response = await postMessage(initialBody, inlineImageFromRequest(request), { stream: true });
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of responseChunks(response.body)) {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        const payload = JSON.parse(data);
        const item = streamItemFromPayload(payload);
        if (item) yield item;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = buffer.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data && data !== "[DONE]") {
        const payload = JSON.parse(data);
        const item = streamItemFromPayload(payload);
        if (item) yield item;
      }
    }
  }

  return {
    completeWithMetadata,
    streamWithMetadata,
    async *stream(request) {
      for await (const item of streamWithMetadata(request)) yield item.text;
    },
    async complete(request) {
      return (await completeWithMetadata(request)).text;
    },
  };
}
