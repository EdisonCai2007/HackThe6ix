const DEFAULT_BACKBOARD_BASE_URL = "https://app.backboard.io/api";

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

function assertBackboardResponse(response, url) {
  if (!response.ok) {
    throw new Error(`Backboard request failed for ${url}: HTTP ${response.status}`);
  }
}

function failureDetailFromBackboard(response) {
  const detail = response.content ?? response.message;

  return typeof detail === "string" && detail.trim() !== "" ? `: ${detail.trim()}` : "";
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

    const response = await postJson("/threads/messages", initialBody);

    if (response.status !== "COMPLETED") {
      throw new Error(
        `Backboard generation ended with status ${response.status ?? "UNKNOWN"}${failureDetailFromBackboard(response)}.`,
      );
    }

    return {
      text: response.content ?? "",
      metadata: {
        finishReason: response.status,
        usageMetadata: usageMetadataFromBackboard(response),
        backboard: {
          threadId: response.thread_id,
          messageId: response.message_id,
          modelProvider: response.model_provider,
          modelName: response.model_name,
          contextUsage: response.context_usage,
        },
      },
    };
  }

  return {
    completeWithMetadata,
    async complete(request) {
      return (await completeWithMetadata(request)).text;
    },
  };
}
