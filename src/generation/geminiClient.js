const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function trimTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function textPart(content) {
  return { text: content };
}

function messagesToGeminiRequest(request) {
  const messages = request.messages ?? [];
  const systemMessages = messages.filter((message) => message.role === "system");
  const conversationMessages = messages.filter((message) => message.role !== "system");
  const generationConfig = {};

  if (request.max_tokens) {
    generationConfig.maxOutputTokens = request.max_tokens;
  }

  if (request.response_format?.type === "json_object") {
    generationConfig.responseMimeType = "application/json";
  }

  return {
    ...(systemMessages.length > 0
      ? {
          systemInstruction: {
            parts: systemMessages.map((message) => textPart(message.content)),
          },
        }
      : {}),
    contents: conversationMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [textPart(message.content)],
    })),
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

function applyRequestStorage(body, storeRequests) {
  if (typeof body.store === "boolean" || typeof storeRequests !== "boolean") {
    return body;
  }

  return {
    ...body,
    store: storeRequests,
  };
}

function toGeminiRequestBody(request, storeRequests) {
  if (request.contents || request.systemInstruction || request.generationConfig) {
    const { model, ...body } = request;
    return applyRequestStorage(body, storeRequests);
  }

  return applyRequestStorage(messagesToGeminiRequest(request), storeRequests);
}

function extractGeminiText(body) {
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => part.text).filter(Boolean).join("");
}

function extractGeminiMetadata(body) {
  const candidate = body?.candidates?.[0] ?? {};
  return {
    ...(candidate.finishReason ? { finishReason: candidate.finishReason } : {}),
    ...(candidate.finishMessage ? { finishMessage: candidate.finishMessage } : {}),
    ...(candidate.safetyRatings ? { safetyRatings: candidate.safetyRatings } : {}),
    ...(body?.usageMetadata ? { usageMetadata: body.usageMetadata } : {}),
    ...(body?.promptFeedback ? { promptFeedback: body.promptFeedback } : {}),
  };
}

export function createGeminiClient({
  apiKey,
  fetchImpl = fetch,
  baseUrl = DEFAULT_BASE_URL,
  storeRequests,
} = {}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required.");
  }

  return {
    async completeWithMetadata(request) {
      if (typeof request.model !== "string" || request.model.trim() === "") {
        throw new Error("Gemini request model is required.");
      }

      const model = request.model.trim();
      const response = await fetchImpl(
        `${trimTrailingSlash(baseUrl)}/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(toGeminiRequestBody(request, storeRequests)),
        },
      );

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const message = body?.error?.message ?? `Gemini request failed with ${response.status}`;
        throw new Error(message);
      }

      const content = extractGeminiText(body);

      if (content.trim() === "") {
        throw new Error("Gemini response did not include text content.");
      }

      return {
        text: content,
        metadata: extractGeminiMetadata(body),
      };
    },

    async complete(request) {
      const result = await this.completeWithMetadata(request);
      return result.text;
    },
  };
}
